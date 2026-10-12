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
] as const
export type FactKey = (typeof FACT_KEYS)[number]

export const ANALYSIS_SCHEMA_VERSION = 1

export const RawFactSchema = z.object({
  key: z.enum(FACT_KEYS),
  value: z.string().min(1).max(300),
  quote: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
})
export type RawFact = z.infer<typeof RawFactSchema>

export const RawAnalysisSchema = z.object({
  summary: z.string().max(1200),
  language: z.string().max(40).nullable().default(null),
  facts: z.array(RawFactSchema).max(40).default([]),
})
export type RawAnalysis = z.infer<typeof RawAnalysisSchema>

export interface VerifiedAnalysis {
  summary: string
  language: string | null
  facts: RawFact[]
  /** 因为原话在转写里找不到而被丢掉的条数（可见，不静默）。 */
  droppedFacts: number
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
  NZD: ['nzd', 'nz$', 'nz dollar', '纽币', '新西兰元', '纽元', '新币'],
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

const NUMERIC_KEYS: ReadonlySet<FactKey> = new Set<FactKey>(['budget', 'party_size'])
/** 第一人称的拒绝联系（不是任何含 stop/别再 的句子）。 */
const NEGATION = /(don'?t|do not|please don'?t|stop)\s+(call|calling|contact|contacting|ring|phone)\s+(me|us)\b|别再(给我|联系我|打给我|打电话)|不要再(给我|联系我|打电话)|不用再(联系|打电话)|请勿(再)?联系(我|我们)|remove (me|my number|us) from/i
const QUESTION = /[?？]|什么意思|为什么|why\b|是什么/i

/** 数值类事实：值里的数字必须有原话依据，且原话要像金额/人数，不是电话号码、日期、钟点。「别再联系」必须是第一人称的陈述句。 */
function valueSupported(f: RawFact): boolean {
  if (f.key === 'do_not_contact') return NEGATION.test(f.quote) && !QUESTION.test(f.quote)
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

/** 事实的原话必须真的出现在转写里，且够分量；数值类和「别再联系」还要核对值与原话一致。 */
export function verifyFacts(raw: RawAnalysis, transcript: string): VerifiedAnalysis {
  const t = norm(transcript)
  const kept = raw.facts.filter((f) => {
    const q = norm(f.quote)
    return quoteLongEnough(q) && t.includes(q) && valueSupported(f)
  })
  return { summary: raw.summary, language: raw.language, facts: kept, droppedFacts: raw.facts.length - kept.length }
}

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'language', 'facts'],
  properties: {
    summary: { type: 'string' },
    language: { type: ['string', 'null'] },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'quote', 'confidence'],
        properties: {
          key: { type: 'string', enum: [...FACT_KEYS] },
          value: { type: 'string' },
          quote: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const
