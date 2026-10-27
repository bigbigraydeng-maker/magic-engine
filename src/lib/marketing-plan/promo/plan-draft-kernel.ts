import { findRunByIdempotencyKey, insertRun, UniqueViolationError, updateRun } from '@/lib/kernel/store'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanDraftRunRecord } from './plan-draft-types'

export const PLAN_DRAFT_ACTION_KEY = 'promo.draft_from_prescription'

export function planDraftRunKey(prescriptionId: string, version: number): string {
  return `${PLAN_DRAFT_ACTION_KEY}:${prescriptionId}:${version}`
}

function patchOf(record: PlanDraftRunRecord) {
  return {
    status: record.status,
    needs_human: record.needsHuman,
    last_error: record.status === 'failed' ? record.reasonText : null,
    evidence: { status: record.reasonCode, attempt: record.attempt },
    finished_at: new Date().toISOString(),
  }
}

async function keepOrUpdate(
  sb: SupabaseClient,
  record: PlanDraftRunRecord,
  runId: string,
  currentStatus: string,
): Promise<void> {
  if (currentStatus === 'succeeded' && record.status === 'failed') return
  await updateRun(sb, runId, patchOf(record))
}

/** One action_runs row per prescription version. Recording must not fail the draft. */
export async function recordPlanDraftRun(sb: SupabaseClient, record: PlanDraftRunRecord): Promise<void> {
  const key = planDraftRunKey(record.prescriptionId, record.version)
  try {
    const existing = await findRunByIdempotencyKey(sb, record.clientId, key)
    if (existing) {
      await keepOrUpdate(sb, record, existing.id, existing.status)
      return
    }
    await insertRun(sb, {
      client_id: record.clientId,
      purpose: record.goalId ? 'growth' : 'maintenance',
      goal_id: record.goalId,
      triggered_by: 'agent',
      triggered_by_ref: null,
      action_key: PLAN_DRAFT_ACTION_KEY,
      action_version: 1,
      input: {
        prescription_id: record.prescriptionId,
        version: record.version,
        attempt: record.attempt,
      },
      rationale: null,
      evidence: { status: record.reasonCode, attempt: record.attempt },
      idempotency_key: key,
      status: record.status,
      cost_cap_usd: 0,
      cost_estimate_usd: 0,
      needs_human: record.needsHuman,
      last_error: record.status === 'failed' ? record.reasonText : null,
      correlation_id: record.requestId,
    })
  } catch (err) {
    if (!(err instanceof UniqueViolationError)) return
    const winner = await findRunByIdempotencyKey(sb, record.clientId, key).catch(() => null)
    if (!winner) return
    await keepOrUpdate(sb, record, winner.id, winner.status).catch(() => undefined)
  }
}
