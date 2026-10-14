/**
 * Database access for the daily-plan auto-publish authorization contract.
 *
 * This module is the only place that talks to the two auto-publish tables:
 * `daily_plan_auto_publish_auth` (the standing grant) and
 * `daily_plan_auto_publish_attempts` (one row per date the scheduler has
 * touched). The fail-closed *decisions* live in `daily-plan-auto-publish.ts`;
 * this module only reads and writes rows, so the rules stay unit-testable
 * without a database.
 *
 * Database errors are thrown, never swallowed — a caller that cannot tell
 * "the write failed" from "the write succeeded" would be free to double-post.
 * The one deliberate exception is the unique-violation on insert, which is a
 * meaningful outcome (`ALREADY_AUTHORIZED`) rather than a fault.
 */
import { randomUUID } from 'node:crypto'

import { supabaseAdmin } from '@/lib/supabase'

import { type AutoPublishAuthorization, remainingAuthorizedDates } from './daily-plan-auto-publish'

/**
 * The columns a caller supplies when granting an authorization.
 *
 * `id` is assigned by the database and the three revocation columns start
 * null, so they are omitted here rather than defaulted at the call site.
 */
export type NewAutoPublishAuthorization = Omit<
  AutoPublishAuthorization,
  'id' | 'activated_at' | 'revoked_at' | 'revoked_by_email' | 'revoked_reason'
>

export type InsertAuthorizationResult =
  | { ok: true; authorization: AutoPublishAuthorization }
  | { ok: false; error: 'ALREADY_AUTHORIZED' }

const AUTH_TABLE = 'daily_plan_auto_publish_auth'
const ATTEMPTS_TABLE = 'daily_plan_auto_publish_attempts'

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505'

/**
 * Insert a new standing authorization.
 *
 * A unique violation means an active grant already exists for the plan; that
 * is reported as `ALREADY_AUTHORIZED` so the route can answer 409 rather than
 * 500. Every other database error is thrown.
 */
export async function insertAuthorization(row: NewAutoPublishAuthorization): Promise<InsertAuthorizationResult> {
  const { data, error } = await supabaseAdmin.from(AUTH_TABLE).insert(row).select('*').single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: 'ALREADY_AUTHORIZED' }
    throw error
  }

  return { ok: true, authorization: data as AutoPublishAuthorization }
}

/**
 * The active (non-revoked) authorization for a plan, or null when there is
 * none. Expiry is *not* filtered here: `judgeAuthorization` owns that decision
 * so the reported reason stays specific.
 */
export async function getActiveAuthorization(
  planId: string,
  clientId: string,
): Promise<AutoPublishAuthorization | null> {
  const { data, error } = await supabaseAdmin
    .from(AUTH_TABLE)
    .select('*')
    .eq('plan_id', planId)
    .eq('client_id', clientId)
    .is('revoked_at', null)
    .maybeSingle()

  if (error) throw error

  return (data as AutoPublishAuthorization | null) ?? null
}

/**
 * Revoke the active authorization for a plan.
 *
 * Returns the revoked row, or null when nothing was active — a second revoke
 * is a no-op rather than an error, because the desired end state already holds.
 */
export async function revokeAuthorization(input: {
  planId: string
  /** When given, revoke exactly this grant (never a newer one that replaced it). */
  authId?: string
  /** The client the caller is acting for; a plan id from another client must not match. */
  clientId: string
  byEmail: string
  reason: string
  now?: Date
}): Promise<AutoPublishAuthorization | null> {
  const revokedAt = (input.now ?? new Date()).toISOString()

  let query = supabaseAdmin
    .from(AUTH_TABLE)
    .update({
      revoked_at: revokedAt,
      revoked_by_email: input.byEmail,
      revoked_reason: input.reason,
    })
    .eq('plan_id', input.planId)
    .eq('client_id', input.clientId)
  if (input.authId) query = query.eq('id', input.authId)

  const { data, error } = await query.is('revoked_at', null).select('*').maybeSingle()

  if (error) throw error

  return (data as AutoPublishAuthorization | null) ?? null
}

/**
 * Arm a grant: stamp `activated_at` once its authorisation event was sent.
 * Returns the activated row, or null when it was revoked in the meantime.
 */
export async function activateAuthorization(input: {
  authId: string
  clientId: string
  now?: Date
}): Promise<AutoPublishAuthorization | null> {
  const { data, error } = await supabaseAdmin
    .from(AUTH_TABLE)
    .update({ activated_at: (input.now ?? new Date()).toISOString() })
    .eq('id', input.authId)
    .eq('client_id', input.clientId)
    .is('revoked_at', null)
    .select('*')
    .maybeSingle()

  if (error) throw error

  return (data as AutoPublishAuthorization | null) ?? null
}

/**
 * Remove the RECALLED tombstones for dates the PM explicitly chose to send again.
 * Only RECALLED blocks are removed; every other attempt row is left untouched.
 */
