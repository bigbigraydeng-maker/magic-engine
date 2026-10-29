/**
 * 通话分析的数据形状。
 *
 * 原则：每一条「事实」必须带原话（quote）。原话在转写文本里找不到的事实一律丢弃——
 * 模型编的东西不能进客户记录。摘要只是「待复核的概述」，不当事实用。
 */

import { z } from 'zod'

/** CTS（旅游）关心的信息种类；行业差异走这个枚举的版本，不进共享流水线。 */
export const FACT_KEYS = [
  'destination_or_tour', // 团型 / 目的地
  'travel_window', // 出发时间（客人原话的意思）
  'party_size', // 人数
  'budget', // 预算（含币种）
  'concern', // 顾虑
  'competitor', // 提到的竞品
  'decision_maker', // 谁拍板
  'next_step', // 约定的下一步
  'callback_time', // 约定回电时间
  'do_not_contact', // 客人要求别再联系
  'contact_email', // 通话中明确提供的邮箱（候选值，人工复核后才算数）
  'not_ready_now', // 客人说现在还没准备好 / 改天再说 / 以后再说
  'not_interested', // 客人明确说不感兴趣 / 不考虑
] as const
export type FactKey = (typeof FACT_KEYS)[number]

/**
 * 客人在电话里对「现在要不要继续谈」的表态。CRM 分段靠它别把刚说过「改天再说」的人当热线索
 * （PM 2026-10-29 Gavin Hall：37 秒通话，客人说 "I'm not ready for that. I'll talk to you another day."）。
 */
export const STANCE_FACT_KEYS: ReadonlySet<FactKey> = new Set<FactKey>(['not_ready_now', 'not_interested'])

/** Version 2 adds sourced questions; completed version 1 analyses are not backfilled automatically. */
export const ANALYSIS_SCHEMA_VERSION = 2

const INQUIRY_TOPICS = ['tour_departures', 'availability', 'pricing', 'itinerary', 'other'] as const
const QUESTION_SPEAKERS = ['customer', 'employee', 'unclear'] as const
const ANSWER_SPEAKERS = ['customer', 'employee', 'unclear'] as const
const ANSWER_STATUSES = ['answered', 'not_stated', 'unclear'] as const

export const RawInquirySchema = z.object({
  topic: z.enum(INQUIRY_TOPICS),
  month: z.number().int().min(1).max(12).nullable(),
  question: z.string().min(1).max(300),
  questionQuote: z.string().min(1).max(500),
  questionSpeaker: z.enum(QUESTION_SPEAKERS),
  answer: z.string().max(500).nullable(),
  answerQuote: z.string().max(500).nullable(),
  answerSpeaker: z.enum(ANSWER_SPEAKERS).nullable(),
  answerStatus: z.enum(ANSWER_STATUSES),
  departureCount: z.number().int().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
})
export type RawInquiry = z.infer<typeof RawInquirySchema>

export const RawFactSchema = z.object({
  key: z.enum(FACT_KEYS),
  value: z.string().min(1).max(300),
  quote: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  speaker: z.enum(QUESTION_SPEAKERS).optional(),
})
export type RawFact = z.infer<typeof RawFactSchema>

export const RawAnalysisSchema = z.object({
  summary: z.string().max(1200),
  language: z.string().max(40).nullable().default(null),
  facts: z.array(RawFactSchema).max(40).default([]),
  inquiries: z.array(RawInquirySchema).max(40).default([]),
  /** Invalid model rows are counted here so they remain visible after parsing. */
  parseDroppedInquiries: z.number().int().min(0).default(0),
})
type ParsedRawAnalysis = z.infer<typeof RawAnalysisSchema>
export type RawAnalysis = Omit<ParsedRawAnalysis, 'inquiries' | 'parseDroppedInquiries'> & {
  inquiries?: RawInquiry[]
  parseDroppedInquiries?: number
}

