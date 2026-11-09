/**
 * Database access for the daily-plan auto-publish *worker*.
 *
 * This module is the only place the unattended scheduler talks to the two
 * auto-publish tables: `daily_plan_auto_publish_auth` (the standing grant) and
 * `daily_plan_auto_publish_attempts` (one row per date the scheduler has
 * touched). The fail-closed *decisions* live in `daily-plan-auto-publish-decide.ts`;
 * this module only reads and writes rows, so the rules stay unit-testable
 * without a database.
 *
 * Database errors are thrown, never swallowed — a caller that cannot tell
 * "the write failed" from "the write succeeded" would be free to double-post.
 * The one deliberate exception is the unique violation on a fresh claim, which
 * is a meaningful outcome ("another sweep already claimed this date") rather
 * than a fault.
 *
 * Every write here is guarded by the state the caller read: a claim only
 * succeeds against the status it was decided from, and a finish only lands on
 * the exact claim that made it. A late finisher must never overwrite a
 * tombstone or another sweep's claim.
 */
import { supabaseAdmin } from '@/lib/supabase'

import { type AutoPublishAuthorization, type AutoPublishAttemptStatus } from './daily-plan-auto-publish'
import { type AttemptRow } from './daily-plan-auto-publish-decide'

const AUTH_TABLE = 'daily_plan_auto_publish_auth'
const ATTEMPTS_TABLE = 'daily_plan_auto_publish_attempts'

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505'

/**
 * The full attempt row, as stored.
 *
 * Extends the pure `AttemptRow` (the subset the claim decision needs) with the
 * columns the worker reads and writes but the decision never inspects.
 */
export interface AttemptRecord extends AttemptRow {
  id: string
  auth_id: string | null
  client_id: string
  plan_id: string
  date: string
  provider_impact: 'NONE' | 'FB_SCHEDULED'
  post_id: string | null
  scheduled_publish_time: string | null
}

/**
 * Every grant that is armed and not revoked.
 *
 * Expiry is *not* filtered here: `judgeAuthorization` owns that decision so the
 * reported reason stays specific. A grant that is revoked or never activated is
 * excluded because the scheduler must never act on one.
 */
export async function listLiveAuthorizations(): Promise<AutoPublishAuthorization[]> {
  const { data, error } = await supabaseAdmin
    .from(AUTH_TABLE)
    .select('*')
    .is('revoked_at', null)
    .not('activated_at', 'is', null)

  if (error) throw error

  return (data ?? []) as AutoPublishAuthorization[]
}

/**
 * The attempt rows for a plan and client, restricted to the given dates.
 *
 * An empty date list short-circuits to `[]` without a query: a sweep with
 * nothing to consider must not spend a round trip.
 */
