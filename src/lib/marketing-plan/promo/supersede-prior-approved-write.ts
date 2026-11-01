/**
 * Archive previously approved plans for the same client and goal, and put
 * them back if the new approval does not stick.
 *
 * The status flip of the new plan is still done by the caller. This module
 * archives first. If that fails, it restores anything it already archived
 * and the caller must not approve. If the caller then fails to mark the new
 * plan approved, it calls releaseSupersedeUnlessApproved so the old plans
 * are approved again. A crash after a successful archive and before the
 * flip leaves the old plans archived; approving the same draft again finishes
 * the flip and does not need to archive them a second time.
 *
 * After that flip succeeds, reconcileSameGoalApprovedPlans reads the approved
 * rows again and archives every same-goal plan except the latest approval.
 * Two overlapping approvals can both flip; both reconciles keep the same row.
 * Repeating a reconcile is safe: a plan another request already archived is
 * left archived, and the keeper is not archived.
 */

import type { MarketingPlan } from '../types'
import { supabaseAdmin } from '@/lib/supabase'
import { planLinkedGoalId } from './plan-pick'
import {
  keptApprovedPlanId,
  priorApprovedSameGoal,
  type PriorApprovedRow,
} from './supersede-prior-approved'

const UNREAD = '同一目标下的旧计划没读全，这次没有批准。请稍后重试。'
const NOT_ARCHIVED = '同一目标下的旧计划没能一起归档，这次没有批准。请刷新后再试。'
const STUCK = '旧计划归档到一半没完成，而且没能全部改回已批准。请刷新后核对，先不要再批一份。'
export const UNDO_STUCK = '批准没有保存成功，旧计划也没能全部改回已批准。请刷新后核对，先不要再批一份。'
const RECONCILE_UNREAD = '这份计划已经批准，但没能核对同一目标下还有没有别的已批准计划。请稍后再批一份新计划。'
const RECONCILE_LEFT = '这份计划已经批准，但同一目标下多出来的已批准计划没能收起。请稍后再批一份新计划。'

export type ArchiveSameGoalResult =
  | { ok: true; archived: PriorApprovedRow[] }
  | { ok: false; rolledBack: boolean; error: string }

type ListBody = { data?: unknown; error?: unknown }

function failed(rolledBack: boolean, error: string): ArchiveSameGoalResult {
  return { ok: false, rolledBack, error }
}

function asPrior(value: unknown, clientId: string): PriorApprovedRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || row.id.trim() === '') return null
  if (row.client_id !== clientId || row.status !== 'approved') return null
  if (typeof row.updated_at !== 'string' || row.updated_at.trim() === '') return null
  const approvedAt = readApprovedAt(row.approved_at)
  if (approvedAt === undefined) return null
  const meta = row.generation_meta
  if (meta !== null && meta !== undefined && (typeof meta !== 'object' || Array.isArray(meta))) return null
  return {
    id: row.id,
    client_id: clientId,
    status: 'approved',
    updated_at: row.updated_at,
    approved_at: approvedAt,
    plan_data: row.plan_data,
    generation_meta: (meta ?? null) as MarketingPlan['generation_meta'],
  }
}

function readApprovedAt(value: unknown): string | null | undefined {
  if (value == null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function readList(result: unknown, clientId: string): PriorApprovedRow[] | null {
  if (!result || typeof result !== 'object') return null
  const body = result as ListBody
  if (body.error) return null
  if (body.data == null) return []
  if (!Array.isArray(body.data)) return null
  const rows: PriorApprovedRow[] = []
  for (const value of body.data) {
    const row = asPrior(value, clientId)
    if (!row) return null
    rows.push(row)
  }
  return rows
}

async function listApproved(clientId: string): Promise<PriorApprovedRow[] | null> {
  const listed = await supabaseAdmin
    .from('marketing_plans')
    .select('id, client_id, status, updated_at, approved_at, plan_data, generation_meta')
    .eq('client_id', clientId)
    .eq('status', 'approved')
  return readList(listed, clientId)
}

function wroteRow(result: { data: unknown; error: unknown }): boolean {
  return !result.error && result.data != null
}

async function archiveOne(row: PriorApprovedRow, approvingId: string, at: string): Promise<boolean> {
  const generation_meta = { ...(row.generation_meta ?? {}), superseded_by: { plan_id: approvingId, at } }
  const result = await supabaseAdmin
    .from('marketing_plans')
    .update({ status: 'archived', generation_meta })
    .eq('id', row.id)
    .eq('client_id', row.client_id)
    .eq('status', 'approved')
    .eq('updated_at', row.updated_at)
    .select('id')
    .maybeSingle()
  return wroteRow(result)
}

async function restoreOne(row: PriorApprovedRow, approvingId: string): Promise<boolean> {
  const result = await supabaseAdmin
    .from('marketing_plans')
    .update({ status: 'approved', generation_meta: row.generation_meta })
    .eq('id', row.id)
    .eq('client_id', row.client_id)
    .eq('status', 'archived')
    .eq('generation_meta->superseded_by->>plan_id', approvingId)
    .select('id')
    .maybeSingle()
  return wroteRow(result)
}

async function restoreAll(rows: readonly PriorApprovedRow[], approvingId: string): Promise<boolean> {
  let ok = true
  for (const row of rows) {
    try {
      if (!await restoreOne(row, approvingId)) ok = false
    } catch {
      ok = false
    }
  }
  return ok
}

async function miss(done: readonly PriorApprovedRow[], approvingId: string): Promise<ArchiveSameGoalResult> {
  const rolledBack = await restoreAll(done, approvingId)
  return failed(rolledBack, rolledBack ? NOT_ARCHIVED : STUCK)
}

/** Archive every other approved plan for this goal. Empty goal archives nothing. */
export async function archiveSameGoalApprovedPlans(args: {
  clientId: string
  approving: Pick<MarketingPlan, 'id' | 'plan_data' | 'generation_meta'>
  at: string
}): Promise<ArchiveSameGoalResult> {
  if (planLinkedGoalId(args.approving) === '') return { ok: true, archived: [] }
  let listed: PriorApprovedRow[] | null
  try {
    listed = await listApproved(args.clientId)
  } catch {
    return failed(true, UNREAD)
  }
  if (!listed) return failed(true, UNREAD)
  const targets = priorApprovedSameGoal(args.approving, args.clientId, listed)
  const done: PriorApprovedRow[] = []
  for (const row of targets) {
    try {
      if (!await archiveOne(row, args.approving.id, args.at)) return miss(done, args.approving.id)
    } catch {
      return miss(done, args.approving.id)
    }
    done.push(row)
  }
  return { ok: true, archived: done }
}

type ReconcileArgs = {
  clientId: string
  approving: Pick<MarketingPlan, 'id' | 'plan_data' | 'generation_meta'>
}

type ReconcileResult = { ok: true; keptId: string | null } | { ok: false; error: string }

/**
 * After a new approval is saved, keep only the latest approved plan for its goal.
 * Safe to run twice: a loser another request already archived stays archived.
 */
export async function reconcileSameGoalApprovedPlans(args: ReconcileArgs): Promise<ReconcileResult> {
  if (planLinkedGoalId(args.approving) === '') return { ok: true, keptId: null }
  try {
    return await finishReconcile(args)
  } catch {
    return { ok: false, error: RECONCILE_UNREAD }
  }
}

async function finishReconcile(args: ReconcileArgs): Promise<ReconcileResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await reconcilePass(args)
    if (outcome !== 'retry') return outcome
  }
  return { ok: false, error: RECONCILE_LEFT }
}

