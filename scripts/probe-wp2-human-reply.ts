/**
 * WP2「最后一次真人回复」判据的**当场试跑**脚本 —— 对真实私信只读跑一遍，
 * 跟设计阶段用 SQL 独立算出的数字对账。
 *
 * ## 为什么在仓库里
 *
 * 台账卡 `2026-09-26-wp2-ai-notice-table` 的复核办法写的是「重跑试跑脚本」，
 * 但第一次那个探针跑完就删了 —— 到了复核日没东西可跑（魏征复审 2026-09-26
 * W61-5 抓到）。判据每改一次都要重跑这一遍，写成脚本才复核得了。
 *
 * ## 怎么跑
 *
 * ```bash
 * npx tsx --env-file=/path/to/.env.local scripts/probe-wp2-human-reply.ts [clientId]
 * ```
 *
 * 密钥由 `node --env-file` 加载进 `process.env`，脚本自己不读、不打印任何密钥。
 * 默认客户是 CTS（只是缺省值，不是判据）。
 *
 * ## 对账基准（2026-09-26，CTS）
 *
 * 设计阶段用一条 SQL 独立算出，本脚本用 TS 判据算出，四个数字应当完全一致：
 *
 * | 指标 | 基准 |
 * |---|---|
 * | 带 `<convId>:out` 触点的会话 | 500 |
 * | 整条会话没有任何真人回复 | 377 |
 * | 有真人回复、但触点时间比它晚 >1 分钟（该前移） | 6 |
 * | 有真人回复、触点时间基本对得上 | 117 |
 *
 * 数字漂了不一定是错 —— 新私信会进来。先看 `INPUT` 那几行是不是也涨了；
 * 三项之和必须等于带 `:out` 触点的会话数，这一条任何时候都成立。
 *
 * ## 全程只读
 *
 * 四条 select，无写操作。只打印数字，不打印任何消息正文。
 */
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { lastHumanPageReplyAt, classifyAiNotice, type ThreadMessage } from '@/lib/messenger/automation'

const DEFAULT_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CLIENT_ID = process.argv[2] ?? DEFAULT_CLIENT_ID

/**
 * 自动安抚经 ME 发出时用的身份 —— 经 ME 发出但**不是**真人。
 *
 * ⚠️ WP2 M1-② 要把这个常量合并进 automation.ts、并改成按域的 allowlist
 * （`@magicengine.cloud` 以外才算真人）。在那之前这里照现值硬写一份，
 * 接线轮落实 M1-② 之后**这一行要删掉、改成 import**。
 */
const AGENT_SENDER = 'governed-reply-agent@magicengine.cloud'

interface ConvRow { id: string }
interface MsgRow { conversation_id: string; direction: 'inbound' | 'outbound'; body: string | null; sent_at: string; message_id: string | null }
interface OutLogRow { meta_message_id: string | null; sent_by_email: string | null; status: string | null }
interface TouchRow { source_ref: string | null; occurred_at: string }

async function main(): Promise<void> {
  const [convs, msgs, outLog, touches] = await Promise.all([
    fetchAll<ConvRow>((f, t) =>
      supabaseAdmin.from('conversations').select('id')
        .eq('client_id', CLIENT_ID).eq('channel', 'messenger').order('id', { ascending: true }).range(f, t)),
    fetchAll<MsgRow>((f, t) =>
      supabaseAdmin.from('conversation_messages').select('conversation_id, direction, body, sent_at, message_id')
        .order('sent_at', { ascending: true }).range(f, t)),
    fetchAll<OutLogRow>((f, t) =>
      supabaseAdmin.from('conversation_outbound_log').select('meta_message_id, sent_by_email, status')
        .eq('client_id', CLIENT_ID).order('created_at', { ascending: true }).range(f, t)),
    fetchAll<TouchRow>((f, t) =>
      supabaseAdmin.from('contact_touchpoints').select('source_ref, occurred_at')
        .eq('client_id', CLIENT_ID).eq('channel', 'messenger').eq('direction', 'outbound')
        .order('occurred_at', { ascending: false }).range(f, t)),
  ])

  const convIds = new Set(convs.map((c) => c.id))
  const humanMetaIds = new Set(
    outLog
      .filter((l) => l.status === 'sent' && l.sent_by_email !== null && l.sent_by_email !== AGENT_SENDER)
      .map((l) => l.meta_message_id)
      .filter((v): v is string => typeof v === 'string'),
  )

  const byConv = new Map<string, ThreadMessage[]>()
  let noticeCount = 0
  for (const m of msgs) {
    if (!convIds.has(m.conversation_id)) continue
    if (m.direction === 'outbound' && classifyAiNotice(m.body ?? '') !== null) noticeCount++
    const list = byConv.get(m.conversation_id) ?? []
    list.push({
      direction: m.direction,
      body: m.body ?? '',
      sentAt: m.sent_at,
      tags: [],
      sentByHumanViaMe: m.message_id !== null && humanMetaIds.has(m.message_id),
    })
    byConv.set(m.conversation_id, list)
  }

  // `<convId>:out` 触点：source_ref 前半截就是 conversations.id
  const outTouchByConv = new Map<string, string>()
  for (const t of touches) {
    if (!t.source_ref?.endsWith(':out')) continue
    const cid = t.source_ref.slice(0, -':out'.length)
    if (convIds.has(cid) && !outTouchByConv.has(cid)) outTouchByConv.set(cid, t.occurred_at)
  }

  console.log(`INPUT client=${CLIENT_ID}`)
  console.log(`INPUT 会话=${convs.length} 消息=${msgs.length} 发送记录=${outLog.length}（真人经 ME 发出=${humanMetaIds.size}）`)
  console.log(`INPUT 认出的系统通知条数=${noticeCount}`)
  console.log(`INPUT 带 :out 触点的会话=${outTouchByConv.size}   ← 基准 500（CTS，2026-09-26）`)

  let noHuman = 0
  let shouldMoveEarlier = 0
  let unchanged = 0
  for (const [cid, touchAt] of outTouchByConv) {
    const human = lastHumanPageReplyAt(byConv.get(cid) ?? [])
    if (human === null) {
      noHuman++
      continue
    }
    if (Date.parse(touchAt) - Date.parse(human) > 60_000) shouldMoveEarlier++
    else unchanged++
  }

  console.log('\n结果（只看带 :out 触点的会话）：')
  console.log(`  整条会话没有任何真人回复        = ${noHuman}   ← 基准 377`)
  console.log(`  有真人回复、触点时间该前移      = ${shouldMoveEarlier}   ← 基准 6`)
  console.log(`  有真人回复、触点时间对得上      = ${unchanged}   ← 基准 117`)
  const sum = noHuman + shouldMoveEarlier + unchanged
  console.log(`  三项之和 = ${sum}，带 :out 触点的会话 = ${outTouchByConv.size}，一致=${sum === outTouchByConv.size}`)
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error('PROBE FAILED:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
