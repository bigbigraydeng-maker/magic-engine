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
}

export function parsePrescriptionAsk(text: string): ParsedAsk {
  const trimmed = text.trim()
  return {
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
