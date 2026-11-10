import type { SupabaseClient } from '@supabase/supabase-js'

import {
  BUDGET_CARD_ACTION,
  PAUSE_CARD_ACTION,
} from '@/lib/flywheel/attribution/executed-review'
import {
  buildAdsExecutionReviewPanel,
  EXECUTION_REVIEW_DEFAULT_LIMIT,
  type AdsExecutionReviewPanel,
  type ExecutionReviewActionRow,
  type ExecutionReviewOutcomeRow,
} from './panel'

const CARD_ACTIONS = [BUDGET_CARD_ACTION, PAUSE_CARD_ACTION] as const

interface ActionQueryRow {
  readonly id: string
  readonly action_type: string | null
  readonly executed_at: string | null
  readonly expected_metric: string | null
  readonly payload: Record<string, unknown> | null
}

interface OutcomeQueryRow {
  readonly action_id: string
  readonly metric_key: string
  readonly window_days: number
  readonly baseline: number | null
  readonly after_value: number | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asActionRow(row: unknown): ExecutionReviewActionRow | null {
  if (!row || typeof row !== 'object') return null
  const data = row as ActionQueryRow
  if (typeof data.id !== 'string') return null
  return {
    id: data.id,
    action_type: data.action_type,
    executed_at: data.executed_at,
    expected_metric: data.expected_metric,
    payload: record(data.payload),
  }
}

function asOutcomeRow(row: unknown): ExecutionReviewOutcomeRow | null {
  if (!row || typeof row !== 'object') return null
  const data = row as OutcomeQueryRow
  if (typeof data.action_id !== 'string' || typeof data.metric_key !== 'string') return null
  if (typeof data.window_days !== 'number') return null
  return {
    action_id: data.action_id,
    metric_key: data.metric_key,
    window_days: data.window_days,
    baseline: typeof data.baseline === 'number' ? data.baseline : null,
    after_value: typeof data.after_value === 'number' ? data.after_value : null,
  }
}

export async function loadAdsExecutionReviewPanel(
  sb: SupabaseClient,
  input: { clientId: string; limit?: number; now?: Date },
): Promise<AdsExecutionReviewPanel> {
  const limit = input.limit ?? EXECUTION_REVIEW_DEFAULT_LIMIT
  const now = input.now ?? new Date()

  const { data, error } = await sb
    .from('flywheel_actions')
    .select('id, action_type, executed_at, expected_metric, payload')
    .eq('client_id', input.clientId)
    .in('action_type', [...CARD_ACTIONS])
    .eq('payload->>status', 'executed')
    .order('executed_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) {
    throw new Error(`loadAdsExecutionReviewPanel: flywheel_actions — ${error.message}`)
  }

  const actions = (Array.isArray(data) ? data : []).map(asActionRow).filter((row): row is ExecutionReviewActionRow => row !== null)
  const actionIds = actions.map((row) => row.id)
  const outcomes = actionIds.length === 0 ? [] : await loadOutcomes(sb, actionIds)

  return buildAdsExecutionReviewPanel({
    clientId: input.clientId,
    limit,
    now,
    actions,
    outcomes,
  })
}

async function loadOutcomes(sb: SupabaseClient, actionIds: readonly string[]): Promise<ExecutionReviewOutcomeRow[]> {
  const { data, error } = await sb
    .from('flywheel_outcomes')
    .select('action_id, metric_key, window_days, baseline, after_value')
    .in('action_id', [...actionIds])

  if (error) {
    throw new Error(`loadAdsExecutionReviewPanel: flywheel_outcomes — ${error.message}`)
  }
  return (Array.isArray(data) ? data : []).map(asOutcomeRow).filter((row): row is ExecutionReviewOutcomeRow => row !== null)
}
