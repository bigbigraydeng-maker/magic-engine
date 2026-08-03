/**
 * 把一整通电话的**对话文字**读成系统能用的字段。
 *
 * ## 为什么不能直接复用 note-parser
 *
 * `parseNote` 读的是「销售自己写的一句话」（"voice message 9 July"、
 * "not interested"），它靠一串关键词硬规则定结论，而且**规则的结论压过 AI**。
 * 那套规则用在一整段两个人的对话上会大面积误判，每一条都是真实伤害：
 *
 *   · 对话里出现 "voice message"（销售说「我上周给你留过言」）
 *     → 整通十分钟的电话被判成**没打通**，这个人转头出现在「打过没人接」里
 *   · 客户说「别打我办公室电话，打手机」
 *     → 被判成**永久别再联系**，从此没有任何人会碰他
 *   · 谁随口说一句 "wrong number"
 *     → 这个号码被标成坏号
 *
 * 所以这一层重写三件事：
 *
 * **① 有转写就等于接通了。** `no_answer` / `bad_number` 在这里**永不产生** ——
 * 没接通的电话根本没有对话可转。这不是准确率取舍，是逻辑上不可能。
 *
 * **② 「别再联系」「没兴趣」只认客户说的话。** 同一句话从销售嘴里说出来
 * （「如果您不感兴趣的话我就不打扰了」）意思完全相反。note-parser 里
 * 「宁可多报」是对的（那是销售自己的结论），这里不对：多报 = 一个真实客户
 * 被永久排除，跟漏报一样是真实损失。
 *
 * **③ 分不清谁在说话时，不猜 —— 交给人确认。** 认不出说话人而对话里又出现了
 * 「别再打了」，这一层**不落 DNC**，而是标 `needsReview`，让它进人工待办。
 * 这是 CLAUDE.md 铁律 3 的下半条：确实判不了的，不许烂在日志里。
 *
 * ## 数据来源（三条管子，同一个出口）
 *
 * 销售粘贴的文字 / 上传的录音转写 / 以后电话线路自动送来的转写 —— 三种来料
 * 最后都是「一段两个人的对话」，都从这里过。所以这一层做一次就够。
 */

import {
  cleanCompetitor,
  cleanNullish,
  cleanTravelWindow,
  CTS_BRAND_TERMS,
  saneCallbackInstant,
  type ContactOutcome,
  type NoteParse,
} from './note-parser'

// ── 说话人切分 ──────────────────────────────────────────────────────────────

export interface Turn {
  /** 原文里的说话人标签（「说话人1」「Speaker 2」「张三」）。没有标签就是 null。 */
  label: string | null
  text: string
}

/** 这一句是谁说的。`unknown` 是诚实的答案，不是失败。 */
export type Side = 'customer' | 'agent' | 'unknown'

export interface SidedTurn extends Turn {
  side: Side
}

/**
 * 说话人标签最长这么多字。
 *
 * 卡这个长度是为了不把正文里的冒号当成标签：「他说：我不去了」的「他说」
 * 很短会漏网，但下面还有一道「至少两个不同标签」的闸 —— 正文里偶发的冒号
 * 凑不出两个反复出现的说话人。
 */
const MAX_LABEL_CHARS = 12

/** 行首的说话人标签。允许前面挂一个时间戳（`[00:12]` / `00:12`）或列表符号。 */
const LABEL_LINE =
  /^\s*(?:[-–—•*]\s*)?(?:\[?\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]?\s*)?([^：:\n]{1,12})\s*[：:]\s*([\s\S]*)$/

/** 标签里不该出现的东西 —— 出现了就说明这是正文，不是说话人。 */
const NOT_A_LABEL = /[。！？!?,，、；;]/

/**
 * 把转写切成一句一句，尽量认出说话人标签。
 *
 * **认不出标签不是错误**：很多识别 App 不做说话人分离，输出一整段没有标签的
 * 文字。那种情况下每一行都是一个 `label: null` 的 turn，后面的判断会据此
 * 保守处理（见 `assignSides`）。
 */