export interface VerifiedAnalysis {
  summary: string
  language: string | null
  facts: RawFact[]
  inquiries: RawInquiry[]
  /** 因为原话在转写里找不到而被丢掉的条数（可见，不静默）。 */
  droppedFacts: number
  /** 原话、说话人或答复结构无法核实的问题条数。 */
  droppedInquiries: number
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\u3000"'“”‘’.,，。!！?？、:;；]+/g, '')

const CJK = /[\u4e00-\u9fff]/g

/**
 * 原话够不够分量：中文至少 4 个字、其余语言归一化后至少 10 个字符。
 * （「好的」「ok」「是的」「yes please」这类应答不能当证据；但「我们三个人」「两万纽币」这种短而有信息的中文能过。）
 */
export function quoteLongEnough(normalised: string): boolean {
  const cjk = (normalised.match(CJK) ?? []).length
  return cjk > 0 ? normalised.length >= 4 : normalised.length >= 10
}

const ENGLISH_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
}
const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** 抽出文本里出现的数字（阿拉伯数字、k/万/千 简写、英文数字词、常见中文数字）。9 位以上的连续数字当电话号码，不算金额/人数。 */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>()
  const t = text.toLowerCase()
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)*)\s*(k|万|千|w)?/g)) {
    if (m[1].replace(/[.,]/g, '').length >= 9) continue
    const base = Number(m[1].replace(/,/g, ''))
    if (!Number.isFinite(base)) continue
    out.add(base)
    if (m[2] === 'k' || m[2] === '千') out.add(base * 1000)
    if (m[2] === '万' || m[2] === 'w') out.add(base * 10000)
  }
  for (const [w, n] of Object.entries(ENGLISH_NUMBERS)) if (new RegExp(`\\b${w}\\b`).test(t)) out.add(n)
  for (const m of t.matchAll(/([零一二两三四五六七八九十]+)([万千百]?)/g)) {
    const digits = [...m[1]].map((c) => CN_DIGIT[c])
    let n = 0
    if (digits.length === 1) n = digits[0]
    else if (digits[0] === 10) n = 10 + (digits[1] ?? 0)
    else if (digits.length === 2 && digits[1] === 10) n = digits[0] * 10
    else n = Number(digits.join(''))
    const unit = m[2] === '万' ? 10000 : m[2] === '千' ? 1000 : m[2] === '百' ? 100 : 1
    out.add(n * unit)
  }
  return out
}