async function reconcilePass(args: ReconcileArgs): Promise<ReconcileResult | 'retry'> {
  const listed = await listApproved(args.clientId)
  if (!listed) return { ok: false, error: RECONCILE_UNREAD }
  const goalId = planLinkedGoalId(args.approving)
  const same = listed.filter(row => row.client_id === args.clientId && planLinkedGoalId(row) === goalId)
  const keptId = keptApprovedPlanId(same)
  if (keptId === null) return { ok: true, keptId: null }
  const at = same.find(row => row.id === keptId)?.approved_at ?? new Date().toISOString()
  const archived = await archiveLosers(same.filter(row => row.id !== keptId), keptId, at)
  if (archived === 'ok') return { ok: true, keptId }
  if (archived === 'retry') return 'retry'
  return { ok: false, error: RECONCILE_LEFT }
}

async function archiveLosers(
  losers: readonly PriorApprovedRow[],
  keeperId: string,
  at: string,
): Promise<'ok' | 'retry' | 'fail'> {
  for (const row of losers) {
    const outcome = await archiveOrSkip(row, keeperId, at)
    if (outcome !== 'ok') return outcome
  }
  return 'ok'
}

async function archiveOrSkip(
  row: PriorApprovedRow,
  keeperId: string,
  at: string,
): Promise<'ok' | 'retry' | 'fail'> {
  try {
    if (await archiveOne(row, keeperId, at)) return 'ok'
  } catch {
    return 'fail'
  }
  const still = await stillApproved(row)
  if (still === true) return 'retry'
  return still === null ? 'fail' : 'ok'
}

async function stillApproved(row: PriorApprovedRow): Promise<boolean | null> {
  try {
    const status = await currentStatus(row.client_id, row.id)
    if (status === null) return null
    return status === 'approved'
  } catch {
    return null
  }
}

async function currentStatus(clientId: string, planId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('marketing_plans')
    .select('status')
    .eq('id', planId)
    .eq('client_id', clientId)
    .maybeSingle<{ status: string }>()
  if (error || !data || typeof data.status !== 'string') return null
  return data.status
}

async function otherApprovedForGoal(args: {
  clientId: string
  planId: string
  approving?: Pick<MarketingPlan, 'id' | 'plan_data' | 'generation_meta'>
}): Promise<boolean> {
  if (!args.approving) return false
  const goalId = planLinkedGoalId(args.approving)
  if (goalId === '') return false
  try {
    const listed = await listApproved(args.clientId)
    if (!listed) return false
    return listed.some(row => row.id !== args.planId && planLinkedGoalId(row) === goalId)
  } catch {
    return false
  }
}

/**
 * Put archived plans back unless the new plan is already approved
 * (another request won the race and the archive should stand).
 */
export async function releaseSupersedeUnlessApproved(args: {
  clientId: string
  planId: string
  approvingId: string
  approving?: Pick<MarketingPlan, 'id' | 'plan_data' | 'generation_meta'>
  archived: readonly PriorApprovedRow[]
}): Promise<{ ok: true; planNowApproved: boolean } | { ok: false; error: string }> {
  if (args.archived.length === 0) return { ok: true, planNowApproved: false }
  let status: string | null
  try {
    status = await currentStatus(args.clientId, args.planId)
  } catch {
    status = null
  }
  if (status === 'approved') return { ok: true, planNowApproved: true }
  // Another draft for this goal may have been approved while ours failed.
  // Putting the old plans back would then leave two approved plans.
  if (await otherApprovedForGoal(args)) return { ok: true, planNowApproved: false }
  const rolledBack = await restoreAll(args.archived, args.approvingId)
  if (!rolledBack) return { ok: false, error: UNDO_STUCK }
  return { ok: true, planNowApproved: false }
}
