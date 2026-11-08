/**
 * The card is valid only for the approved prescription it was issued from.
 * A later version, goal, or plan makes the card stale.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { draftPlanIdOf } from '@/lib/marketing-plan/promo/plan-draft-agree'

export interface PrescriptionLock {
  readonly prescriptionId: string
  readonly version: number
  readonly goalId: string
  readonly planId: string | null
  readonly planHash: string
  readonly approvedOn: string
}

export type LockRead =
  | { readonly ok: true; readonly lock: PrescriptionLock }
  | { readonly ok: false; readonly reason: string }

export interface VersionLockSource {
  read(clientId: string, prescriptionId: string): Promise<LockRead>
}

export function sameLock(saved: PrescriptionLock, live: PrescriptionLock): boolean {
  return saved.prescriptionId === live.prescriptionId
    && saved.version === live.version
    && saved.goalId === live.goalId
    && saved.planId === live.planId
    && saved.planHash === live.planHash
    && saved.approvedOn === live.approvedOn
}

export function planHashOf(planId: string | null, planSeed: unknown): string {
  return canonicalHashOfInput({ planId, planSeed: planSeed ?? null })
}

export function prescriptionLockSource(sb: SupabaseClient): VersionLockSource {
  return { read: (clientId, prescriptionId) => loadApprovedLock(sb, clientId, prescriptionId) }
}

export async function loadApprovedLock(
  sb: SupabaseClient,
  clientId: string,
  prescriptionId: string,
): Promise<LockRead> {
  const { data, error } = await sb.from('prescriptions')
    .select('id, status, version, goal_id, approved_at, content, generation_meta')
    .eq('id', prescriptionId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) return { ok: false, reason: '处方读不出来，没有出卡。' }
  return lockFromRow(prescriptionId, data)
}

function lockFromRow(prescriptionId: string, data: unknown): LockRead {
  const row = asRecord(data)
  if (!row) return { ok: false, reason: '找不到这份已批准的处方，没有出卡。' }
  if (row.status !== 'approved') return { ok: false, reason: '处方还没批准，没有出卡。' }
  const version = row.version
  const goalId = row.goal_id
  const approvedOn = dayOf(row.approved_at)
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    return { ok: false, reason: '处方版本读不到，没有出卡。' }
  }
  if (typeof goalId !== 'string' || goalId.length === 0) {
    return { ok: false, reason: '处方没有挂增长目标，没有出卡。' }
  }
  if (!approvedOn) return { ok: false, reason: '处方的批准日期读不到，没有出卡。' }
  const planId = draftPlanIdOf(row.generation_meta)
  const seed = asRecord(row.content)?.plan_seed ?? null
  return {
    ok: true,
    lock: {
      prescriptionId,
      version: version as number,
      goalId,
      planId,
      planHash: planHashOf(planId, seed),
      approvedOn,
    },
  }
}

function dayOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
