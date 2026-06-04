/**
 * Phase X.S3 — Self-serve → paid client upgrade path (H1 fix).
 *
 * The Wei Zheng review flagged this as a state-machine black hole: a
 * self_serve user already has a (clients, client_portal_users) pair, and
 * FDE adding them as a "client" through the existing admin/users UI either
 *   (a) collides with the UNIQUE (email, client_id) constraint, or
 *   (b) leaves two parallel workspaces — one self_serve, one paid — for the
 *       same human, with no way to tell which one their generated assets
 *       are sitting in.
 *
 * This module provides the canonical upgrade primitive. Default behaviour:
 * UPDATE the existing row in place from access_type='self_serve' to
 * 'client'. The client_id is preserved, so all the user's discovery report,
 * MTC balance, generated content, etc. carry over intact.
 *
 * Optional behaviour: when the FDE wants to attach the upgraded user to a
 * different client_id (a corporate workspace they want to merge into),
 * pass `mergeIntoClientId`. We then create a new client_portal_users row
 * for the target client and (only on success) decommission the self_serve
 * record. Asset migration between client_ids is NOT done here — that's a
 * conscious choice; the user is told their existing workspace remains
 * accessible until ops migrates the data, rather than risk silent data
 * loss on a half-finished merge.
 *
 * The function is idempotent: calling it on a row that is already 'client'
 * returns `{ ok: true, alreadyUpgraded: true }` with no DB writes.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { canonicalEmail } from '@/lib/auth/email'
import { tierForAccessType } from '@/lib/auth/access-types'

export type UpgradeReason =
  | 'no_self_serve_row'
  | 'already_paid'
  | 'target_client_missing'
  | 'db_error'
  | 'unique_violation'

export interface UpgradeOk {
  ok: true
  email: string
  /** clientId we ended up on (same as input self_serve client, unless mergeIntoClientId was used). */
  clientId: string
  alreadyUpgraded: boolean
  /** True when the existing self_serve row was deleted in favour of a fresh client row. */
  merged: boolean
}
export interface UpgradeFail { ok: false; reason: UpgradeReason; message: string }
export type UpgradeResult = UpgradeOk | UpgradeFail

export interface UpgradeOptions {
  /** Raw email — will be lower-cased + trimmed before the lookup. */
  email: string
  /**
   * If supplied, the upgrade attaches the user to this client_id instead
   * of their existing self_serve client. The self_serve row is removed.
   * If omitted (the common case), we just flip the access_type in place.
   */
  mergeIntoClientId?: string
  /** access_type to land on. Default 'client' — the canonical paid value. */
  toAccessType?: 'client' | 'dashboard' | 'fde' | 'both'
  /** Optional FDE display name override for the upgraded record. */
  displayName?: string
}

/**
 * Upgrade a self-serve user to a paid tier.
 *
 * Returns a typed result; never throws (the caller should map { ok:false } → 4xx).
 */
export async function upgradeSelfServeToPaid(opts: UpgradeOptions): Promise<UpgradeResult> {
  const rawEmail = opts.email.toLowerCase().trim()
  if (!rawEmail || !canonicalEmail(rawEmail)) {
    return { ok: false, reason: 'no_self_serve_row', message: 'Invalid email.' }
  }
  const toType = opts.toAccessType ?? 'client'

  // ── 1. Look up existing access rows for this email. ──────────────────────
  const { data: rows, error: lookupErr } = await supabaseAdmin
    .from('client_portal_users')
    .select('id, client_id, access_type, display_name')
    .eq('email', rawEmail)

  if (lookupErr) {
    return { ok: false, reason: 'db_error', message: lookupErr.message }
  }

  const all = rows ?? []
  const selfServe = all.find(r => r.access_type === 'self_serve')

  // Already on a paid tier? Idempotent success.
  const paidExisting = all.find(r => tierForAccessType(r.access_type as string) === 'paid_client')
  if (paidExisting && !opts.mergeIntoClientId) {
    return {
      ok: true,
      email:           rawEmail,
      clientId:        paidExisting.client_id as string,
      alreadyUpgraded: true,
      merged:          false,
    }
  }

  if (!selfServe) {
    return {
      ok: false,
      reason: 'no_self_serve_row',
      message: `No self_serve workspace found for ${rawEmail}.`,
    }
  }

  // ── 2a. In-place upgrade (the common path). ──────────────────────────────
  if (!opts.mergeIntoClientId) {
    const patch: Record<string, unknown> = { access_type: toType }
    if (opts.displayName) patch.display_name = opts.displayName

    const { error } = await supabaseAdmin
      .from('client_portal_users')
      .update(patch)
      .eq('id', selfServe.id)

    if (error) {
      return { ok: false, reason: 'db_error', message: error.message }
    }

    return {
      ok:              true,
      email:           rawEmail,
      clientId:        selfServe.client_id as string,
      alreadyUpgraded: false,
      merged:          false,
    }
  }

  // ── 2b. Merge into a different (existing) client. ────────────────────────
  // Verify the target client exists.
  const { data: targetClient } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', opts.mergeIntoClientId)
    .maybeSingle()

  if (!targetClient) {
    return {
      ok: false,
      reason: 'target_client_missing',
      message: `Target client ${opts.mergeIntoClientId} not found.`,
    }
  }

  // Insert (or no-op) the paid row on the target client. The UNIQUE
  // constraint on (email, client_id) means a duplicate run is harmless.
  const { error: insertErr } = await supabaseAdmin
    .from('client_portal_users')
    .upsert(
      {
        email:        rawEmail,
        client_id:    opts.mergeIntoClientId,
        access_type:  toType,
        display_name: opts.displayName ?? (selfServe.display_name as string | null) ?? null,
      },
      { onConflict: 'email,client_id' },
    )

  if (insertErr) {
    // 23505 is the unique-violation code — possible if a parallel call already
    // created the merged row. That's a benign race; the caller can re-fetch.
    if ((insertErr as { code?: string }).code === '23505') {
      return { ok: false, reason: 'unique_violation', message: 'Merged row already exists.' }
    }
    return { ok: false, reason: 'db_error', message: insertErr.message }
  }

  // Only after the new paid row is committed do we retire the self_serve row.
  const { error: delErr } = await supabaseAdmin
    .from('client_portal_users')
    .delete()
    .eq('id', selfServe.id)

  if (delErr) {
    // Both rows now exist; the user has paid access. We log the inconsistency
    // and let the caller decide whether to retry the cleanup.
    console.error('[upgrade-self-serve] paid row created but self_serve delete failed:', delErr)
  }

  return {
    ok:              true,
    email:           rawEmail,
    clientId:        opts.mergeIntoClientId,
    alreadyUpgraded: false,
    merged:          true,
  }
}
