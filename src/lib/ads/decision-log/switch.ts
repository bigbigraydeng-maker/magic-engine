/**
 * Per-client switch. Off unless leads_config.ads_decision_review.enabled is exactly true.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const ADS_DECISION_REVIEW_CONFIG_KEY = 'ads_decision_review'

export function adsDecisionReviewEnabled(leadsConfig: unknown): boolean {
  const root = objectOf(leadsConfig)
  const block = objectOf(root?.[ADS_DECISION_REVIEW_CONFIG_KEY])
  return block?.enabled === true
}

export async function listClientsWithDecisionReviewOn(
  supabase: SupabaseClient,
): Promise<readonly { id: string }[]> {
  const { data, error } = await supabase.from('clients').select('id, leads_config')
  if (error || !Array.isArray(data)) return []
  return data.flatMap((row) => {
    if (typeof row.id !== 'string') return []
    if (!adsDecisionReviewEnabled((row as { leads_config?: unknown }).leads_config)) return []
    return [{ id: row.id }]
  })
}

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}
