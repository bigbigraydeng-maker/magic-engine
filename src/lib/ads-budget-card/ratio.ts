/**
 * Per-client step cap, stored on the existing policy metadata.
 * Missing key means the platform default. A bad number fails closed.
 * auto_approve does not skip the card. deny means the card stays off.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_BUDGET_ADJUSTMENT_RATIO } from '@/lib/meta/guardrails'
import type { StepRatio } from './types'

export const BUDGET_CARD_POLICY_KEY = 'ads.adjust_adset_daily_budget'
export const DEFAULT_STEP_RATIO = MAX_BUDGET_ADJUSTMENT_RATIO

export function ratioFromMetadata(metadata: unknown): StepRatio {
  if (metadata == null) return DEFAULT_STEP_RATIO
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return 'invalid'
  if (!('max_budget_step_ratio' in metadata)) return DEFAULT_STEP_RATIO
  const raw = (metadata as { max_budget_step_ratio?: unknown }).max_budget_step_ratio
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'invalid'
  if (raw <= 0 || raw > MAX_BUDGET_ADJUSTMENT_RATIO) return 'invalid'
  return raw
}

export async function readStepRatio(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<StepRatio> {
  const { data, error } = await sb.from('client_automation_policies')
    .select('mode, metadata, effective_from, effective_to')
    .eq('client_id', clientId)
    .eq('action_key', BUDGET_CARD_POLICY_KEY)
  if (error) return 'unreadable'
  const active = ((data ?? []) as PolicyRow[]).filter((row) => windowOpen(row, now))
  if (active.length > 1) return 'unreadable'
  const row = active[0]
  if (!row) return DEFAULT_STEP_RATIO
  if (row.mode === 'deny') return 'off'
  return ratioFromMetadata(row.metadata)
}

interface PolicyRow {
  mode?: unknown
  metadata?: unknown
  effective_from?: unknown
  effective_to?: unknown
}

function windowOpen(row: PolicyRow, now: Date): boolean {
  const from = Date.parse(String(row.effective_from ?? ''))
  if (!Number.isFinite(from) || from > now.getTime()) return false
  if (row.effective_to == null) return true
  const to = Date.parse(String(row.effective_to))
  return Number.isFinite(to) && to > now.getTime()
}
