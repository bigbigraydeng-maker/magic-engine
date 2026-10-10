/**
 * 意图判定校准探针 —— **只读**，绝不写库。
 *
 * 干什么：抽一个客户已有的 AI「意图」判定（`conversation_briefs.intent_level`），
 * 用一份新写下的判定标准重判同一段对话，把「原判 vs 新判」的差异写成一份
 * **匿名**报告，供人对着看标准是不是写歪了。
 *
 * 只读哪些表（全部只有 `.select(...)`）：
 *   - `conversation_briefs`（取原判）
 *   - `conversation_messages`（取对话原文）
 *   - `clients`（取商家名，用于提示词）
 *
 * 输出为什么必须匿名（PM 2026-10-10）：客户姓名、电话、邮箱、链接一律不得
 * 出现在任何输出里 —— 报告会被人转发、贴进文档，脱敏在写文件之前完成。
 *
 * 怎么跑：
 *   npx tsx --env-file=/path/.env.local scripts/probe-intent-calibration.ts \
 *     <clientId> <outFile.md> [perLevel=15] [unknownCount=10]
 *
 * 判定标准（提示词）的出处：docs/specs/2026-10-10-crm-intent-calibration-plan.md
 */

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { quoteIsGrounded } from '@/lib/crm/stage-from-conversation'

const LEVELS = ['high', 'medium', 'low', 'unknown'] as const
type Level = (typeof LEVELS)[number]

const VerdictSchema = z.object({
  level: z.enum(LEVELS),
  customer_quote: z.string(),
  our_quote: z.string(),
  progression: z.string(),
  reason: z.string(),
})
type Verdict = z.infer<typeof VerdictSchema>

interface BriefRow {
  conversation_id: string
  intent_level: string | null
  generated_at: string | null
}

interface MsgRow {
  direction: 'inbound' | 'outbound'
  body: string | null
  sent_at: string
}

interface Sample {
  index: number
  conversationId: string
  oldLevel: string
  newLevel: string
  turns: number
  progression: string
  customerQuote: string
  ourQuote: string
  reason: string
  downgraded: boolean
  downgradeNote: string
}

function modelName(): string {
  return process.env.CRM_INTENT_CALIBRATION_MODEL ?? 'gpt-4o-mini'
}

function stableHash(id: string): string {
  return createHash('sha256').update(id).digest('hex')
}

/** 脱敏：邮箱、7 位以上号码、链接。写进报告前必须过这一道。 */
function mask(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱]')
    .replace(/\+?[\d][\d\s-]{5,}\d/g, '[号码]')
    .replace(/https?:\/\/\S+/gi, '[链接]')
}

function maskQuote(text: string): string {
  return mask(text).slice(0, 120)
}

/** 表格单元格：竖线换掉、换行压平。 */
function cell(text: string): string {
  return mask(text).replace(/\|/g, '／').replace(/\s*\n\s*/g, ' ').trim()
}

function buildSystemPrompt(business: string): string {
  return `You judge how far a sales conversation between ${business} ("US") and one prospect ("CUSTOMER") has actually progressed. Judge the INTERACTION between both sides — not how much the customer talked, and not their tone.

Answer with exactly one level:
- "high" — a real, active prospect. EITHER (a) both sides went back and forth at least two rounds (customer, us, customer, us) AND the content clearly progressed step by step — from a general question, to specific goods / route / quantity, to price, timing or what happens next; OR (b) WE have already given a price/quote AND the customer gave specific product information (what goods, how much, or from where to where) rather than a general inquiry.
- "medium" — only half of that: there was back-and-forth but it did not progress (same question repeated, pleasantries, thanks); or the customer gave specific product information but we have not quoted; or we quoted but the customer only ever asked a general question.
- "low" — a general inquiry with no follow-through; or the customer said not now / just looking; or they asked for something we do not do.
- "unknown" — spam, promotion, wrong recipient, or too short to tell anything.

Rules:
- Lines marked "US (auto-reply)" are canned messages (rate cards, welcome text, bot answers). They do NOT count as a round of conversation and do NOT count as us giving a quote. Never use one as our_quote.
- If US said we cannot do what the customer asked (a route, a cargo type or a service we do not handle), the level is "low" no matter how long the conversation is.
- A customer who has already ordered, paid, or is arranging shipment with us is "high".
- customer_quote: copy ONE sentence VERBATIM from a CUSTOMER line. our_quote: copy ONE sentence VERBATIM from a US line. Character for character — both are checked against the transcript. If the level is "high" you MUST provide both. Use an empty string when there is nothing to quote.
- progression: in SIMPLIFIED CHINESE, one short phrase of the form "从 X 聊到了 Y". Empty string if the conversation did not progress.
- reason: one short sentence in SIMPLIFIED CHINESE.`
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['level', 'customer_quote', 'our_quote', 'progression', 'reason'],
  properties: {
    level: { type: 'string', enum: [...LEVELS] },
    customer_quote: { type: 'string' },
    our_quote: { type: 'string' },
    progression: { type: 'string' },
    reason: { type: 'string' },
  },
} as const