export async function listAttempts(planId: string, clientId: string, dates: string[]): Promise<AttemptRecord[]> {
  if (dates.length === 0) return []
  const { data, error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .select('*')
    .eq('plan_id', planId)
    .eq('client_id', clientId)
    .in('date', dates)

  if (error) throw error

  return (data ?? []) as AttemptRecord[]
}

/**
 * Atomically claim a date for this sweep.
 *
 * Without `fromStatus` this is a fresh claim: an INSERT that a unique violation
 * turns into `false` (another sweep got there first). With `fromStatus` it is a
 * reclaim of an existing row, guarded so it only lands on the status the caller
 * decided from and never on a `RECALLED` block. Returns whether the claim was
 * taken.
 */
export async function claimAttempt(input: {
  authId: string
  clientId: string
  planId: string
  date: string
  requestId: string
  attemptNo: number
  now: Date
  fromStatus?: AutoPublishAttemptStatus
}): Promise<boolean> {
  const now = input.now.toISOString()

  if (input.fromStatus === undefined) {
    const { error } = await supabaseAdmin.from(ATTEMPTS_TABLE).insert({
      auth_id: input.authId,
      client_id: input.clientId,
      plan_id: input.planId,
      date: input.date,
      attempt_no: input.attemptNo,
      status: 'claimed',
      request_id: input.requestId,
      provider_impact: 'NONE',
      updated_at: now,
    })

    if (error) {
      if (error.code === UNIQUE_VIOLATION) return false
      throw error
    }

    return true
  }

  const { data, error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .update({
      status: 'claimed',
      auth_id: input.authId,
      request_id: input.requestId,
      attempt_no: input.attemptNo,
      reason_code: null,
      next_retry_at: null,
      post_id: null,
      scheduled_publish_time: null,
      provider_impact: 'NONE',
      updated_at: now,
    })
    .eq('plan_id', input.planId)
    .eq('date', input.date)
    .eq('status', input.fromStatus)
    .or('reason_code.is.null,reason_code.neq.RECALLED')
    .select('id')
    .maybeSingle()

  if (error) throw error

  return data !== null
}

/** The columns a finisher may set on an attempt row. */
export interface AttemptPatch {
  status: AutoPublishAttemptStatus
  reason_code?: string | null
  post_id?: string | null
  scheduled_publish_time?: string | null
  provider_impact?: 'NONE' | 'FB_SCHEDULED'
  next_retry_at?: string | null
}

/**
 * Record the outcome of a claim.
 *
 * Guarded by `request_id` and `status = 'claimed'` so a late finisher cannot
 * overwrite a tombstone written after the claim, or another sweep's reclaim.
 * Returns whether a row was updated.
 */
export async function finishAttempt(input: {
  planId: string
  date: string
  requestId: string
  patch: AttemptPatch
  now: Date
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .update({ ...input.patch, updated_at: input.now.toISOString() })
    .eq('plan_id', input.planId)
    .eq('date', input.date)
    .eq('request_id', input.requestId)
    .eq('status', 'claimed')
    .select('id')
    .maybeSingle()

  if (error) throw error

  return data !== null
}

/**
 * Attempt rows from `sinceDate` onward that a human should look at.
 *
 * A `failed_final`, `unknown_outcome` or `missed_window` row is a date the
 * scheduler has given up on. A `blocked` row counts too, unless its reason is
 * `RECALLED` — a recall is a deliberate human decision, not something to chase.
 */
export async function listAttemptsNeedingAttention(sinceDate: string): Promise<AttemptRecord[]> {
  const { data, error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .select('*')
    .gte('date', sinceDate)
    .or(
      'status.in.(failed_final,unknown_outcome,missed_window),and(status.eq.blocked,or(reason_code.is.null,reason_code.neq.RECALLED))',
    )

  if (error) throw error

  return (data ?? []) as AttemptRecord[]
}

/**
 * Resolve an `unknown_outcome` row after a human checked the Page.
 *
 * Only a row whose status is `unknown_outcome` may be changed: a date that has
 * since been published, tombstoned or reclaimed must not be rewritten by a
 * stale confirmation. Returns the updated row, or null when no such row exists.
 */
export async function confirmUnknownOutcome(input: {
  planId: string
  clientId: string
  date: string
  outcome: 'published' | 'not_published'
  now: Date
}): Promise<AttemptRecord | null> {
  const patch =
    input.outcome === 'published'
      ? { status: 'published', reason_code: 'CONFIRMED_BY_PM' }
      : {
          status: 'failed_retryable',
          reason_code: 'CONFIRMED_NOT_PUBLISHED_BY_PM',
          next_retry_at: input.now.toISOString(),
        }

  const { data, error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .update({ ...patch, updated_at: input.now.toISOString() })
    .eq('plan_id', input.planId)
    .eq('client_id', input.clientId)
    .eq('date', input.date)
    .eq('status', 'unknown_outcome')
    .select('*')
    .maybeSingle()

  if (error) throw error

  return (data as AttemptRecord | null) ?? null
}

/**
 * A new authorisation starts clean for the dates it covers: rows that only meant "not yet" or "not
 * this time" (missed window, gave up, waiting to retry, practice, a block that may since have been
 * fixed) are removed. Rows that carry a fact about Facebook stay: `published`, `unknown_outcome`,
 * `claimed` (in flight) and the RECALLED tombstone.
 */
export async function clearNonStickyAttempts(input: { planId: string; clientId: string; dates: string[] }): Promise<void> {
  if (input.dates.length === 0) return
  const { error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .delete()
    .eq('plan_id', input.planId)
    .eq('client_id', input.clientId)
    .in('date', input.dates)
    .or(
      'status.in.(missed_window,failed_final,failed_retryable,dry_run),and(status.eq.blocked,or(reason_code.is.null,reason_code.neq.RECALLED))',
    )

  if (error) throw error
}

/** Attempts of this plan that the unattended publisher claimed at or after `since` and has not closed. */
export async function listFreshClaims(planId: string, clientId: string, since: Date): Promise<AttemptRecord[]> {
  const { data, error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .select('*')
    .eq('plan_id', planId)
    .eq('client_id', clientId)
    .eq('status', 'claimed')
    .gte('updated_at', since.toISOString())

  if (error) throw error

  return (data ?? []) as AttemptRecord[]
}

/** True when a database error means "this table does not exist (yet)" — Postgres 42P01 or PostgREST PGRST205. */
export function isMissingTableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code === '42P01' || code === 'PGRST205') return true
  return typeof message === 'string' && /relation .* does not exist|could not find the table/i.test(message)
}