const CURRENCIES: Record<string, string[]> = {
  NZD: ['nzd', 'nz$', 'nz dollar', '纽币', '新西兰元', '纽元'],
  USD: ['usd', 'us$', 'us dollar', '美元', '美金', '刀'],
  CNY: ['cny', 'rmb', '人民币', '块钱'],
  AUD: ['aud', 'au$', 'australian dollar', '澳元', '澳币'],
}
const currenciesIn = (text: string): string[] => {
  const t = text.toLowerCase()
  return Object.entries(CURRENCIES).filter(([, toks]) => toks.some((k) => t.includes(k))).map(([c]) => c)
}
const AMOUNT_CUE = /预算|budget|dollar|bucks|\$|万|k\b|元|块/i
const PEOPLE_CUE = /people|person|persons|adult|adults|kids|children|child|pax|travell?ers|guests|位|个人|人|口/i
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
const SPOKEN_EMAIL_CUE = /e-?mail|email address|(?:my|your) address|邮箱|电邮/i
const COUNT_TOKEN = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|[零一二两三四五六七八九十]+)`
const ENGLISH_TOUR_UNIT = String.raw`(?:tours?|groups?|departures?|coaches)`
const EXPLICIT_EN_DEPARTURE_COUNT = new RegExp(String.raw`\b(${COUNT_TOKEN})\s+${ENGLISH_TOUR_UNIT}\b`, 'gi')
const EXPLICIT_CN_DEPARTURE_COUNT = new RegExp(String.raw`(${COUNT_TOKEN})\s*(?:个)?(?:团|班期|班次)`, 'gi')
const SHORT_COUNT_REPLY = new RegExp(String.raw`^(?:(?:we\s+(?:have|will\s+have|run|will\s+run)|there\s+(?:are|is)|only|in\s+total|total\s+of)\s+)?(${COUNT_TOKEN})$`, 'i')
const MONTH_ALIASES: Record<number, string[]> = {
  1: ['january', 'jan', '1月', '一月'], 2: ['february', 'feb', '2月', '二月'],
  3: ['march', 'mar', '3月', '三月'], 4: ['april', 'apr', '4月', '四月'],
  5: ['may', '5月', '五月'], 6: ['june', 'jun', '6月', '六月'],
  7: ['july', 'jul', '7月', '七月'], 8: ['august', 'aug', '8月', '八月'],
  9: ['september', 'sep', 'sept', '9月', '九月'], 10: ['october', 'oct', '10月', '十月'],
  11: ['november', 'nov', '11月', '十一月'], 12: ['december', 'dec', '12月', '十二月'],
}
const TOUR_COUNT_CUE = /\b(?:tour|group|departure|coach)s?\b|团|班期|班次/i

const NUMERIC_KEYS: ReadonlySet<FactKey> = new Set<FactKey>(['budget', 'party_size'])
/** 第一人称的拒绝联系（不是任何含 stop/别再 的句子）。 */
const NEGATION = /(don'?t|do not|please don'?t|stop)\s+(call|calling|contact|contacting|ring|phone)\s+(me|us)\b|别再(给我|联系我|打给我|打电话)|不要再(给我|联系我|打电话)|不用再(联系|打电话)|请勿(再)?联系(我|我们)|remove (me|my number|us) from/i
const QUESTION = /[?？]|什么意思|为什么|why\b|是什么/i
/**
 * 表态原话必须是第一人称（I / I'm / I'll / we / we're / 我 / 我们）。
 * 员工说的「No worries if you're not ready yet」「你现在还没准备好吗」不能算成客人的表态
 * ——模型标的 speaker 不一定可靠（复审 2026-10-29）。
 */
const FIRST_PERSON = /\b(?:i|we)\b|我/i
/** 一行转写以问号结尾，或中文以 吗/呢/么 收尾（标点可有可无）—— 这一行是问句。 */
const QUESTION_LINE_END = /(?:[?？]|[吗呢么][。.!！]?)["'”’」』\s]*$/

const CHANNEL_PREFIX = /^\s*(声道\d+)[：:]\s*/

/**
 * 原话在转写里落在哪几行（最短的连续几行，且**同一个声道**——不许把员工的半句和客人的半句拼成一句）。
 * 转写按句换行，「I'm not ready for that. I'll talk to you another day.」可能占两行；
 * 行首的「声道N：」不算原话内容。norm() 会去掉问号，所以「是不是问句」必须回到原行看。
 */
function linesContaining(transcript: string, quoteNorm: string): string[] | null {
  const lines = transcript.split('\n').map((raw) => {
    const ch = raw.match(CHANNEL_PREFIX)?.[1] ?? ''
    const text = raw.replace(CHANNEL_PREFIX, '')
    return { ch, text, n: norm(text) }
  })
  for (let i = 0; i < lines.length; i++) {
    let joined = ''
    for (let j = i; j < lines.length && lines[j].ch === lines[i].ch; j++) {
      joined += lines[j].n
      if (!joined.includes(quoteNorm)) continue
      // 从下一行开始也能找到 → i 这行不是起点，留给后面更短的那一段
      if (j > i && lines.slice(i + 1, j + 1).map((l) => l.n).join('').includes(quoteNorm)) break
      return lines.slice(i, j + 1).map((l) => l.text)
    }
  }
  return null
}

/** 表态事实：原话所在的转写行不能是问句（模型可能把问号去掉再交回来）。 */
function stanceSupported(f: RawFact, transcript: string): boolean {
  const run = linesContaining(transcript, norm(f.quote))
  if (!run) return false
  return !run.some((line) => QUESTION_LINE_END.test(line.trim()))
}

/** 数值类事实：值里的数字必须有原话依据，且原话要像金额/人数，不是电话号码、日期、钟点。「别再联系」必须是第一人称的陈述句。 */
function valueSupported(f: RawFact): boolean {
  if (f.key === 'do_not_contact') return NEGATION.test(f.quote) && !QUESTION.test(f.quote)
  if (f.key === 'contact_email') return f.speaker === 'customer' && emailSupported(f.value, f.quote)
  // 表态还要对照转写原句再判一次是不是问句，见 stanceSupported（在 verifyFacts 里做）。
  if (STANCE_FACT_KEYS.has(f.key)) return !QUESTION.test(f.quote) && FIRST_PERSON.test(f.quote)
  if (!NUMERIC_KEYS.has(f.key)) return true
  const need = [...numbersIn(f.value)]
  if (need.length === 0 || need.some((n) => n > 10_000_000)) return false
  const have = numbersIn(f.quote)
  if (!need.every((n) => have.has(n))) return false
  if (f.key === 'party_size') return PEOPLE_CUE.test(f.quote) && need.every((n) => n <= 99)
  // budget：原话必须有金额线索；值里写了币种，原话里必须有对应币种（不许把纽币改成美元）
  const quoteCur = currenciesIn(f.quote)
  const valueCur = currenciesIn(f.value)
  if (valueCur.length > 0 && !valueCur.every((c) => quoteCur.includes(c))) return false
  return AMOUNT_CUE.test(f.quote) || quoteCur.length > 0
}

function normaliseEmailEvidence(text: string): string {
  const tokens = text.toLowerCase()
    .replace(/\b(?:at\s+sign|at)\b/g, ' @ ')
    .replace(/\b(?:dot|period)\b/g, ' . ')
    .replace(/\bunderscore\b/g, ' _ ')
    .replace(/\b(?:hyphen|dash)\b/g, ' - ')
    .replace(/\bplus\b/g, ' + ')
    .replace(/[^a-z0-9@._%+-]+/g, ' ')
    .trim()
    .split(/\s+/)
  const result: string[] = []
  let spelledLetters: string[] = []
  const flush = () => {
    if (spelledLetters.length > 1) result.push(spelledLetters.join(''))
    else if (spelledLetters.length === 1) result.push(spelledLetters[0])
    spelledLetters = []
  }
  for (const token of tokens) {
    if (/^[a-z0-9]$/.test(token)) {
      spelledLetters.push(token)
    } else {
      flush()
      result.push(token)
    }
  }
  flush()
  return result.join(' ')
}

function emailSupported(value: string, quote: string): boolean {
  const email = value.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return false
  const directAddress = quote.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]
  if (directAddress?.toLowerCase() === email) return true
  const spokenAddress = normaliseEmailEvidence(
    email.replace('@', ' @ ').replace(/\./g, ' . ').replace(/_/g, ' _ ').replace(/-/g, ' - ').replace(/\+/g, ' + '),
  )
  return SPOKEN_EMAIL_CUE.test(quote) && ` ${normaliseEmailEvidence(quote)} `.includes(` ${spokenAddress} `)
}

function monthSupported(month: number, quote: string): boolean {
  const raw = quote.toLowerCase()
  const normalised = norm(quote)
  return (MONTH_ALIASES[month] ?? []).some((alias) => {
    if (month === 5 && alias === 'may') {
      // “May” is also a modal verb; require a month-like preposition or a tour/date noun.
      return /\b(?:in|for|during|of|from|through|until|by)\s+may\b|\bmay\s+(?:\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{4}|tours?|groups?|departures?|coaches|trips?|holidays?|dates?)\b/i.test(raw)
    }
    return /^[a-z]+$/i.test(alias)
      ? new RegExp(`\\b${alias}\\b`, 'i').test(raw)
      : normalised.includes(norm(alias))
  })
}

function monthsMentioned(text: string): number[] {
  return Object.keys(MONTH_ALIASES).map(Number).filter((month) => monthSupported(month, text))
}

function withoutMonths(text: string): string {
  return Object.values(MONTH_ALIASES).flat().reduce((cleaned, alias) => {
    const pattern = /^[a-z]+$/i.test(alias) ? new RegExp(`\\b${alias}\\b`, 'gi') : null
    return pattern ? cleaned.replace(pattern, ' ') : cleaned.replaceAll(alias, ' ')
  }, text)
}

function explicitDepartureCounts(text: string): number[] {
  const matches = [
    ...[...text.matchAll(EXPLICIT_EN_DEPARTURE_COUNT)].map((match) => match[1]),
    ...[...text.matchAll(EXPLICIT_CN_DEPARTURE_COUNT)].map((match) => match[1]),
  ]
  return matches.flatMap((token) => [...numbersIn(token)])
}

function isShortCountReply(text: string, count: number): boolean {
  const cleaned = withoutMonths(text)
    .replace(/\b(?:in|for|during)\b/gi, ' ')
    .replace(/[.,!?;:，。！？]/g, ' ')
    .trim()
  const match = cleaned.match(SHORT_COUNT_REPLY)
  return Boolean(match && numbersIn(match[1]).has(count))
}

function verifiedDepartureCount(inquiry: RawInquiry): number | null {
  if (inquiry.topic !== 'tour_departures' || inquiry.departureCount === null || !inquiry.answerQuote) return null
  if (inquiry.answerSpeaker !== 'employee') return null
  if (!TOUR_COUNT_CUE.test(`${inquiry.questionQuote} ${inquiry.answerQuote}`)) return null
  if (explicitDepartureCounts(inquiry.answerQuote).includes(inquiry.departureCount)) return inquiry.departureCount
  return isShortCountReply(inquiry.answerQuote, inquiry.departureCount) ? inquiry.departureCount : null
}

function verifyInquiry(inquiry: RawInquiry, transcriptNorm: string): RawInquiry | null {
  const question = norm(inquiry.questionQuote)
  if (!quoteLongEnough(question) || !transcriptNorm.includes(question) || inquiry.questionSpeaker === 'employee') return null
  const answerQuote = inquiry.answerQuote && transcriptNorm.includes(norm(inquiry.answerQuote)) ? inquiry.answerQuote : null
  const monthQuote = `${inquiry.questionQuote} ${answerQuote ?? ''}`
  const month = inquiry.month !== null && monthSupported(inquiry.month, monthQuote) ? inquiry.month : null
  const answerValid = inquiry.answerStatus === 'answered' && answerQuote !== null && Boolean(inquiry.answer?.trim()) && inquiry.answerSpeaker !== null
  const answerMonths = answerQuote ? monthsMentioned(answerQuote) : []
  const answerMatchesMonth = inquiry.topic !== 'tour_departures' || month === null || answerMonths.length === 0 || answerMonths.every((mentioned) => mentioned === month)
  const answerStatus = inquiry.answerStatus === 'not_stated' ? 'not_stated' : answerValid && answerMatchesMonth ? 'answered' : 'unclear'
  const answerSpeaker = answerStatus === 'not_stated' ? null : inquiry.answerSpeaker
  const departureCount = answerStatus === 'answered' ? verifiedDepartureCount({ ...inquiry, answerQuote }) : null
  return {
    ...inquiry,
    month,
    answer: answerStatus === 'not_stated' ? null : inquiry.answer,
    answerQuote: answerStatus === 'not_stated' ? null : answerQuote,
    answerSpeaker,
    answerStatus,
    departureCount,
  }
}

function verifyInquiries(raw: RawAnalysis, transcript: string): { inquiries: RawInquiry[]; droppedInquiries: number } {
  const transcriptNorm = norm(transcript)
  const rawInquiries = raw.inquiries ?? []
  const inquiries = rawInquiries.flatMap((item) => {
    const verified = verifyInquiry(item, transcriptNorm)
    return verified ? [verified] : []
  })
  return { inquiries, droppedInquiries: (raw.parseDroppedInquiries ?? 0) + rawInquiries.length - inquiries.length }
}

function clipQuote(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`
}

