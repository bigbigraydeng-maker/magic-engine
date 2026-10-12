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

/** 原话归一化后至少这么长才算有分量（「好的」「ok」「是的」这类应答不能当证据）。 */
export const MIN_QUOTE_CHARS = 6

const ENGLISH_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
}
const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** 抽出文本里出现的数字（阿拉伯数字、k/万/千 简写、英文数字词、常见中文数字）。只用来核对「值里的数字在原话里有依据」。 */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>()
  const t = text.toLowerCase()
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)*)\s*(k|万|千|w)?/g)) {
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

const NUMERIC_KEYS: ReadonlySet<FactKey> = new Set<FactKey>(['budget', 'party_size'])
const NEGATION = /(don'?t|do not|never|stop)\s+(call|contact|ring|phone)|别再|不要再|不用再|请勿|不要打|别打了|remove (me|my number)/i

/** 数值类事实：值里的每个数字都必须能在原话里找到依据（防「原话是真的、数字是编的」）。 */
function valueSupported(f: RawFact): boolean {
  if (f.key === 'do_not_contact') return NEGATION.test(f.quote)
  if (!NUMERIC_KEYS.has(f.key)) return true
  const need = [...numbersIn(f.value)]
  if (need.length === 0) return false
  const have = numbersIn(f.quote)
  return need.every((n) => have.has(n))
}

/** 事实的原话必须真的出现在转写里，且够长；数值类和「别再联系」还要核对值与原话一致。 */
export function verifyFacts(raw: RawAnalysis, transcript: string): VerifiedAnalysis {
  const t = norm(transcript)
  const kept = raw.facts.filter((f) => {
    const q = norm(f.quote)
    return q.length >= MIN_QUOTE_CHARS && t.includes(q) && valueSupported(f)
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
