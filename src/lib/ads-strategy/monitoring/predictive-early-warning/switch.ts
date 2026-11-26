import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '@/lib/pm-todo/manual-item-types'

export const RECEIPTS_KEY = 'ads_predictive_early_warning_receipts'
export const PATROL_KEY = 'ads_predictive_early_warning_patrol'
export const TODO_KEY = 'ads_predictive_early_warning_todo'

export const PREDICTIVE_EARLY_WARNING_KEY = 'ads_predictive_early_warning'
export const PREDICTIVE_EARLY_WARNING_CONFIG_KEY = 'ads_predictive_early_warning_config'

export const DEFAULT_MIN_SPEND_MAJOR = 20
export const OVER_AVG_NUM = 120
export const OVER_AVG_DEN = 100

export const WORSEN_RE_ALERT_NUM = 110
export const WORSEN_RE_ALERT_DEN = 100

export interface PredictiveEarlyWarningConfig {
  minSpendMajor: number
}

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

export interface EntityReceipt {
  accountDay: string
  cprMajor: number | null
  zeroResults: boolean
}
export type ReceiptMap = Record<string, EntityReceipt>

export interface PatrolState {
  accountDay: string
  lines: string[]
  skipNote: string | null
}

export function readReceipts(leadsConfig: unknown): ReceiptMap {
  const root = objectOf(leadsConfig)
  const raw = root?.[RECEIPTS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ReceiptMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const row = objectOf(v)
    if (!row || typeof row.accountDay !== 'string') continue
    out[k] = {
      accountDay: row.accountDay,
      cprMajor: typeof row.cprMajor === 'number' ? row.cprMajor : null,
      zeroResults: row.zeroResults === true,
    }
  }
  return out
}

export function readPatrolState(leadsConfig: unknown, accountDay: string): PatrolState | null {
  const raw = objectOf(objectOf(leadsConfig)?.[PATROL_KEY])
  if (!raw || raw.accountDay !== accountDay) return null
  return {
    accountDay,
    lines: Array.isArray(raw.lines) ? raw.lines.filter((l): l is string => typeof l === 'string') : [],
    skipNote: typeof raw.skipNote === 'string' ? raw.skipNote : null,
  }
}

export function patrolLineForHeadline(state: PatrolState | null): string | null {
  if (!state) return null
  if (state.skipNote) return state.skipNote
  return state.lines.length > 0 ? state.lines.join('；') : null
}

export function readTodoState(
  leadsConfig: unknown,
  accountDay: string,
): { accountDay: string; items: Array<Pick<ManualItem, 'kind' | 'what' | 'how' | 'href'>> } | null {
  const raw = objectOf(objectOf(leadsConfig)?.[TODO_KEY])
  if (!raw || raw.accountDay !== accountDay) return null
  return {
    accountDay,
    items: Array.isArray(raw.items) ? (raw.items as Array<Pick<ManualItem, 'kind' | 'what' | 'how' | 'href'>>) : [],
  }
}

export async function patchLeadsConfigState(
  sb: SupabaseClient,
  clientId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) throw new Error(error?.message ?? 'client missing')
  const base = objectOf((data as { leads_config?: unknown }).leads_config) ?? {}
  const { error: wErr } = await sb.from('clients').update({ leads_config: { ...base, ...patch } }).eq('id', clientId)
  if (wErr) throw new Error(wErr.message)
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}