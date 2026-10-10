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
  'id' | 'revoked_at' | 'revoked_by_email' | 'revoked_reason'
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
export async function getActiveAuthorization(planId: string): Promise<AutoPublishAuthorization | null> {
  const { data, error } = await supabaseAdmin
    .from(AUTH_TABLE)
    .select('*')
    .eq('plan_id', planId)
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
  byEmail: string
  reason: string
  now?: Date
}): Promise<AutoPublishAuthorization | null> {
  const revokedAt = (input.now ?? new Date()).toISOString()

  const { data, error } = await supabaseAdmin
    .from(AUTH_TABLE)
    .update({
      revoked_at: revokedAt,
      revoked_by_email: input.byEmail,
      revoked_reason: input.reason,
    })
    .eq('plan_id', input.planId)
    .is('revoked_at', null)
    .select('*')
    .maybeSingle()

  if (error) throw error

  return (data as AutoPublishAuthorization | null) ?? null
}

/**
 * Record recalled dates so the scheduler can never publish them again.
 *
 * A recall is a human taking a post down; the grant may still list the date,
 * so the date is tombstoned in the attempts table (status `blocked`, reason
 * `RECALLED`) and then removed from the grant. When every authorized date has
 * been recalled the grant itself is revoked, because there is nothing left for
 * it to authorize.
 */
export async function tombstoneRecalledDates(input: {
  clientId: string
  planId: string
  dates: string[]
}): Promise<{ tombstoned: number }> {
  if (input.dates.length === 0) return { tombstoned: 0 }

  const auth = await getActiveAuthorization(input.planId)
  if (auth === null) return { tombstoned: 0 }

  const now = new Date().toISOString()

  const attemptRows = input.dates.map(date => ({
    auth_id: auth.id,
    client_id: input.clientId,
    plan_id: input.planId,
    date,
    status: 'blocked',
    reason_code: 'RECALLED',
    request_id: randomUUID(),
    provider_impact: 'NONE',
    updated_at: now,
  }))

  const { error: upsertError } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .upsert(attemptRows, { onConflict: 'plan_id,date' })

  if (upsertError) throw upsertError

  const remaining = remainingAuthorizedDates(auth.dates, input.dates)

  if (remaining.length === 0) {
    await revokeAuthorization({
      planId: input.planId,
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

  return { tombstoned: input.dates.length }
}
