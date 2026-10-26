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

/**
 * v4：**模型只报事实，档位由代码按书面规则算**。
 *
 * v2 / v3 让模型直接给「高 / 中 / 低」。实测它在理由里写着「客户提供了具体货物信息」，
 * 档位却照旧给「中」—— 规则写进提示词不等于被执行。把判断拆成几个是 / 否的事实，
 * 规则放在 `levelFromFacts` 里：能逐条核对、能改规则不重跑模型、PM 看得懂凭什么。
 */
const VerdictSchema = z.object({
  /** 垃圾 / 推广 / 发错人 / 跟业务无关（例如来找工作）。 */
  is_spam_or_unrelated: z.boolean(),
  /** 客人说清了具体货物、数量或线路里的至少一样。 */
  customer_gave_specifics: z.boolean(),
  /** 我们（真人，不是固定回复）给过价格或报价。 */
  we_gave_price: z.boolean(),
  /** 约了通话 / 见面 / 上门，或答应了下一步并被接受。 */
  next_step_arranged: z.boolean(),
  /** 已下单 / 已付款 / 在安排发货。 */
  ordered_or_paid: z.boolean(),
  /** 我们明说做不了他要的（线路 / 货类 / 服务），且之后没有另约别的。 */
  we_declined: z.boolean(),
  /** 客人明说先看看 / 暂时不需要。 */
  customer_said_not_now: z.boolean(),
  /** 我们拒绝他的那句原话。`we_declined` 为真时必填，对不上原文就不认这次「做不了」。 */
  decline_quote: z.string(),
  customer_quote: z.string(),
  our_quote: z.string(),
  progression: z.string(),
  reason: z.string(),
})
export type Verdict = z.infer<typeof VerdictSchema>

interface BriefRow {
  conversation_id: string
  intent_level: string | null
  generated_at: string | null
}

export interface MsgRow {
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
export function mask(text: string): string {
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
  return `You read a sales conversation between ${business} ("US") and one prospect ("CUSTOMER") and report FACTS about it. You do not grade it. Answer each yes/no strictly from what is written.

Lines marked "US (auto-reply)" are canned messages (rate cards, welcome text, bot answers). Ignore them completely: they are not us talking, and a rate card is not us giving a price.

- is_spam_or_unrelated: spam, promotion, wrong recipient, job seeker, or nothing to do with ${business}'s business.
- customer_gave_specifics: the CUSTOMER stated at least one concrete thing about THEIR OWN case — the goods, a quantity/weight/size, or a specific city/port/address. A product link or photo they sent counts. NOT specific: "How much is shipping?", "How long does delivery take?", or naming only the countries ${business} always serves anyway (that is everyone's question, not their case).
- we_gave_price: a real person on our side stated an actual price, rate or quote for this customer's case.
- next_step_arranged: a real person on our side and the customer agreed a call, visit, meeting or pickup with a time or place; or a real person on our side promised a concrete next step (e.g. "I'll send the quotation") in reply to the customer's specifics. Asking the customer a question is NOT arranging a next step.
- ordered_or_paid: the customer has ordered, paid, or is arranging an actual shipment with us.
- we_declined: a real person on our side EXPLICITLY said we cannot / do not do what they asked, AND nothing else was arranged afterwards. Asking a screening question ("does it contain batteries?", "what is the weight?") is NOT declining.
- decline_quote: when we_declined is true, copy VERBATIM the US sentence that says we cannot do it. Otherwise empty string.
- customer_said_not_now: the customer's LATEST position is a no — not now / just looking / "I'll be in touch" / too expensive / chose another provider / already sorted.
- customer_quote: copy ONE sentence VERBATIM from a CUSTOMER line that best supports your answers. Character for character; it is checked against the transcript. Empty string if the customer wrote nothing usable.
- our_quote: copy ONE sentence VERBATIM from a "US" line (never an auto-reply). Empty string if no real person on our side said anything relevant.
- progression: SIMPLIFIED CHINESE, one short phrase "从 X 聊到了 Y". Empty string if the conversation did not move forward.
- reason: one short sentence in SIMPLIFIED CHINESE.`
}

const BOOL = { type: 'boolean' } as const
const STR = { type: 'string' } as const
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_spam_or_unrelated', 'customer_gave_specifics', 'we_gave_price', 'next_step_arranged',
    'ordered_or_paid', 'we_declined', 'customer_said_not_now', 'decline_quote',
    'customer_quote', 'our_quote', 'progression', 'reason',
  ],
  properties: {
    is_spam_or_unrelated: BOOL,
    customer_gave_specifics: BOOL,
    we_gave_price: BOOL,
    next_step_arranged: BOOL,
    ordered_or_paid: BOOL,
    we_declined: BOOL,
    customer_said_not_now: BOOL,
    decline_quote: STR,
    customer_quote: STR,
    our_quote: STR,
    progression: STR,
    reason: STR,
  },
} as const

