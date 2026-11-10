import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import {
  buildAdsExecutionReviewPanel,
  EXECUTION_REVIEW_DEFAULT_LIMIT,
  type AdsExecutionReviewPanel,
  type RawExecutionRow,
} from './ads-execution-review-panel'

const ACTION_TYPES = [
  ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET,
  ADS_ACTION_TYPE.PAUSE_AD_SET,
] as const

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function loadAdsExecutionReviewPanel(
  supabase: SupabaseClient,
  input: {
    clientId: string
    limit?: number
    now?: Date
  },
): Promise<AdsExecutionReviewPanel> {
  const now = input.now ?? new Date()
  const limit = input.limit ?? EXECUTION_REVIEW_DEFAULT_LIMIT
  const capped = Math.min(Math.max(limit, 1), 50)

  const { data: actions, error } = await supabase
    .from('flywheel_actions')
    .select('id, action_type, executed_at, payload')
    .eq('client_id', input.clientId)
    .eq('flywheel', 'ads')
    .in('action_type', [...ACTION_TYPES])
    .eq('payload->>status', 'executed')
    .not('executed_at', 'is', null)
    .order('executed_at', { ascending: false })
    .limit(capped)

  if (error) {
    throw new Error(`loadAdsExecutionReviewPanel: flywheel_actions — ${error.message}`)
  }

  const actionIds = (actions ?? []).map((row) => row.id).filter((id): id is string => typeof id === 'string')
  const outcomeByAction = new Map<string, { baseline: number | null; after: number | null }>()

  if (actionIds.length > 0) {
    const { data: outcomes, error: outcomeError } = await supabase
      .from('flywheel_outcomes')
      .select('action_id, baseline, after_value')
      .in('action_id', actionIds)

    if (outcomeError) {
      throw new Error(`loadAdsExecutionReviewPanel: flywheel_outcomes — ${outcomeError.message}`)
    }

    for (const row of outcomes ?? []) {
      if (typeof row.action_id !== 'string') continue
      const baseline = num(row.baseline)
      const after = num(row.after_value)
      const prev = outcomeByAction.get(row.action_id)
      if (!prev) {
        outcomeByAction.set(row.action_id, { baseline, after })
      }
    }
  }

  const rows: RawExecutionRow[] = (actions ?? []).flatMap((row) => {
    if (typeof row.id !== 'string') return []
    const payload = record(row.payload)
    const executed_at = typeof row.executed_at === 'string' ? row.executed_at : null
    const action_type = typeof row.action_type === 'string' ? row.action_type : null
    const outcome = outcomeByAction.get(row.id)
    return [{
      id: row.id,
      action_type,
      executed_at,
      payload,
      outcome_baseline: outcome?.baseline ?? null,
      outcome_after: outcome?.after ?? null,
    }]
  })

  return buildAdsExecutionReviewPanel({ clientId: input.clientId, rows, limit: capped, now })
}