function summaryWithVerifiedEvidence(summary: string, facts: RawFact[], inquiries: RawInquiry[]): string {
  const notes = facts
    .filter((fact) => fact.key === 'contact_email')
    .map((fact) => `客户提供邮箱：${clipQuote(fact.value, 100)}`)
  const tourInquiries = inquiries.filter((inquiry) => inquiry.topic === 'tour_departures')
  notes.push(...tourInquiries.slice(0, 4).map((inquiry) => {
    const month = inquiry.month === null ? '月份未确认' : `${inquiry.month}月`
    const question = clipQuote(inquiry.questionQuote, 70)
    const answer = inquiry.answerQuote ? `；答复原话“${clipQuote(inquiry.answerQuote, 70)}”` : '；未找到可核实答复'
    const count = inquiry.departureCount === null ? '；团数未核实' : `；明确${inquiry.departureCount}团`
    return `${month}团期：客户问“${question}”${answer}${count}`
  }))
  if (tourInquiries.length > 4) notes.push(`另有${tourInquiries.length - 4}条团期问答`)
  if (notes.length === 0) return summary.slice(0, 1200)

  const evidence = `复核证据：${notes.join('；')}`
  const base = summary.trim()
  const separator = base ? '；' : ''
  const available = Math.max(0, 1200 - evidence.length - separator.length)
  const visibleBase = base.length > available
    ? `${base.slice(0, Math.max(0, available - 1))}…`
    : base
  return `${visibleBase}${visibleBase ? separator : ''}${evidence}`.slice(0, 1200)
}