/**
 * 书面规则（v4，按 PM 2026-10-10 的原话 + 六个标注）。从上往下，先中先算：
 *   垃圾 / 无关                         → 不确定
 *   已下单付款 / 真人约了下一步          → 高
 *   客人最后说不要 / 我们明说做不了      → 低（排在下一条前面：给过货物清单但最后说「太贵」的不算）
 *   客人说清了具体货物（哪怕我们还没报价）→ 高（我们欠他一份报价，最该今天动手）
 *   真人来回两轮以上且我们报过价         → 高
 *   真人来回过                          → 中
 *   其余（泛泛一问没下文）               → 低；客人一句能用的话都没有 → 不确定
 */
export function levelFromFacts(v: Verdict, humanTurns: number, customerLines: number): { level: Level; rule: string } {
  if (v.is_spam_or_unrelated) return { level: 'unknown', rule: '垃圾或与业务无关' }
  if (customerLines === 0) return { level: 'unknown', rule: '客人没有可读的话' }
  if (v.ordered_or_paid) return { level: 'high', rule: '已下单 / 已付款 / 在安排发货' }
  // 没有真人接过话，就谈不上「约了下一步」—— 模型把固定回复里的一句反问当成约定过。
  if (v.next_step_arranged && humanTurns >= 2) return { level: 'high', rule: '约了下一步' }
  // 客人最后的态度是「不要」排在「给过具体货物」前面：给过货物清单、最后说「你们太贵」的人不是今天该打的。
  if (v.customer_said_not_now) return { level: 'low', rule: '客人最后说不要 / 暂时不需要' }
  if (v.we_declined) return { level: 'low', rule: '我们做不了他要的' }
  if (v.customer_gave_specifics) {
    return { level: 'high', rule: v.we_gave_price ? '客人给了具体货物，我们已报价' : '客人给了具体货物，我们还欠一份报价' }
  }
  if (humanTurns >= 4 && v.we_gave_price) return { level: 'high', rule: '真人来回两轮以上且报过价' }
  if (humanTurns >= 3) return { level: 'medium', rule: '有来回，但没聊到具体货物' }
  return { level: 'low', rule: '泛泛一问，没有下文' }
}

