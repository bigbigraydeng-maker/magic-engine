/**
 * Per-client switch. Off unless leads_config.ads_independent_review is exactly true.
 * Missing, false, and any other value stay off. No new column.
 * A failed read is "unreadable", not a guessed on or off.
 */

import type { KernelDeps } from '@/lib/kernel/deps'

export const ADS_INDEPENDENT_REVIEW_KEY = 'ads_independent_review'

type ReviewSwitch = 'on' | 'off' | 'unreadable'
type ClientDb = KernelDeps['supabase']

export function independentReviewEnabled(leadsConfig: unknown): boolean {
  const root = objectOf(leadsConfig)
  return root?.[ADS_INDEPENDENT_REVIEW_KEY] === true
}

export function withIndependentReviewSwitch(leadsConfig: unknown, enabled: boolean): Record<string, unknown> {
  return { ...objectOf(leadsConfig), [ADS_INDEPENDENT_REVIEW_KEY]: enabled }
}

export async function readIndependentReviewSwitch(sb: ClientDb, clientId: string): Promise<ReviewSwitch> {
  try {
    const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
    if (error || !data) return 'unreadable'
    return independentReviewEnabled((data as { leads_config?: unknown }).leads_config) ? 'on' : 'off'
  } catch {
    return 'unreadable'
  }
}

export async function writeIndependentReviewSwitch(
  sb: ClientDb,
  clientId: string,
  enabled: boolean,
): Promise<ReviewSwitch> {
  try {
    const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
    if (error || !data) return 'unreadable'
    const next = withIndependentReviewSwitch((data as { leads_config?: unknown }).leads_config, enabled)
    const saved = await sb.from('clients').update({ leads_config: next }).eq('id', clientId)
    return saved.error ? 'unreadable' : (enabled ? 'on' : 'off')
  } catch {
    return 'unreadable'
  }
}

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}