/** 事实的原话必须真的出现在转写里，且够分量；数值类和「别再联系」还要核对值与原话一致。 */
export function verifyFacts(raw: RawAnalysis, transcript: string): VerifiedAnalysis {
  const t = norm(transcript)
  const kept = raw.facts.filter((f) => {
    const q = norm(f.quote)
    const enoughEvidence = f.key === 'contact_email' ? q.length >= 6 : quoteLongEnough(q)
    // 表态单独找原话所在行（可跨同一声道的相邻几行），顺带判问句；其余事实照旧在整段转写里找。
    const found = STANCE_FACT_KEYS.has(f.key) ? stanceSupported(f, transcript) : t.includes(q)
    return enoughEvidence && found && valueSupported(f)
  })
  const inquiryResult = verifyInquiries(raw, transcript)
  return {
    summary: summaryWithVerifiedEvidence(raw.summary, kept, inquiryResult.inquiries),
    language: raw.language,
    facts: kept,
    inquiries: inquiryResult.inquiries,
    droppedFacts: raw.facts.length - kept.length,
    droppedInquiries: inquiryResult.droppedInquiries,
  }
}

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'language', 'facts', 'inquiries'],
  properties: {
    summary: { type: 'string' },
    language: { type: ['string', 'null'] },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'quote', 'confidence', 'speaker'],
        properties: {
          key: { type: 'string', enum: [...FACT_KEYS] },
          value: { type: 'string' },
          quote: { type: 'string' },
          confidence: { type: 'number' },
          speaker: { type: 'string', enum: [...QUESTION_SPEAKERS] },
        },
      },
    },
    inquiries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'month', 'question', 'questionQuote', 'questionSpeaker', 'answer', 'answerQuote', 'answerSpeaker', 'answerStatus', 'departureCount', 'confidence'],
        properties: {
          topic: { type: 'string', enum: [...INQUIRY_TOPICS] },
          month: { type: ['integer', 'null'], minimum: 1, maximum: 12 },
          question: { type: 'string' },
          questionQuote: { type: 'string' },
          questionSpeaker: { type: 'string', enum: [...QUESTION_SPEAKERS] },
          answer: { type: ['string', 'null'] },
          answerQuote: { type: ['string', 'null'] },
          answerSpeaker: { type: ['string', 'null'], enum: [...ANSWER_SPEAKERS, null] },
          answerStatus: { type: 'string', enum: [...ANSWER_STATUSES] },
          departureCount: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const