async function askModel(
  business: string,
  transcript: string,
): Promise<{ verdict: Verdict | null; usage: { input: number; output: number } }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY 未设置')
  const { getOpenAIClient } = await import('@/lib/ai/openai-client')
  const client = getOpenAIClient({ apiKey, bypassGateway: true })
  const res = await client.responses.create({
    model: modelName(),
    input: [
      { role: 'system', content: buildSystemPrompt(business) },
      { role: 'user', content: `Conversation:\n${transcript}` },
    ],
    text: {
      format: { type: 'json_schema', name: 'intent_verdict', schema: SCHEMA },
    },
  } as Parameters<typeof client.responses.create>[0])

  const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
  const text = (res as { output_text?: string }).output_text ?? '{}'
  const parsed = VerdictSchema.safeParse(JSON.parse(text))
  return {
    verdict: parsed.success ? parsed.data : null,
    usage: { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 },
  }
}

async function loadBriefs(clientId: string): Promise<BriefRow[]> {
  return fetchAll<BriefRow>((from, to) =>
    supabaseAdmin
      .from('conversation_briefs')
      .select('conversation_id, intent_level, generated_at')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(from, to),
  )
}

function pickSample(briefs: BriefRow[], perLevel: number, unknownCount: number): BriefRow[] {
  const byLevel = new Map<string, BriefRow[]>()
  for (const b of briefs) {
    const key = b.intent_level ?? 'unknown'
    const list = byLevel.get(key) ?? []
    list.push(b)
    byLevel.set(key, list)
  }
  const out: BriefRow[] = []
  for (const level of LEVELS) {
    const list = (byLevel.get(level) ?? []).slice().sort((a, b) =>
      stableHash(a.conversation_id).localeCompare(stableHash(b.conversation_id)),
    )
    const take = level === 'unknown' ? unknownCount : perLevel
    out.push(...list.slice(0, take))
  }
  return out
}