export async function askModel(
  business: string,
  transcript: string,
): Promise<{ verdict: Verdict | null; usage: { input: number; output: number } }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY 未设置')
  const { getOpenAIClient } = await import('@/lib/ai/openai-client')
  const client = getOpenAIClient({ apiKey, bypassGateway: true })
  const res = await client.responses.create({
    model: modelName(),
    // 固定输出不随机：同一段对话两次跑必须给同样的事实，否则这个判断不能拿来排名单。
    temperature: 0,
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

function pickSample(briefs: BriefRow[], perLevel: number, unknownCount: number, skip = 0): BriefRow[] {
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
    // skip：跳过已经抽过的前 N 个（稳定哈希序）—— 要一批「没用过的」新对话做盲测时用。
    out.push(...list.slice(skip, skip + take))
  }
  return out
}

export async function loadMessages(conversationId: string): Promise<MsgRow[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('direction, body, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(`读对话原文失败: ${error.message}`)
  return ((data ?? []) as MsgRow[]).filter((m) => (m.body ?? '').trim().length > 0)
}

export async function loadBusinessName(clientId: string): Promise<string> {
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
export function findCanned(all: MsgRow[][]): Set<string> {
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

export function isCanned(m: MsgRow, canned: Set<string>): boolean {
  return m.direction === 'outbound' && canned.has(cannedKey(m.body))
}

export function buildTranscript(msgs: MsgRow[], canned: Set<string>): string {
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
export function countTurns(msgs: MsgRow[], canned: Set<string>): number {
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

/**
 * 「我们做不了」站不站得住：拒绝那句原话必须在原文里；而且**拒绝之后我们没再接着办**。
 *
 * 实测（PM 标「该」的第 6 段）：我们说了「带电池的货现在做不了，要电池需 MSDS 证书」，随后
 * 又要货物尺寸、要对方确认报关 —— 那是在继续办，不是收场。拒绝之后还有真人发的实质内容
 * （超过 40 个字）就不算最终拒绝。
 */
function declineStands(quote: string, transcript: string, msgs: MsgRow[], canned: Set<string>): boolean {
  if (!grounded(quote, transcript)) return false
  const needle = quote.trim().toLowerCase().slice(0, 40)
  let at = -1
  msgs.forEach((m, i) => {
    if (m.direction === 'outbound' && (m.body ?? '').toLowerCase().includes(needle)) at = i
  })
  if (at < 0) return true
  return !msgs
    .slice(at + 1)
    .some((m) => m.direction === 'outbound' && !isCanned(m, canned) && (m.body ?? '').trim().length > 40)
}

export function applyPostChecks(
  verdict: Verdict,
  transcript: string,
  msgs: MsgRow[],
  canned: Set<string>,
): { level: Level; downgraded: boolean; note: string } {
  const humanTurns = countTurns(msgs, canned)
  const customerLines = msgs.filter((m) => m.direction === 'inbound').length
  // 「我们做不了」会把人压到低 —— 往下压的结论必须拿得出我们拒绝他的那句原话。
  // 实测：我们问了一句「含不含电池」，模型就读成「我们做不了带电池的货」，把一位发了货物清单的客人判低。
  const facts: Verdict = verdict.we_declined && !declineStands(verdict.decline_quote, transcript, msgs, canned)
    ? { ...verdict, we_declined: false }
    : verdict
  const { level, rule } = levelFromFacts(facts, humanTurns, customerLines)
  if (level !== 'high') return { level, downgraded: false, note: rule }

  // 判高必须拿得出客人原话；我们那句给了就得对得上（没给不强求 —— 欠报价的情形我们可能一句像样的话都没有）。
  const customerOk = grounded(verdict.customer_quote, transcript)
  const oursOk = verdict.our_quote.trim().length === 0 || grounded(verdict.our_quote, transcript)
  if (!customerOk || !oursOk) return { level: 'medium', downgraded: true, note: `${rule}；但凭据原话对不上` }
  return { level: 'high', downgraded: false, note: rule }
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

/** 盲测摘要：每段只给打码后的原文片段 + 双方各说了几句，不含任何判断。 */
function buildDigest(all: MsgRow[][], canned: Set<string>): string {
  const clip = (t: string | null | undefined) => mask((t ?? '').replace(/\s+/g, ' ').trim()).slice(0, 170)
  return all
    .map((msgs, i) => {
      const cust = msgs.filter((m) => m.direction === 'inbound')
      const ours = msgs.filter((m) => m.direction === 'outbound' && !isCanned(m, canned))
      const lines = [
        `#${String(i + 1).padStart(2, '0')}  客人说了 ${cust.length} 句，我们真人说了 ${ours.length} 句`,
        `  客人第一句：${clip(cust[0]?.body)}`,
        `  客人最后一句：${clip(cust[cust.length - 1]?.body)}`,
        `  我们第一句：${clip(ours[0]?.body)}`,
        `  我们最后一句：${clip(ours[ours.length - 1]?.body)}`,
      ]
      return lines.join('\n')
    })
    .join('\n\n')
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
        reason: `【${checked.note}】${verdict.reason}`,
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
  const skip = Number(process.argv[6] ?? 0) || 0
  const picked = pickSample(briefs, perLevel, unknownCount, skip)
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
  // 盲测用的「中性摘要」：只有原文片段，不带任何新旧判断，给 PM 标注时不被答案带偏。
  await writeFile(`${outFile}.digest.md`, buildDigest(allMsgs, canned), 'utf8')
  // 本机用的编号 → 对话 id 对照（含真实 id，只落在 outFile 旁边，别提交、别贴出去）。
  await writeFile(`${outFile}.ids.json`, JSON.stringify(picked.map((b) => b.conversation_id)), 'utf8')

  const agree = samples.filter((s) => s.oldLevel === s.newLevel).length
  console.log(`抽样 ${samples.length} 段，一致 ${agree} 段`)
  console.log(`报告：${outFile}`)
  console.log(`tokens: input=${inputTokens} output=${outputTokens}`)
}

// 被别的脚本 import 时不自动跑（冷名单审计复用这里的判断）。
if (process.argv[1]?.endsWith('probe-intent-calibration.ts')) main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
