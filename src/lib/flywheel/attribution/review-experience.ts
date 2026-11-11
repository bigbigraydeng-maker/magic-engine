/**
 * Persist concluded execution reviews into client_learned_preferences for prescription memory.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { savePreference } from '@/lib/memory/service'
import type { ReviewVerdictTier } from './review-verdict-rules'
import { tierLabelZh } from './review-verdict-rules'

export interface ReviewCasePayload {
  readonly verdict: ReviewVerdictTier | 'improved' | 'worse' | 'unsure'
  readonly reason: string | null
  readonly text: string
}

export async function persistReviewExperience(
  supabase: SupabaseClient,
  input: {
    clientId: string
    actionId: string
    kindLabel: string
    reviewCase: ReviewCasePayload
  },
): Promise<'written' | 'skipped' | 'failed'> {
  const existing = await supabase
    .from('client_learned_preferences')
    .select('id')
    .eq('client_id', input.clientId)
    .eq('extracted_from_table', 'flywheel_actions')
    .eq('extracted_from_id', input.actionId)
    .eq('is_active', true)
    .limit(1)

  if (existing.error) return 'failed'
  if (Array.isArray(existing.data) && existing.data.length > 0) return 'skipped'

  const tier = normalizeTier(input.reviewCase.verdict)
  const reason = input.reviewCase.reason?.trim()
  const content = [
    `${input.kindLabel}执行回顾：结论「${tierLabelZh(tier)}」`,
    reason ? `原因：${reason}` : null,
    input.reviewCase.text.trim(),
  ].filter((line): line is string => Boolean(line)).join(' ')

  const saved = await savePreference(supabase, {
    client_id: input.clientId,
    preference_type: 'other',
    content,
    source: 'auto_extracted',
    extracted_from_table: 'flywheel_actions',
    extracted_from_id: input.actionId,
    confidence_score: tier === 'unclear' ? 0.5 : 0.85,
    flywheel: 'ads',
  })
  return saved ? 'written' : 'failed'
}

function normalizeTier(value: ReviewCasePayload['verdict']): ReviewVerdictTier {
  if (value === 'useful' || value === 'improved') return 'useful'
  if (value === 'not_useful' || value === 'worse') return 'not_useful'
  return 'unclear'
}
