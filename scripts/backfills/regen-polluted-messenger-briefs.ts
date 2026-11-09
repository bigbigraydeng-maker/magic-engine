/**
 * 一次性回填：重算一个客户名下、摘要里冒充了别家客户的私信需求卡（conversation_briefs）。
 *
 * 背景：src/lib/messenger/brief.ts 文件头记的 2026-09-13 事故 —— 提示词曾写死
 * 「你是 CTS Tours New Zealand」，修好之后旧卡没有重算。2026-10-10 查生产库：
 * New Asian Logistics 的 187 张 Messenger 卡里 109 张摘要仍写着「CTS 提供了…」。
 *
 * 为什么不直接等每小时的写卡任务（brief-cycle.ts）：它只从最近 500 条对话里挑人，
 * 而这批被污染的对话有 65 条排在 500 名之外，永远轮不到；它也只在「对话有新消息」
 * 时才重写。所以这里按「摘要文字匹配」直接点名重算，但**生成和落库全部复用
 * brief.ts 的 generateBrief / storeBrief**，不另写一套调模型的逻辑 —— 身份从
 * clients.name 读、非旅游客户 trip 强制清空、知识库事实等闸门原样生效。
 *
 * 安全闸：
 *   - 目标客户自己的名字若含匹配词（例如对 CTS 自己跑 %CTS%），拒绝执行 —— 那不是污染。
 *   - 没有 OPENAI_API_KEY 时拒绝执行：generateBrief 会退化成不调模型的占位卡，
 *     写进去等于用另一种垃圾替换这种垃圾。
 *   - 默认 dry-run：读库 + 调模型 + 打印新摘要，**不落库**；加 --live 才写。
 *   - 单条失败记一笔继续，不掀翻整批。
 *
 * 用法（在仓库根目录，或用 --env-file 指向主目录的 .env.local）：
 *   npx tsx scripts/backfills/regen-polluted-messenger-briefs.ts --client-id=<uuid> --limit=1
 *   npx tsx scripts/backfills/regen-polluted-messenger-briefs.ts --client-id=<uuid> --live
 *   可选：--pattern='%CTS%'（默认）、--env-file=<path>（默认 .env.local）、
 *         --conversation-id=<uuid>（点名一条，不按摘要筛）
 */

import { readFileSync } from 'node:fs'

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const ENV_FILE = arg('env-file') ?? '.env.local'
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const LIVE = process.argv.includes('--live')
const CLIENT_ID = arg('client-id')
const PATTERN = arg('pattern') ?? '%CTS%'
const LIMIT = Number(arg('limit') ?? '1000')
/** 点名一条对话重算（例如摘要干净但 draft_reply 里还留着别家客户的电话/邮箱）。 */
const ONLY_CONVERSATION_ID = arg('conversation-id')
/** 跟 brief-cycle.ts 的单条预算对齐，一条卡住不拖整批。 */
const PER_CANDIDATE_MS = 20_000

interface BriefRow {
  conversation_id: string
  regen_count: number
  regen_count_date: string | null
  summary: string
}
interface ConversationRow {
  id: string
  message_count: number
  last_message_at: string | null
  last_message_from: string | null
}