export function splitTurns(raw: string): Turn[] {
  const lines = raw.split(/\r?\n/)
  const turns: Turn[] = []

  for (const line of lines) {
    if (!line.trim()) continue
    const m = LABEL_LINE.exec(line)
    const label = m?.[1]?.trim()

    if (m && label && label.length <= MAX_LABEL_CHARS && !NOT_A_LABEL.test(label)) {
      turns.push({ label, text: (m[2] ?? '').trim() })
      continue
    }

    // 没有标签：接在上一句后面（换行的续行），或者自成一句。
    const prev = turns[turns.length - 1]
    if (prev && prev.label !== null) prev.text = `${prev.text} ${line.trim()}`.trim()
    else if (prev && prev.label === null) prev.text = `${prev.text} ${line.trim()}`.trim()
    else turns.push({ label: null, text: line.trim() })
  }

  return turns.filter((t) => t.text.length > 0)
}

/**
 * 这段转写到底有没有分说话人。
 *
 * 判据是**至少两个不同标签**：一个标签反复出现说明那是正文里的固定说法
 * （「备注：…」），两个以上交替出现才是真的对话。
 */
export function hasSpeakerLabels(turns: Turn[]): boolean {
  const labels = new Set(turns.map((t) => t.label).filter((l): l is string => l !== null))
  return labels.size >= 2
}

/**
 * 判定每一句是谁说的。
 *
 * 只用**确定性的证据**，不猜：
 *   · 标签就是我们自己人的名字 → agent
 *   · 标签里出现客户公司的品牌词（「CTS 客服」）→ agent
 *   · 其余标签 → customer
 *
 * 两方对话里，排除掉我们自己人，剩下的就是客户 —— 这个推断只在**认出了
 * 我们自己人**的前提下成立。一个都没认出来（销售没在客户设置里登记名字、
 * 或者识别 App 只给「说话人1/2」）时全部返回 `unknown`：
 * **宁可说不知道，也不能把销售说的话当成客户说的。**
 *
 * @param agentNames 我们自己人的名字（客户设置里那个固定打电话的人）
 * @param brandTerms 客户自己的品牌词
 */
export function assignSides(
  turns: Turn[],
  agentNames: string[] = [],
  brandTerms: string[] = CTS_BRAND_TERMS,
): SidedTurn[] {
  if (!hasSpeakerLabels(turns)) return turns.map((t) => ({ ...t, side: 'unknown' as const }))

  const needles = [...agentNames, ...brandTerms]
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length >= 2)

  const isAgentLabel = (label: string): boolean => {
    const low = label.toLowerCase()
    return needles.some((n) => low.includes(n) || n.includes(low))
  }

  const agentLabels = new Set(
    turns
      .map((t) => t.label)
      .filter((l): l is string => l !== null)
      .filter(isAgentLabel),
  )

  // 一个自己人都没认出来 → 剩下的谁是客户就无从谈起。全部 unknown。
  if (agentLabels.size === 0) return turns.map((t) => ({ ...t, side: 'unknown' as const }))

  return turns.map((t) => ({
    ...t,
    side: t.label === null ? 'unknown' : agentLabels.has(t.label) ? 'agent' : 'customer',
  }))
}

// ── 规则层：只认客户说的话 ──────────────────────────────────────────────────

/**
 * 客户明确划清界限的说法。
 *
 * 比 note-parser 那组**收紧**了：那边读的是销售的结论（「客户说不要电话」），
 * 宽一点无所谓；这边读的是对话原文，宽一点就会把客户随口一句
 * 「今天不方便讲电话」判成永久拒绝。所以这里只留意思无歧义的说法。
 */
