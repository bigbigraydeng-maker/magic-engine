/**
 * The card is valid only for the approved prescription it was issued from.
 * A later version, goal, or plan makes the card stale.
 * The live chain is the shared approval source: version, goal, and the one
 * approved plan. A draft plan id is not enough.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readApprovalSource,
  sameApprovalSource,
  type ApprovalSource,
} from '@/lib/approval-source/read'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'

export type PrescriptionLock = ApprovalSource

export type LockRead =
  | { readonly ok: true; readonly lock: PrescriptionLock }
  | { readonly ok: false; readonly reason: string }

export interface VersionLockSource {
  read(clientId: string, prescriptionId: string): Promise<LockRead>
}

export function sameLock(saved: PrescriptionLock, live: PrescriptionLock): boolean {
  return sameApprovalSource(saved, live)
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
  const read = await readApprovalSource(sb, clientId, prescriptionId)
  if (!read.ok) return read
  return { ok: true, lock: read.source }
}
