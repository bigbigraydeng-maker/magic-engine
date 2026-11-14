import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchLatestOutcomesByAction } from '@/lib/flywheel/execution-outcomes'
import { EXECUTED_REVIEW_ACTION_TYPES } from '@/lib/flywheel/attribution/executed-review'
import {
  buildAdsExecutionReviewPanel,
  EXECUTION_REVIEW_DEFAULT_LIMIT,
  type AdsExecutionReviewPanel,
  type RawExecutionRow,
} from './ads-execution-review-panel'
import { rulesFromLeadsConfig } from '@/lib/flywheel/attribution/review-verdict-rules'

const ACTION_TYPES = [...EXECUTED_REVIEW_ACTION_TYPES]

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
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

  const { data: clientRow } = await supabase
    .from('clients')
    .select('leads_config')
    .eq('id', input.clientId)
    .maybeSingle()
  const rules = rulesFromLeadsConfig(
    clientRow && typeof clientRow === 'object'
      ? (clientRow as { leads_config?: unknown }).leads_config
      : null,
  )

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
  const outcomeByAction = await fetchLatestOutcomesByAction(actionIds)

  const rows: RawExecutionRow[] = (actions ?? []).flatMap((row) => {
    if (typeof row.id !== 'string') return []
    const payload = record(row.payload)
    const executed_at = typeof row.executed_at === 'string' ? row.executed_at : null
    const action_type = typeof row.action_type === 'string' ? row.action_type : null
    const outcome = outcomeByAction[row.id]
    return [{
      id: row.id,
      action_type,
      executed_at,
      payload,
      outcome_baseline: outcome?.baseline ?? null,
      outcome_after: outcome?.after_value ?? null,
    }]
  })

  return buildAdsExecutionReviewPanel({ clientId: input.clientId, rows, limit: capped, now, rules })
}
