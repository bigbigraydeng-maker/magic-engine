import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun } from '@/lib/kernel/types'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { ConfirmationCardError } from './errors'

const RUN_COLUMNS =
  'id, client_id, purpose, goal_id, execution_item_id, triggered_by, triggered_by_ref, ' +
  'action_key, action_version, input, rationale, evidence, idempotency_key, status, ' +
  'authorization_decision_id, correlation_id, cost_cap_usd, cost_estimate_usd, needs_human, ' +
  'last_error, claimed_by, claimed_at, heartbeat_at, lease_expires_at, previous_claimed_by, ' +
  'reclaim_count, last_reclaimed_at, claim_generation, created_at, updated_at, started_at, finished_at'

export interface DecisionNote {
  readonly id: string
  readonly reason: string
  readonly decidedBy: string | null
  readonly verdict: string
}

const SHOWN_STATUSES = ['pending_approval', 'authorized', 'denied']

export async function listShownCards(sb: SupabaseClient, clientId: string): Promise<ActionRun[]> {
  const { data, error } = await sb
    .from('action_runs')
    .select(RUN_COLUMNS)
    .eq('client_id', clientId)
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .in('status', SHOWN_STATUSES)
    .order('updated_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(`[confirmation-card] 读确认卡失败：${error.message}`)
  return (data ?? []) as unknown as ActionRun[]
}

export async function listPendingCards(sb: SupabaseClient, clientId: string): Promise<ActionRun[]> {
  const { data, error } = await sb
    .from('action_runs')
    .select(RUN_COLUMNS)
    .eq('client_id', clientId)
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .eq('status', 'pending_approval')
    .limit(50)
  if (error) throw new Error(`[confirmation-card] 读待确认的卡失败：${error.message}`)
  const rows = (data ?? []) as unknown as ActionRun[]
  if (rows.length >= 50) {
    throw new ConfirmationCardError('invalid', '待确认的卡太多，先处理旧的，没有再出新卡。')
  }
  return rows
}

export async function notesFor(sb: SupabaseClient, ids: readonly string[]): Promise<Map<string, DecisionNote>> {
  const found = new Map<string, DecisionNote>()
  if (ids.length === 0) return found
  const { data, error } = await sb
    .from('authorization_decisions')
    .select('id, reason, decided_by_user, verdict')
    .in('id', [...ids])
  if (error) throw new Error(`[confirmation-card] 读审批记录失败：${error.message}`)
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    if (typeof row.id !== 'string') continue
    found.set(row.id, {
      id: row.id,
      reason: typeof row.reason === 'string' ? row.reason : '',
      decidedBy: typeof row.decided_by_user === 'string' ? row.decided_by_user : null,
      verdict: typeof row.verdict === 'string' ? row.verdict : '',
    })
  }
  return found
}
