/**
 * Stop the 鲁班 / 处方 deadlock.
 *
 * Auto-run refuses a prescription older than PRESCRIPTION_FRESH_DAYS.
 * prescription-weekly refuses a client with no usable goal, so that
 * prescription never gets replaced. The card was re-checked every day.
 *
 * When both are true, mark the card skipped with `blocked_needs_goal`
 * (the existing terminal status — the enum has no blocked_* value) and
 * let the daily to-do tell a person to set a goal.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AUTO_RUNNABLE_ACTION_TYPES,
  BLOCKED_NEEDS_GOAL,
  prescriptionIsStaleForGoalBlock,
  type Endorsement,
} from './auto-run-policy'
import { deriveEndorsement, type PrescriptionAnchor } from './endorsement'

export { BLOCKED_NEEDS_GOAL }

interface GoalPeriodRow {
  client_id: string
  period_end: string | null
}

interface ParkableItemRow {
  id: string
  client_id: string
  status: string
  source: string
  created_at: string | null
  prescription_id: string | null
  marketing_plan_id: string | null
  action_type: string | null
}

/** Same date rule as pickGoalForPrescription: the end date itself still counts. */
export function goalPeriodStillOpen(periodEnd: string | null, now: Date): boolean {
  if (!periodEnd) return true
  const iso = periodEnd.length === 10 ? `${periodEnd}T00:00:00.000Z` : periodEnd
  const end = Date.parse(iso)
  if (Number.isNaN(end)) return false
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return end >= start
}

export async function loadClientIdsWithUsableGoal(
  supabase: SupabaseClient,
  clientIds: string[],
  now: Date,
): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('goals')
    .select('client_id, period_end')
    .in('client_id', clientIds)
    .eq('status', 'active')
  if (error) throw new Error(`目标查询失败: ${error.message}`)
  const usable = new Set<string>()
  for (const row of (data ?? []) as GoalPeriodRow[]) {
    if (goalPeriodStillOpen(row.period_end, now)) usable.add(row.client_id)
  }
  return usable
}

function endorsementFor(
  row: ParkableItemRow,
  prescriptions: Map<string, PrescriptionAnchor>,
  now: Date,
): Endorsement {
  return deriveEndorsement(
    {
      source: row.source,
      clientId: row.client_id,
      createdAt: row.created_at,
      prescriptionId: row.prescription_id,
      prescription: row.prescription_id ? (prescriptions.get(row.prescription_id) ?? null) : null,
      marketingPlanId: row.marketing_plan_id,
      marketingPlan: null,
    },
    now,
  )
}

/**
 * Pending auto-runnable cards whose prescription can never refresh.
 * The caller (auto-run) writes the skipped status. This file only reads.
 */
export async function staleAutoRunItemIdsWithoutGoal(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('execution_items')
    .select('id, client_id, status, source, created_at, prescription_id, marketing_plan_id, action_type')
    .eq('client_id', clientId)
    .eq('status', 'pending')
    .in('action_type', [...AUTO_RUNNABLE_ACTION_TYPES])
  if (error) throw new Error(`blocked_needs_goal 查询失败: ${error.message}`)

  const runnable = new Set<string>(AUTO_RUNNABLE_ACTION_TYPES)
  const pending = ((data ?? []) as ParkableItemRow[]).filter(
    (row) =>
      row.client_id === clientId &&
      row.status === 'pending' &&
      row.action_type != null &&
      runnable.has(row.action_type),
  )
  if (pending.length === 0) return []

  const prescriptionIds = Array.from(
    new Set(pending.map((row) => row.prescription_id).filter((id): id is string => !!id)),
  )
  const prescriptions = new Map<string, PrescriptionAnchor>()
  if (prescriptionIds.length > 0) {
    const { data: presRows, error: presErr } = await supabase
      .from('prescriptions')
      .select('id, client_id, status, approved_at, generated_at')
      .in('id', prescriptionIds)
    if (presErr) throw new Error(`blocked_needs_goal 方案查询失败: ${presErr.message}`)
    for (const row of (presRows ?? []) as Array<PrescriptionAnchor & { id: string }>) {
      if (prescriptionIds.includes(row.id)) prescriptions.set(row.id, row)
    }
  }

  return pending
    .filter((row) => prescriptionIsStaleForGoalBlock(endorsementFor(row, prescriptions, now)))
    .map((row) => row.id)
}
