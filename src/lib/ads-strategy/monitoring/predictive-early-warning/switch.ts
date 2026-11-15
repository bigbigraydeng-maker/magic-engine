/**
 * Per-client switch. Off unless leads_config.ads_predictive_early_warning is exactly true.
 * Optional overrides live under leads_config.ads_predictive_early_warning_config (jsonb, no migration).
 */

import type { KernelDeps } from '@/lib/kernel/deps'

export const PREDICTIVE_EARLY_WARNING_KEY = 'ads_predictive_early_warning'
export const PREDICTIVE_EARLY_WARNING_CONFIG_KEY = 'ads_predictive_early_warning_config'

export const DEFAULT_MIN_SPEND_MAJOR = 20
export const OVER_AVG_NUM = 120
export const OVER_AVG_DEN = 100

/** Re-alert same entity only if cost-per-result worsens by at least this fraction vs last alert. */
export const WORSEN_RE_ALERT_NUM = 110
export const WORSEN_RE_ALERT_DEN = 100

export interface PredictiveEarlyWarningConfig {
  minSpendMajor: number
}

type Switch = 'on' | 'off' | 'unreadable'
type ClientDb = KernelDeps['supabase']

export function predictiveEarlyWarningEnabled(leadsConfig: unknown): boolean {
  const root = objectOf(leadsConfig)
  return root?.[PREDICTIVE_EARLY_WARNING_KEY] === true
}

export function parsePredictiveEarlyWarningConfig(leadsConfig: unknown): PredictiveEarlyWarningConfig {
  const root = objectOf(leadsConfig)
  const raw = objectOf(root?.[PREDICTIVE_EARLY_WARNING_CONFIG_KEY])
  const min = raw?.min_spend_major
  if (typeof min === 'number' && Number.isFinite(min) && min > 0) {
    return { minSpendMajor: min }
  }
  return { minSpendMajor: DEFAULT_MIN_SPEND_MAJOR }
}

export async function readPredictiveEarlyWarningSwitch(sb: ClientDb, clientId: string): Promise<Switch> {
  try {
    const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
    if (error || !data) return 'unreadable'
    return predictiveEarlyWarningEnabled((data as { leads_config?: unknown }).leads_config) ? 'on' : 'off'
  } catch {
    return 'unreadable'
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}