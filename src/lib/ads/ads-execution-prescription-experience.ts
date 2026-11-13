/**
 * Load and aggregate auto_extracted execution-review experience rows (read-only).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReviewVerdictTier } from '@/lib/flywheel/attribution/review-verdict-rules'
import type { AdsExecutionPrescriptionReadbackRules } from './ads-execution-prescription-rules'

export type AdsExecutionItemType = 'budget' | 'pause'

export interface ExecutionExperienceCounts {
  readonly useful: number
  readonly not_useful: number
}

export type ExecutionExperienceByType = Record<AdsExecutionItemType, ExecutionExperienceCounts>

const EMPTY_COUNTS: ExecutionExperienceCounts = { useful: 0, not_useful: 0 }

export function emptyExperienceByType(): ExecutionExperienceByType {
  return { budget: { ...EMPTY_COUNTS }, pause: { ...EMPTY_COUNTS } }
}

const BUDGET_KIND_LABELS = new Set([
  '调日预算',
  '成绩单减预算',
  '止损减预算',
  '机会减预算',
  '日内上限减预算',
  '金额确认卡减预算',
])
const PAUSE_KIND_LABELS = new Set([
  '暂停广告组',
  '自动暂停广告组',
  '暂停广告系列',
  '日内上限暂停系列',
])
const KIND_PREFIX = /^(.+?)执行回顾：/
const TIER_IN_CONTENT = /结论「(有用|没用|看不出)」/

function bucketForKindLabel(label: string): AdsExecutionItemType | null {
  if (BUDGET_KIND_LABELS.has(label)) return 'budget'
  if (PAUSE_KIND_LABELS.has(label)) return 'pause'
  return null
}

export function parseExecutionReviewPreference(content: string): {
  kind: AdsExecutionItemType | null
  tier: ReviewVerdictTier | null
} {
  const trimmed = content.trim()
  const kindMatch = trimmed.match(KIND_PREFIX)
  if (!kindMatch) return { kind: null, tier: null }
  const kind = bucketForKindLabel(kindMatch[1] ?? '')
  if (!kind) return { kind: null, tier: null }
  const tierMatch = trimmed.match(TIER_IN_CONTENT)
  if (!tierMatch) return { kind, tier: null }
  const raw = tierMatch[1]
  if (raw === '有用') return { kind, tier: 'useful' }
  if (raw === '没用') return { kind, tier: 'not_useful' }
  return { kind, tier: 'unclear' }
}

export function aggregateExperienceRows(
  rows: ReadonlyArray<{ content: string }>,
): ExecutionExperienceByType {
  const out = emptyExperienceByType()
  for (const row of rows) {
    const parsed = parseExecutionReviewPreference(row.content)
    if (!parsed.kind || !parsed.tier || parsed.tier === 'unclear') continue
    out[parsed.kind][parsed.tier] += 1
  }
  return out
}

function lookbackSinceIso(now: Date, lookbackDays: number): string {
  const ms = lookbackDays * 24 * 60 * 60 * 1000
  return new Date(now.getTime() - ms).toISOString()
}

export async function loadExecutionReviewExperience(
  sb: SupabaseClient,
  clientId: string,
  rules: AdsExecutionPrescriptionReadbackRules,
  now: Date = new Date(),
): Promise<ExecutionExperienceByType> {
  const since = lookbackSinceIso(now, rules.lookbackDays)
  try {
    const { data, error } = await sb
      .from('client_learned_preferences')
      .select('content')
      .eq('client_id', clientId)
      .eq('extracted_from_table', 'flywheel_actions')
      .eq('source', 'auto_extracted')
      .eq('is_active', true)
      .eq('flywheel', 'ads')
      .gte('created_at', since)
      .limit(200)
    if (error) {
      console.warn('[ads-execution-prescription] load experience:', error.message)
      return emptyExperienceByType()
    }
    return aggregateExperienceRows((data ?? []).map((row) => ({
      content: typeof row.content === 'string' ? row.content : '',
    })))
  } catch {
    return emptyExperienceByType()
  }
}

const KIND_LABEL: Record<AdsExecutionItemType, string> = {
  budget: '调日预算',
  pause: '暂停广告组',
}

export function formatExperienceHint(
  type: AdsExecutionItemType,
  counts: ExecutionExperienceCounts,
  lookbackDays: number,
): string | null {
  const parts: string[] = []
  if (counts.useful > 0) parts.push(`有用 ${counts.useful} 次`)
  if (counts.not_useful > 0) parts.push(`没用 ${counts.not_useful} 次`)
  if (parts.length === 0) return null
  return `近 ${lookbackDays} 天${KIND_LABEL[type]}卡回顾：${parts.join('、')}。`
}

export function appendExperienceHint(scope: string, hint: string | null): string {
  if (!hint) return scope
  return `${scope}（${hint}）`
}