async function loadMessages(conversationId: string): Promise<MsgRow[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('direction, body, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(`读对话原文失败: ${error.message}`)
  return ((data ?? []) as MsgRow[]).filter((m) => (m.body ?? '').trim().length > 0)
}

async function loadBusinessName(clientId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .maybeSingle()
  const name = (data as { name?: string | null } | null)?.name
  return name && name.trim() ? name.trim() : 'the business'
}

/** 一条我们发出的话的「指纹」：去空白、取前 60 个字。用来认出到处都一样的固定回复。 */
function cannedKey(body: string | null): string {
  return (body ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60)
}

/**
 * 固定回复（费率卡、欢迎语、Meta AI 客服的套话）：同一句话出现在 3 段以上不同对话里。
 *
 * 第一轮试跑（2026-10-10）栽在这上面：客人只问了一句「运费多少」，系统自动贴了费率卡，
 * 模型就判成「我们已报价 → 高」。库里没有「这条是机器发的」标记，只能靠重复度认。
 */
function findCanned(all: MsgRow[][]): Set<string> {
  const seenIn = new Map<string, number>()
  for (const msgs of all) {
    const keys = new Set<string>()
    for (const m of msgs) {
      if (m.direction !== 'outbound') continue
      const k = cannedKey(m.body)
      if (k.length >= 12) keys.add(k)
    }
    for (const k of keys) seenIn.set(k, (seenIn.get(k) ?? 0) + 1)
  }
  return new Set(Array.from(seenIn.entries()).filter(([, n]) => n >= 3).map(([k]) => k))
}

function isCanned(m: MsgRow, canned: Set<string>): boolean {
  return m.direction === 'outbound' && canned.has(cannedKey(m.body))
}

function buildTranscript(msgs: MsgRow[], canned: Set<string>): string {
  const lines = msgs.map((m) => {
    const who = m.direction === 'inbound' ? 'CUSTOMER' : isCanned(m, canned) ? 'US (auto-reply)' : 'US'
    // 去掉落单的代理项（截断把表情劈成两半会让请求体不是合法 JSON，第一轮 #55 就这么挂的）。
    const body = (m.body ?? '').trim().slice(0, 600).replace(/[\uD800-\uDFFF]/g, '')
    return `${who}: ${body}`
  })
  const joined = lines.join('\n')
  return joined.length > 12000 ? joined.slice(joined.length - 12000) : joined
}

/** 同方向连续消息算一段；段数即「来回段数」。 */
function countTurns(msgs: MsgRow[], canned: Set<string>): number {
  let turns = 0
  let prev: string | null = null
  for (const m of msgs) {
    if (isCanned(m, canned)) continue
    if (m.direction !== prev) {
      turns++
      prev = m.direction
    }
  }
  return turns
}

const PRICE_RE = /\$|nzd|usd|rmb|¥|quote|price|报价|运费/i

function hasPriceSignal(msgs: MsgRow[], canned: Set<string>): boolean {
  return msgs.some((m) => m.direction === 'outbound' && !isCanned(m, canned) && PRICE_RE.test(m.body ?? ''))
}

/**
 * 凭据在不在原文里。`quoteIsGrounded` 要求至少 8 个字 —— 而真人常回一个「Sure」「Yes」，
 * 第一轮把一个已经付款、聊了 42 段的客人因为这句短话降了档。短句改成逐字包含即可。
 */
function grounded(quote: string, transcript: string): boolean {
  const q = quote.trim()
  if (q.length === 0) return false
  if (quoteIsGrounded(q, transcript)) return true
  return q.length < 8 && transcript.includes(q)
}

function applyPostChecks(
  verdict: Verdict,
  transcript: string,
  msgs: MsgRow[],
  canned: Set<string>,
): { level: Level; downgraded: boolean; note: string } {
  if (verdict.level !== 'high') return { level: verdict.level, downgraded: false, note: '' }

  const bothGrounded =
    grounded(verdict.customer_quote, transcript) && grounded(verdict.our_quote, transcript)
  if (!bothGrounded) return { level: 'medium', downgraded: true, note: '凭据原话对不上' }

  const turns = countTurns(msgs, canned)
  // 去掉固定回复之后，真人压根没接过话 → 不可能是「双方在推进」。
  if (!msgs.some((m) => m.direction === 'outbound' && !isCanned(m, canned))) {
    return { level: 'medium', downgraded: true, note: '我们这边只有自动回复，没有真人接话' }
  }
  if (!verdict.progression.trim() && turns < 4 && !hasPriceSignal(msgs, canned)) {
    return { level: 'medium', downgraded: true, note: '说不出从哪聊到哪' }
  }
  return { level: 'high', downgraded: false, note: '' }
}

function confusionTable(samples: Sample[]): string {
  const header = `| 原判 \\ 新判 | ${LEVELS.join(' | ')} |`
  const sep = `| --- | ${LEVELS.map(() => '---').join(' | ')} |`
  const rows = LEVELS.map((old) => {
    const cells = LEVELS.map((nw) => {
      const n = samples.filter((s) => s.oldLevel === old && s.newLevel === nw).length
      return String(n)
    })
    return `| ${old} | ${cells.join(' | ')} |`
  })
  return [header, sep, ...rows].join('\n')
}

function disagreementTable(samples: Sample[]): string {
  const head =
    '| 编号 | 原判 | 新判 | 来回段数 | 从哪聊到哪 | 客人原话 | 我们原话 | 理由 |'
  const sep = '| --- | --- | --- | --- | --- | --- | --- | --- |'
  const rows = samples
    .filter((s) => s.oldLevel !== s.newLevel)
    .map((s) =>
      [
        `#${String(s.index).padStart(2, '0')}`,
        s.oldLevel,
        s.newLevel,
        String(s.turns),
        cell(s.progression),
        cell(maskQuote(s.customerQuote)),
        cell(maskQuote(s.ourQuote)),
        cell(s.reason),
      ].join(' | '),
    )
    .map((r) => `| ${r} |`)
  return [head, sep, ...rows].join('\n')
}

function agreementList(samples: Sample[]): string {
  return samples
    .filter((s) => s.oldLevel === s.newLevel)
    .map((s) => `#${String(s.index).padStart(2, '0')} 原判=新判=${s.newLevel}（来回 ${s.turns} 段）`)
    .join('\n')
}

function buildReport(clientId: string, samples: Sample[]): string {
  const total = samples.length
  const agree = samples.filter((s) => s.oldLevel === s.newLevel).length
  const pct = total === 0 ? 0 : Math.round((agree / total) * 100)
  const highToLess = samples.filter((s) => s.oldLevel === 'high' && s.newLevel !== 'high').length
  const lowToHigh = samples.filter(
    (s) => (s.oldLevel === 'low' || s.oldLevel === 'unknown') && s.newLevel === 'high',
  ).length
  const downgraded = samples.filter((s) => s.downgraded).length

  return [
    `# 意图判定校准报告`,
    ``,
    `- 日期：${new Date().toISOString().slice(0, 10)}`,
    `- 客户：${clientId.slice(0, 8)}`,
    `- 模型：${modelName()}`,
    `- 抽样：共 ${total} 段`,
    ``,
    `## 汇总`,
    ``,
    `- 一致：${agree} / ${total}（${pct}%）`,
    `- 原判高 → 新判不到高：${highToLess}`,
    `- 原判低/不确定 → 新判高：${lowToHigh}`,
    `- 被后置检查降档：${downgraded}`,
    ``,
    `### 混淆表`,
    ``,
    confusionTable(samples),
    ``,
    `## 分歧明细`,
    ``,
    disagreementTable(samples),
    ``,
    `## 一致清单`,
    ``,
    agreementList(samples),
    ``,
  ].join('\n')
}

async function judgeOne(
  business: string,
  brief: BriefRow,
  index: number,
  msgs: MsgRow[],
  canned: Set<string>,
): Promise<{ sample: Sample; usage: { input: number; output: number } }> {
  const transcript = buildTranscript(msgs, canned)
  const turns = countTurns(msgs, canned)
  const oldLevel = brief.intent_level ?? 'unknown'
  const base: Sample = {
    index,
    conversationId: brief.conversation_id,
    oldLevel,
    newLevel: 'error',
    turns,
    progression: '',
    customerQuote: '',
    ourQuote: '',
    reason: '',
    downgraded: false,
    downgradeNote: '',
  }
  try {
    const { verdict, usage } = await askModel(business, transcript)
    if (!verdict) return { sample: base, usage }
    const checked = applyPostChecks(verdict, transcript, msgs, canned)
    return {
      sample: {
        ...base,
        newLevel: checked.level,
        progression: verdict.progression,
        customerQuote: verdict.customer_quote,
        ourQuote: verdict.our_quote,
        reason: verdict.reason,
        downgraded: checked.downgraded,
        downgradeNote: checked.note,
      },
      usage,
    }
  } catch (err) {
    console.warn(`[probe] #${index} 判定失败：`, err instanceof Error ? err.message : err)
    return { sample: base, usage: { input: 0, output: 0 } }
  }
}

async function main(): Promise<void> {
  const [clientId, outFile, perLevelArg, unknownArg] = process.argv.slice(2)
  if (!clientId || !outFile) {
    console.error('用法: probe-intent-calibration.ts <clientId> <outFile.md> [perLevel=15] [unknownCount=10]')
    process.exit(1)
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY 未设置')
    process.exit(1)
  }
  const perLevel = Number(perLevelArg ?? 15) || 15
  const unknownCount = Number(unknownArg ?? 10) || 10

  const briefs = await loadBriefs(clientId)
  const picked = pickSample(briefs, perLevel, unknownCount)
  const business = await loadBusinessName(clientId)

  const samples: Sample[] = []
  let inputTokens = 0
  let outputTokens = 0
  // 先把抽到的对话全读进来 —— 认固定回复要跨对话比。
  const allMsgs: MsgRow[][] = []
  for (const b of picked) allMsgs.push(await loadMessages(b.conversation_id))
  const canned = findCanned(allMsgs)
  console.log(`认出固定回复 ${canned.size} 种`)

  for (let i = 0; i < picked.length; i++) {
    const { sample, usage } = await judgeOne(business, picked[i], i + 1, allMsgs[i], canned)
    samples.push(sample)
    inputTokens += usage.input
    outputTokens += usage.output
  }

  await writeFile(outFile, buildReport(clientId, samples), 'utf8')

  const agree = samples.filter((s) => s.oldLevel === s.newLevel).length
  console.log(`抽样 ${samples.length} 段，一致 ${agree} 段`)
  console.log(`报告：${outFile}`)
  console.log(`tokens: input=${inputTokens} output=${outputTokens}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