export async function liftRecalledTombstones(input: {
  planId: string
  clientId: string
  dates: string[]
  /** Only blocks written at or before this instant are removed — a recall that landed after the caller looked must survive. */
  notNewerThan: Date
}): Promise<void> {
  if (input.dates.length === 0) return
  const { error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .delete()
    .eq('plan_id', input.planId)
    .eq('client_id', input.clientId)
    // the RECALLED tombstone, or a `published` row left over from before the post was taken down
    .or('and(status.eq.blocked,reason_code.eq.RECALLED),status.eq.published')
    .in('date', input.dates)
    .lte('updated_at', input.notNewerThan.toISOString())

  if (error) throw error
}

/**
 * Dates of a plan that a human recalled and that the automatic publisher must
 * therefore never send again (attempts rows blocked with reason RECALLED).
 */
export async function findRecalledDates(planId: string, clientId: string, dates: string[]): Promise<string[]> {
  if (dates.length === 0) return []
  const { data, error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .select('date')
    .eq('plan_id', planId)
    .eq('client_id', clientId)
    .eq('status', 'blocked')
    .eq('reason_code', 'RECALLED')
    .in('date', dates)

  if (error) throw error

  return ((data ?? []) as Array<{ date: string }>).map(row => row.date)
}

/**
 * Dates recorded as recalled on the plan's own publish receipt (`publish_meta.recalled[]`).
 * The receipt is the authoritative record of a recall (it is written in the same step as the
 * Graph delete), so this is checked alongside the tombstone table: if the tombstone write ever
 * failed, the receipt still says the post was taken down.
 */
export async function findReceiptRecalledDates(planId: string, clientId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('social_plans')
    .select('plan_data')
    .eq('id', planId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) throw error
  const planData = (data as { plan_data?: unknown } | null)?.plan_data
  if (typeof planData !== 'object' || planData === null) return []
  const meta = (planData as { publish_meta?: unknown }).publish_meta
  if (typeof meta !== 'object' || meta === null) return []
  const recalled = (meta as { recalled?: unknown }).recalled
  if (!Array.isArray(recalled)) return []

  const dates = recalled
    .map(entry => (typeof entry === 'object' && entry !== null ? (entry as { date?: unknown }).date : undefined))
    .filter((date): date is string => typeof date === 'string')
  return Array.from(new Set(dates))
}

/**
 * Record recalled dates so the scheduler can never publish them again.
 *
 * A recall is a human taking a post down. The date is tombstoned in the
 * attempts table (status `blocked`, reason `RECALLED`) whether or not a grant
 * is active right now — a recall after a revoke must still stick, otherwise a
 * later re-authorisation would re-send the post. If a grant is active the date
 * is also removed from it, and when every authorized date has been recalled the
 * grant itself is revoked.
 *
 * A date whose attempt is `claimed` (the publisher is mid-send) cannot be
 * tombstoned safely: this throws `TOMBSTONE_RACE_CLAIMED` so the caller reports
 * it loudly instead of silently overwriting an in-flight claim.
 */
export async function tombstoneRecalledDates(input: {
  clientId: string
  planId: string
  dates: string[]
}): Promise<{ tombstoned: number }> {
  if (input.dates.length === 0) return { tombstoned: 0 }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .select('date, status')
    .eq('plan_id', input.planId)
    .eq('client_id', input.clientId)
    .in('date', input.dates)

  if (existingError) throw existingError
  const inFlight = ((existing ?? []) as Array<{ date: string; status: string }>).filter(r => r.status === 'claimed')
  if (inFlight.length > 0) throw new Error('TOMBSTONE_RACE_CLAIMED')

  const auth = await getActiveAuthorization(input.planId, input.clientId)
  const now = new Date().toISOString()

  // An `unknown_outcome` row carries a "go and check the Page" signal; keep it. Such a date is
  // still caught by the receipt's `recalled[]` (see findReceiptRecalledDates).
  const keepAsIs = new Set(
    ((existing ?? []) as Array<{ date: string; status: string }>)
      .filter(r => r.status === 'unknown_outcome')
      .map(r => r.date),
  )
  const attemptRows = input.dates.filter(date => !keepAsIs.has(date)).map(date => ({
    auth_id: auth?.id ?? null,
    client_id: input.clientId,
    plan_id: input.planId,
    date,
    status: 'blocked',
    reason_code: 'RECALLED',
    request_id: randomUUID(),
    provider_impact: 'NONE',
    updated_at: now,
  }))

  if (attemptRows.length > 0) {
    const { error: upsertError } = await supabaseAdmin
      .from(ATTEMPTS_TABLE)
      .upsert(attemptRows, { onConflict: 'plan_id,date' })

    if (upsertError) throw upsertError
  }

  if (auth !== null) {
    const remaining = remainingAuthorizedDates(auth.dates, input.dates)

    if (remaining.length === 0) {
      await revokeAuthorization({
        planId: input.planId,
        clientId: input.clientId,
        authId: auth.id,
        byEmail: 'system:recall',
        reason: 'all authorised dates were recalled',
      })
    } else {
      const { error: updateError } = await supabaseAdmin
        .from(AUTH_TABLE)
        .update({ dates: remaining })
        .eq('id', auth.id)
        .is('revoked_at', null)

      if (updateError) throw updateError
    }
  }

  return { tombstoned: input.dates.length }
}