function patternToRegex(pattern: string): RegExp {
  const core = pattern.replace(/^%|%$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 整词匹配：不加边界的话「products」里的 cts 也会被当成 CTS（首轮实跑 4 条误报）。
  return new RegExp(`\\b${core}\\b`, 'i')
}

async function main(): Promise<void> {
  if (!CLIENT_ID) throw new Error('缺 --client-id=<uuid>')
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('没有 OPENAI_API_KEY —— generateBrief 会退化成不调模型的占位卡，拒绝执行')
  }

  const { supabaseAdmin } = await import('../../src/lib/supabase')
  const { generateBrief, storeBrief } = await import('../../src/lib/messenger/brief')
  const matcher = patternToRegex(PATTERN)

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', CLIENT_ID)
    .maybeSingle()
  if (clientErr) throw new Error(`读客户失败：${clientErr.message}`)
  if (!client?.name) throw new Error(`客户 ${CLIENT_ID} 不存在`)
  if (matcher.test(client.name)) {
    throw new Error(`客户名「${client.name}」本身就含「${PATTERN}」—— 这不是污染，拒绝执行`)
  }

  let briefQuery = supabaseAdmin
    .from('conversation_briefs')
    .select('conversation_id, regen_count, regen_count_date, summary')
    .eq('client_id', CLIENT_ID)
  briefQuery = ONLY_CONVERSATION_ID
    ? briefQuery.eq('conversation_id', ONLY_CONVERSATION_ID)
    : briefQuery.ilike('summary', PATTERN)
  const { data: briefs, error: briefErr } = await briefQuery
    .order('generated_at', { ascending: true })
    .limit(LIMIT)
  if (briefErr) throw new Error(`读需求卡失败：${briefErr.message}`)

  const rows = (briefs ?? []) as BriefRow[]
  console.log(`客户「${client.name}」摘要含「${PATTERN}」的卡：${rows.length} 张（${LIVE ? 'LIVE 会落库' : 'dry-run 不落库'}）`)

  const now = new Date()
  let regenerated = 0
  let stillPolluted = 0
  let failed = 0

  for (const row of rows) {
    try {
      const signal = AbortSignal.timeout(PER_CANDIDATE_MS)
      const { data: conv, error: convErr } = await supabaseAdmin
        .from('conversations')
        .select('id, message_count, last_message_at, last_message_from')
        .eq('id', row.conversation_id)
        .maybeSingle()
      if (convErr || !conv) throw new Error(`读对话失败：${convErr?.message ?? '不存在'}`)
      const c = conv as ConversationRow

      // 跟 brief-cycle.ts 的 loadMessages 同一条查询（它没导出，这里不改 src/）。
      const { data: msgs, error: msgErr } = await supabaseAdmin
        .from('conversation_messages')
        .select('direction, sender_name, body, sent_at')
        .eq('conversation_id', row.conversation_id)
        .order('sent_at', { ascending: true })
        .abortSignal(signal)
      if (msgErr) throw new Error(`读消息失败：${msgErr.message}`)
      const messages = (msgs ?? []).map((m) => ({
        direction: m.direction as 'inbound' | 'outbound',
        senderName: m.sender_name as string | null,
        body: (m.body as string | null) ?? '',
        sentAt: m.sent_at as string,
      }))
      if (messages.length === 0) throw new Error('对话没有消息')

      const { brief, knowledgeStatus } = await generateBrief(
        messages,
        CLIENT_ID,
        {
          awaitingReply: c.last_message_from === 'customer',
          hoursSinceLastMessage: c.last_message_at
            ? Math.round((now.getTime() - new Date(c.last_message_at).getTime()) / 3_600_000)
            : 0,
        },
        { signal },
      )

      const polluted = matcher.test(brief.summary) || matcher.test(brief.draft_reply)
      if (polluted) stillPolluted++
      console.log(
        `\n[${row.conversation_id}] ${polluted ? '❌ 仍含匹配词' : '✅'}\n  旧: ${row.summary.slice(0, 160)}\n  新: ${brief.summary.slice(0, 160)}`,
      )

      if (LIVE) {
        await storeBrief(
          {
            conversationId: c.id,
            clientId: CLIENT_ID,
            messageCount: c.message_count,
            lastMessageAt: c.last_message_at,
            existingBriefMessageCount: null,
            regenCount: row.regen_count,
            regenCountDate: row.regen_count_date,
          },
          brief,
          now,
          knowledgeStatus,
          signal,
        )
        regenerated++
      }
    } catch (err) {
      failed++
      console.error(`[${row.conversation_id}] 失败：`, err instanceof Error ? err.message : err)
    }
  }

  console.log(
    `\n完成：候选 ${rows.length}，${LIVE ? `已重写 ${regenerated}` : '未落库（dry-run）'}，新摘要仍含匹配词 ${stillPolluted}，失败 ${failed}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