const DNC_PATTERNS: RegExp[] = [
  /别再(打|联系|发)/,
  /不要再(打|联系|发)/,
  /以后别(打|联系)/,
  /把我(从名单里)?(删|移)(掉|除)/,
  /退订/,
  /take\s*me\s*off\s*(your|the)\s*list/i,
  /remove\s*me\s*from\s*(your|the)\s*(list|database)/i,
  /(do\s*not|don'?t)\s*(call|contact|phone)\s*me\s*(again|any\s*more|anymore)/i,
  /stop\s*calling\s*me/i,
  /unsubscribe/i,
]

/** 客户明确说不买。同样收紧 —— 「我再想想」不算。 */
const NOT_INTERESTED_PATTERNS: RegExp[] = [
  /不感兴趣/,
  /没(有)?兴趣/,
  /不想去(了)?/,
  /不打算去/,
  /不考虑(了)?/,
  /已经(在)?(别|另|其他).{0,3}家(订|预订|报名|买)/,
  /(找|换)了(别|另|其他).{0,3}家/,
  /not\s*interested/i,
  /(already|have)\s*booked\s*(with|through)/i,
]

/** 约了下次。谁提的都算 —— 双方谈定的时间不存在「立场」问题。 */
const CALLBACK_PATTERNS: RegExp[] = [
  /(再|下次|回头).{0,4}(打|联系|电话)/,
  /(周|星期|礼拜)[一二三四五六日天]/,
  /call\s*(you|me)\s*(back|on|next|tomorrow)/i,
  /\bcall\s*back\b/i,
]

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

export interface RuleReading {
  /** 客户自己说的「别再联系」。分不清谁说的时**永远是 false**。 */
  doNotContact: boolean
  /** 客户自己说的「不买了」。 */
  notInterested: boolean
  /** 对话里谈到了下次联系。 */
  callbackMentioned: boolean
  /**
   * 「像是拒绝，但认不出是谁说的」。
   *
   * 有值就必须让人看一眼 —— 落成 DNC 可能冤枉一个真客户，忽略掉可能继续
   * 骚扰一个说过别打的人。两边都是真实损失，所以这一层**不替人做这个决定**。
   */
  needsReview: string | null
}

/**
 * 规则能确定的部分。
 *
 * 核心一条：**拒绝类的判断只看 `side === 'customer'` 的句子。**
 * 销售说的话里出现同样的词，意思往往相反（「如果您不感兴趣我就不打扰了」）。
 */
export function readByRules(turns: SidedTurn[]): RuleReading {
  const said = (side: Side) =>
    turns.filter((t) => t.side === side).map((t) => t.text).join('\n')

  const customer = said('customer')
  const unknown = said('unknown')
  const whole = turns.map((t) => t.text).join('\n')

  const dncFromCustomer = anyMatch(customer, DNC_PATTERNS)
  // 认不出说话人、但对话里确实有拒绝的说法 —— 交给人，不自己拍。
  const dncUnattributed = !dncFromCustomer && anyMatch(unknown, DNC_PATTERNS)

  return {
    doNotContact: dncFromCustomer,
    notInterested: anyMatch(customer, NOT_INTERESTED_PATTERNS),
    callbackMentioned: anyMatch(whole, CALLBACK_PATTERNS),
    needsReview: dncUnattributed
      ? '这通电话里有人说了「别再联系」，但分不清是客户说的还是我们自己人说的 —— 需要你听一下再定'
      : null,
  }
}

// ── AI 层 ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You read a transcript of ONE phone call between a New Zealand travel agency salesperson and a customer, about China tours. The transcript may be in Chinese, English, or both. It may or may not have speaker labels.

Return JSON. Rules:

- summary: 2-4 short sentences in SIMPLIFIED CHINESE, plain language, for another salesperson who did not hear the call. Lead with what was AGREED or DECIDED. Never start with the greeting.
- outcome: "callback_set" only if a specific next contact was agreed. "not_interested" only if the CUSTOMER said they will not buy. "do_not_contact" only if the CUSTOMER asked not to be contacted again. Otherwise "spoke".
- travel_window: when the CUSTOMER said they travel, in their own terms ("明年三月", "2027 年底"). Null if never said.
- tour_interest: tour name in ENGLISH exactly as spoken ("Best of China", "Silk Road"). Null if none named.
- competitor: a RIVAL travel company the customer says they used, booked with, or got a quote from. Null if none.
- callback_at: only when a specific date/time was agreed AND you can express it as an ISO 8601 instant. Vague "next week" is null.
- open_questions: things the customer asked that were NOT answered on the call, each one short, in Chinese. Empty array if none.

CRITICAL — WHO SAID IT DECIDES THE MEANING:
The salesperson also says things like "if you're not interested I won't bother you" and "don't want to keep calling you". Those are the AGENT talking. They are NOT the customer declining. Only the CUSTOMER's own words set not_interested or do_not_contact. If you cannot tell who is speaking, set both to false and say so in summary.

NEVER INVENT. A transcript is noisy — misheard words are common. If a number, date or name is unclear, leave the field null rather than guessing.

THESE TOUR NAMES BELONG TO THE AGENCY ITSELF, NOT A COMPETITOR: Best of China, Tale of Two Cities, Silk Road, China Panorama, China Legacy, China Discovery.`

const TRANSCRIPT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', enum: ['spoke', 'callback_set', 'not_interested', 'do_not_contact'] },
    do_not_contact: { type: 'boolean' },
    travel_window: { type: ['string', 'null'] },
    tour_interest: { type: ['string', 'null'] },
    competitor: { type: ['string', 'null'] },
    callback_at: { type: ['string', 'null'] },
    summary: { type: 'string' },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'outcome',
    'do_not_contact',
    'travel_window',
    'tour_interest',
    'competitor',
    'callback_at',
    'summary',
    'open_questions',
  ],
} as const

export interface TranscriptParse extends NoteParse {
  /** 客户当场问了、但电话里没答上来的问题。销售回头要跟进的就是这些。 */
  open_questions: string[]
  /** 需要人确认的地方。null = 不用管。 */
  needsReview: string | null
  /** 这段转写有没有分出说话人 —— 决定上面那些判断有多可信，页面要如实显示。 */
  speakersIdentified: boolean
}

export interface ParseTranscriptOptions {
  /** 我们自己人的名字（客户设置里那个固定打电话的人）。 */
  agentNames?: string[]
  brandTerms?: string[]
  now?: Date
}

/**
 * 规则读出来的东西 → CRM 的那套结论词。
 *
 * 注意这里**没有** `no_answer` 和 `bad_number`：有对话可读就说明电话接通了。
 * note-parser 那边能产生这两个，是因为它读的是销售写的「voice message」；
 * 这里读的是通话内容本身，那两个结论在逻辑上不可能成立 —— 让它们能被产生，
 * 只会让一通聊了十分钟的电话被判成没打通，然后这个人从「还没搭上话」里消失。
 */
export function outcomeFromRules(r: RuleReading): ContactOutcome {
  if (r.doNotContact) return 'do_not_contact'
  if (r.notInterested) return 'not_interested'
  if (r.callbackMentioned) return 'callback_set'
  return 'spoke'
}

/** 摘要兜底。**绝不**拿开头几十个字充数 —— 那是「喂你好我是……」。 */
function fallbackSummary(turns: SidedTurn[], speakersIdentified: boolean): string {
  const n = turns.length
  const who = speakersIdentified ? '' : '（这段录音没分出谁在说话）'
  return `通话记录已存下，共 ${n} 句，还没生成摘要${who} —— 点开可以看全文。`
}

/**
 * 读一整通电话。
 *
 * 规则和 AI 的分工跟 note-parser 一致，但**边界不同**：
 *   规则  决定 `do_not_contact` / `not_interested` 的**上限** —— 只有客户
 *         自己说了，才可能为真。AI 说了不算数，除非说话人是分得清的。
 *   AI    负责摘要、出行时间、团名、竞品、约的时间、没答上来的问题。
 *
 * AI 挂掉不会让这条记录丢：退回规则版本，摘要如实说「还没生成」。
 * 电话内容本身已经原样存下来了，摘要以后可以重跑。
 */
export async function parseTranscript(
  raw: string,
  opts: ParseTranscriptOptions = {},
): Promise<TranscriptParse> {
  const now = opts.now ?? new Date()
  const brandTerms = opts.brandTerms ?? CTS_BRAND_TERMS
  const turns = assignSides(splitTurns(raw), opts.agentNames ?? [], brandTerms)
  const speakersIdentified = turns.some((t) => t.side !== 'unknown')
  const rules = readByRules(turns)

  const base: TranscriptParse = {
    outcome: outcomeFromRules(rules),
    do_not_contact: rules.doNotContact,
    travel_window: null,
    tour_interest: null,
    competitor: null,
    callback_at: null,
    summary: fallbackSummary(turns, speakersIdentified),
    open_questions: [],
    needsReview: rules.needsReview,
    speakersIdentified,
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !raw.trim()) return base

  try {
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey })
    const res = await client.responses.create({
      // 整通对话比一句备注难读得多，用大一档的模型。
      model: process.env.CRM_TRANSCRIPT_MODEL ?? 'gpt-4o',
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: renderForModel(turns) },
      ],
      text: { format: { type: 'json_schema', name: 'crm_transcript', schema: TRANSCRIPT_JSON_SCHEMA } },
    } as Parameters<typeof client.responses.create>[0])

    const ai = JSON.parse((res as { output_text?: string }).output_text ?? '{}') as Partial<{
      travel_window: string | null
      tour_interest: string | null
      competitor: string | null
      callback_at: string | null
      summary: string
      open_questions: string[]
      do_not_contact: boolean
      outcome: string
    }>

    return mergeAi(base, ai, { now, brandTerms, speakersIdentified, rules })
  } catch {
    // AI 挂了不能让这通电话丢。原文已经存下来，摘要以后能重跑。
    return base
  }
}

/** 送给模型的样子：认出来的说话人换成「我们」「客户」，认不出的如实标。 */
function renderForModel(turns: SidedTurn[]): string {
  return turns
    .map((t) => {
      const who = t.side === 'agent' ? '销售' : t.side === 'customer' ? '客户' : (t.label ?? '?')
      return `${who}: ${t.text}`
    })
    .join('\n')
}

/**
 * 把 AI 读出来的东西并进规则版本。
 *
 * **规则决定拒绝类结论的上限**，AI 只能在说话人分得清的前提下往上加：
 *
 *   · 规则说客户拒了 → 就是拒了，AI 说不算数
 *   · 规则没说、AI 说拒了、**且说话人分得清** → 采信 AI
 *   · 规则没说、AI 说拒了、**但说话人分不清** → 不落，标 needsReview 交给人
 *
 * 最后一条是这一层最要紧的地方。分不清谁在说话时采信 AI，等于让模型去猜
 * 「不感兴趣我就不打扰您了」是销售的客套还是客户的拒绝 —— 猜错就把一个真
 * 客户永久排除，而且没有任何人会发现。
 */
function mergeAi(
  base: TranscriptParse,
  ai: Partial<{
    travel_window: string | null
    tour_interest: string | null
    competitor: string | null
    callback_at: string | null
    summary: string
    open_questions: string[]
    do_not_contact: boolean
    outcome: string
  }>,
  ctx: { now: Date; brandTerms: string[]; speakersIdentified: boolean; rules: RuleReading },
): TranscriptParse {
  const { now, brandTerms, speakersIdentified, rules } = ctx
  const terms = brandTerms.map((b) => b.toLowerCase())

  const aiDnc = ai.do_not_contact === true || ai.outcome === 'do_not_contact'
  const aiNotInterested = ai.outcome === 'not_interested'
  // 说话人分不清时 AI 的拒绝判断一律不采信 —— 它跟规则一样没有归属信息。
  const trustAiRefusal = speakersIdentified

  const merged: RuleReading = {
    doNotContact: rules.doNotContact || (trustAiRefusal && aiDnc),
    notInterested: rules.notInterested || (trustAiRefusal && aiNotInterested),
    callbackMentioned: rules.callbackMentioned || ai.outcome === 'callback_set',
    needsReview:
      rules.needsReview ??
      (!trustAiRefusal && (aiDnc || aiNotInterested)
        ? '这通电话听起来像是客户拒绝了，但分不清是谁说的 —— 需要你听一下再定'
        : null),
  }

  const summary = ai.summary?.trim()

  return {
    outcome: outcomeFromRules(merged),
    do_not_contact: merged.doNotContact,
    travel_window: cleanTravelWindow(ai.travel_window ?? null, now),
    tour_interest: cleanNullish(ai.tour_interest ?? null),
    competitor: cleanCompetitor(ai.competitor ?? null, terms),
    callback_at: saneCallbackInstant(cleanNullish(ai.callback_at ?? null), now),
    summary: summary && summary.length > 0 ? summary : base.summary,
    open_questions: (ai.open_questions ?? [])
      .map((q) => (typeof q === 'string' ? q.trim() : ''))
      .filter((q) => q.length > 0)
      .slice(0, 10),
    needsReview: merged.needsReview,
    speakersIdentified,
  }
}
