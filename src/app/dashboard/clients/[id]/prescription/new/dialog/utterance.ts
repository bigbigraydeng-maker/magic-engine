import type { DiagnosticDimension, PrescriptionIntake } from '@/types/diagnostic'

const DIMENSION_WORDS: Array<[DiagnosticDimension, RegExp]> = [
  ['seo', /seo|搜索/i],
  ['social', /社媒|社交|facebook|instagram/i],
  ['ads', /广告|投放/],
  ['reputation', /口碑|评价/],
  ['competitor', /竞品/],
  ['ai_visibility', /ai\s*可见|人工智能可见/i],
]

const AMOUNT = String.raw`\d{1,3}(?:[,，]\d{3})+|\d+(?:\.\d+)?`
const BUDGET_ONLY = new RegExp(
  `^(?:每月|月预算|预算)?\\s*[$¥]?\\s*(?:${AMOUNT})\\s*(?:纽币|澳元|美元|块|元|nzd|aud|usd)?$`,
  'i',
)

export interface ParsedAsk {
  businessGoal: string
  monthlyBudget: number | null
  urgency: PrescriptionIntake['timeline_urgency']
  dimensions: DiagnosticDimension[]
  wantsNewDraft: boolean
  /** 说了「按普通客户开」：这一次临时改回普通，不改客户资料。 */
  forceStandard: boolean
  /** 本人每周能拍几条；没说就是 null。 */
  weeklyShoot: number | null
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const SHOOT_PATTERNS = [
  /每周\s*(?:能|可以|大概|大约)?\s*(?:拍|发|出)?\s*([0-9]{1,2}|[一二两三四五六七八九十])\s*(?:条|个|支)/,
  /一周\s*(?:能|可以|大概|大约)?\s*(?:拍|发|出)?\s*([0-9]{1,2}|[一二两三四五六七八九十])\s*(?:条|个|支)/,
]
const SHOOT_ONLY = /^\s*(?:大概|大约)?\s*([0-9]{1,2}|[一二两三四五六七八九十])\s*(?:条|个|支)?\s*$/

function toShootCount(raw: string | undefined): number | null {
  if (!raw) return null
  const value = CN_DIGITS[raw] ?? Number(raw)
  return Number.isInteger(value) && value > 0 && value <= 100 ? value : null
}

/** 本人每周能拍几条：句子里写明了才算，不靠猜。 */
export function readWeeklyShoot(text: string): number | null {
  for (const pattern of SHOOT_PATTERNS) {
    const found = text.match(pattern)
    if (found) return toShootCount(found[1])
  }
  return null
}

/** 追问「每周能拍几条」之后的回答，可以只回一个数字。 */
export function readShootAnswer(text: string): number | null {
  return readWeeklyShoot(text) ?? toShootCount(text.match(SHOOT_ONLY)?.[1])
}

export function parsePrescriptionAsk(text: string): ParsedAsk {
  const trimmed = text.trim()
  return {
    forceStandard: /按\s*普通\s*客户\s*开|当\s*普通\s*客户|不按\s*个人\s*IP/i.test(trimmed),
    weeklyShoot: readWeeklyShoot(trimmed),
    businessGoal: BUDGET_ONLY.test(trimmed) ? '' : trimmed,
    monthlyBudget: readBudget(trimmed),
    urgency: readUrgency(trimmed),
    dimensions: DIMENSION_WORDS.filter(([, pattern]) => pattern.test(trimmed)).map(([dim]) => dim),
    wantsNewDraft: /重新开|再开一版|再开|新开|另开|开个新|开一版/.test(trimmed),
  }
}

function readUrgency(text: string): PrescriptionIntake['timeline_urgency'] {
  if (/马上|立刻|本周|这周|紧急/.test(text)) return 'immediate'
  if (/长期|半年|一年/.test(text)) return 'long_term'
  return 'short_term'
}

function readBudget(text: string): number | null {
  const patterns = [
    /预算\s*[:：]?\s*(?:约|大概|大约)?\s*[$¥]?\s*(\d{1,3}(?:[,，]\d{3})+|\d+(?:\.\d+)?)/,
    /(?:每月|一个月|月预算)\s*[$¥]?\s*(\d{1,3}(?:[,，]\d{3})+|\d+(?:\.\d+)?)/,
    /(?:NZD|AUD|USD|NZ\$|A\$|US\$|\$|￥)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/i,
  ]
  for (const pattern of patterns) {
    const found = text.match(pattern)
    if (found?.[1]) return toAmount(found[1])
  }
  if (!BUDGET_ONLY.test(text)) return null
  const found = text.match(new RegExp(`(${AMOUNT})`))
  return found?.[1] ? toAmount(found[1]) : null
}

function toAmount(raw: string): number | null {
  const value = Number(raw.replace(/[,，]/g, ''))
  if (!Number.isFinite(value) || value < 0) return null
  return value
}
