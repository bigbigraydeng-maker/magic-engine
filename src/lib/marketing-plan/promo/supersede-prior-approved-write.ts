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
 */

import type { MarketingPlan } from '../types'
import { supabaseAdmin } from '@/lib/supabase'
import { planLinkedGoalId } from './plan-pick'
import {
  priorApprovedSameGoal,
  type PriorApprovedRow,
} from './supersede-prior-approved'

const UNREAD = '同一目标下的旧计划没读全，这次没有批准。请稍后重试。'
const NOT_ARCHIVED = '同一目标下的旧计划没能一起归档，这次没有批准。请刷新后再试。'
const STUCK = '旧计划归档到一半没完成，而且没能全部改回已批准。请刷新后核对，先不要再批一份。'
export const UNDO_STUCK = '批准没有保存成功，旧计划也没能全部改回已批准。请刷新后核对，先不要再批一份。'

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
  const meta = row.generation_meta
  if (meta !== null && meta !== undefined && (typeof meta !== 'object' || Array.isArray(meta))) return null
  return {
    id: row.id,
    client_id: clientId,
    status: 'approved',
    updated_at: row.updated_at,
    plan_data: row.plan_data,
    generation_meta: (meta ?? null) as MarketingPlan['generation_meta'],
  }
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
    .select('id, client_id, status, updated_at, plan_data, generation_meta')
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

/**
 * Put archived plans back unless the new plan is already approved
 * (another request won the race and the archive should stand).
 */
export async function releaseSupersedeUnlessApproved(args: {
  clientId: string
  planId: string
  approvingId: string
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
  const rolledBack = await restoreAll(args.archived, args.approvingId)
  if (!rolledBack) return { ok: false, error: UNDO_STUCK }
  return { ok: true, planNowApproved: false }
}
