/**
 * Campaign Daily Plan — auto-publish decision module (pure).
 *
 * This module owns the *decisions* an unattended scheduler must make before it
 * is allowed to touch a provider: whether the feature is live for a client,
 * whether a date is blocked by recall evidence, whether an existing attempt row
 * permits a fresh claim, and how to interpret the publish runner's response.
 *
 * It never touches a database, the network, or `process.env` directly — the
 * environment is passed in as a plain object, so every rule here is unit
 * testable without a Supabase stub or a fetch mock.
 *
 * Relationship to `daily-plan-auto-publish.ts`: that module owns the *contract*
 * (command schemas, the stored authorization shape, the verdict helper). This
 * module consumes that contract's types and adds the per-sweep decision logic.
 */
import {
  AUTO_PUBLISH_MAX_PER_DAY_CEILING,
  type AutoPublishAttemptStatus,
} from './daily-plan-auto-publish'
import { ABORTED_BEFORE_SEND_ERROR, MISSED_WINDOW_ERROR } from './daily-plan-publish'

/** Hard ceiling on how many times one date may be attempted before it is final. */
export const AUTO_PUBLISH_MAX_ATTEMPTS = 3

/**
 * Minutes to wait before each retry, indexed by `attemptNo - 1`.
 *
 * The schedule is deliberately short and bounded: a provider rejection is
 * usually transient (rate limit, brief outage), and a date whose slot has
 * passed is worthless to retry hours later. Three attempts inside an hour
 * either succeed or hand the date to a human.
 */
export const AUTO_PUBLISH_RETRY_BACKOFF_MINUTES = [10, 20, 40] as const

/**
 * How long a `claimed` row may sit untouched before another sweep may take it.
 *
 * A worker that dies mid-publish leaves a `claimed` row behind; without a
 * staleness window that date would be stuck forever. Fifteen minutes is longer
 * than any healthy publish call and short enough that a stuck date still gets
 * a chance inside its own morning slot.
 */
export const AUTO_PUBLISH_STALE_CLAIM_MINUTES = 15

// ─── Dates ────────────────────────────────────────────────────────────────────

/**
 * The calendar date in Pacific/Auckland as `YYYY-MM-DD`.
 *
 * Uses `en-CA` because its short date format is already ISO-ordered, so no
 * manual field shuffling is needed. The plan's `date` field is an NZ calendar
 * label, so "today" must be resolved in NZ — a UTC date would be a day behind
 * for the first twelve hours of every NZ day.
 */
export function nzDateString(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(now)
}

/**
 * Add N calendar days to a `YYYY-MM-DD` string, staying in that format.
 *
 * Uses UTC midnight so DST transitions and local-timezone quirks never bump the
 * date. The input is a calendar label, not a wall-clock instant, so the
 * arithmetic must not depend on any timezone.
 */
export function addDaysToDateString(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  const yy = shifted.getUTCFullYear().toString().padStart(4, '0')
  const mm = (shifted.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = shifted.getUTCDate().toString().padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * The dates a sweep should consider: today and tomorrow in NZ.
 *
 * Tomorrow is included because a post scheduled for tomorrow morning may need
 * its claim taken now — the scheduler runs on a coarse cadence and must not
 * miss a slot that opens between two sweeps.
 */
export function dueWindowDates(now: Date): string[] {
  const today = nzDateString(now)
  return [today, addDaysToDateString(today, 1)]
}

// ─── Feature switches ─────────────────────────────────────────────────────────

/** The two environment-driven switches that gate unattended publishing. */
export interface AutoPublishSwitches {
  /** True only when the env value is exactly the string `'true'`. */
  live: boolean
  /** Lowercased, trimmed client ids the feature is enabled for. */
  clientIds: string[]
}

/**
 * Read the auto-publish switches from an environment object.
 *
 * `live` is strict on purpose: `'TRUE'`, `'1'`, `' true'` and `'yes'` all leave
 * the feature off. A typo in a deploy config must fail closed, not arm an
 * unattended publisher.
 */
export function readAutoPublishSwitches(env: {
  DAILY_PLAN_AUTO_PUBLISH_LIVE?: string
  DAILY_PLAN_AUTO_PUBLISH_CLIENTS?: string
}): AutoPublishSwitches {
  const live = env.DAILY_PLAN_AUTO_PUBLISH_LIVE === 'true'
  const raw = env.DAILY_PLAN_AUTO_PUBLISH_CLIENTS ?? ''
  const clientIds = raw
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(part => part.length > 0)
  return { live, clientIds }
}

/**
 * Whether unattended publishing is enabled for a specific client.
 *
 * Both switches must agree: the global `live` flag and the client's presence in
 * the allow-list. An empty allow-list therefore disables the feature entirely,
 * even when `live` is true.
 */
export function isLiveFor(switches: AutoPublishSwitches, clientId: string): boolean {
  if (!switches.live) return false
  return switches.clientIds.includes(clientId.toLowerCase())
}

// ─── Recall evidence ──────────────────────────────────────────────────────────

/** The three independent sources of "this date was recalled" evidence. */
export interface RecallEvidence {
  /** Tombstones are permanent: a date here is blocked no matter what else says. */
  tombstoneDates: string[]
  /** Dates the publish receipt recorded as recalled. */
  receiptRecalledDates: string[]
  /** Dates a PM explicitly re-allowed after a recall. */
  liftedDates: string[]
}

/**
 * Whether recall evidence blocks publishing a date.
 *
 * A tombstone always wins, even over a lift: a tombstone is written when a post
 * was taken down for a reason that must not be undone by a later "please
 * re-publish" (a policy violation, a legal request). A receipt recall is
 * softer — it records that the post was pulled, and a PM may legitimately lift
 * it once the content is fixed.
 */
export function isRecallBlocked(date: string, evidence: RecallEvidence): boolean {
  if (evidence.tombstoneDates.includes(date)) return true
  if (evidence.receiptRecalledDates.includes(date)) {
    return !evidence.liftedDates.includes(date)
  }
  return false
}

// ─── Claim decisions ──────────────────────────────────────────────────────────

/** The subset of an attempt row the claim decision needs. */
export interface AttemptRow {
  status: AutoPublishAttemptStatus
  reason_code: string | null
  attempt_no: number
  next_retry_at: string | null
  updated_at: string
  request_id: string
}

/** What a sweep should do with a date, given any existing attempt row. */
export type ClaimDecision =
  | { action: 'claim_new' }
  | { action: 'reclaim'; fromStatus: AutoPublishAttemptStatus }
  | { action: 'skip'; reason: string }

/**
 * Decide whether a sweep may claim a date, given the row already on file.
 *
 * The order of checks encodes the fail-closed rules:
 *  - A `blocked` row with reason `RECALLED` is a permanent stop; any other
 *    block is re-evaluated every sweep, because the condition that blocked it
 *    (a missing token, a transient config error) may have been fixed.
 *  - A `failed_retryable` row is only reclaimable once its backoff has elapsed;
 *    an unparseable or missing `next_retry_at` counts as *not* due, so a
 *    corrupt row cannot cause an immediate retry storm.
 *  - Terminal statuses (`published`, `failed_final`, `unknown_outcome`,
 *    `missed_window`) are never reclaimed.
 */
export function decideClaim(existing: AttemptRow | null, now: Date): ClaimDecision {
  if (existing === null) return { action: 'claim_new' }

  switch (existing.status) {
    case 'blocked':
      if (existing.reason_code === 'RECALLED') return { action: 'skip', reason: 'RECALLED' }
      return { action: 'reclaim', fromStatus: 'blocked' }

    case 'failed_retryable': {
      if (existing.next_retry_at === null) return { action: 'skip', reason: 'WAITING_RETRY' }
      const due = Date.parse(existing.next_retry_at)
      if (Number.isNaN(due)) return { action: 'skip', reason: 'WAITING_RETRY' }
      if (due > now.getTime()) return { action: 'skip', reason: 'WAITING_RETRY' }
      return { action: 'reclaim', fromStatus: 'failed_retryable' }
    }

    case 'dry_run':
      return { action: 'reclaim', fromStatus: 'dry_run' }

    case 'claimed':
      return { action: 'skip', reason: 'CLAIMED_IN_PROGRESS' }

    case 'published':
      return { action: 'skip', reason: 'ALREADY_PUBLISHED' }

    case 'failed_final':
      return { action: 'skip', reason: 'FAILED_FINAL' }

    case 'unknown_outcome':
      return { action: 'skip', reason: 'UNKNOWN_OUTCOME' }

    case 'missed_window':
      return { action: 'skip', reason: 'MISSED_WINDOW' }

    default: {
      // Exhaustiveness guard: a new status added to the contract must be
      // handled explicitly rather than silently falling through to a claim.
      const exhaustive: never = existing.status
      return { action: 'skip', reason: `UNHANDLED_STATUS:${String(exhaustive)}` }
    }
  }
}

/**
 * Whether a `claimed` row is old enough that another sweep may take it over.
 *
 * An unparseable `updated_at` counts as stale: a row whose timestamp cannot be
 * read is more likely corrupt than fresh, and leaving it claimed forever would
 * strand the date.
 */
export function isStaleClaim(row: AttemptRow, now: Date): boolean {
  if (row.status !== 'claimed') return false
  const updated = Date.parse(row.updated_at)
  if (Number.isNaN(updated)) return true
  return now.getTime() - updated > AUTO_PUBLISH_STALE_CLAIM_MINUTES * 60_000
}

// ─── Run-result classification ────────────────────────────────────────────────

/** The outcome of one publish attempt, as the scheduler records it. */
export type AttemptOutcome =
  | { status: 'published'; postId: string | null; scheduledPublishTime: string | null; reasonCode: string | null }
  | { status: 'blocked'; reasonCode: string }
  | { status: 'failed_retryable'; reasonCode: string; nextRetryAt: string }
  | { status: 'failed_final'; reasonCode: string }
  | { status: 'unknown_outcome'; reasonCode: string }
  | { status: 'missed_window'; reasonCode: string }

/** Narrow an unknown value to a plain object (not null, not an array). */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Read a string field, returning null when absent or the wrong type. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Find the first entry in an array whose `date` field equals `date`. */
function findEntryForDate(value: unknown, date: string): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null
  for (const item of value) {
    const record = asRecord(item)
    if (record === null) continue
    if (asString(record.date) === date) return record
  }
  return null
}

/** The backoff for an attempt number, clamped into the schedule's bounds. */
function backoffMinutesFor(attemptNo: number): number {
  const index = Math.min(Math.max(attemptNo - 1, 0), AUTO_PUBLISH_RETRY_BACKOFF_MINUTES.length - 1)
  return AUTO_PUBLISH_RETRY_BACKOFF_MINUTES[index]
}

/**
 * Interpret the publish runner's HTTP response for one date.
 *
 * The runner is a separate process, so its body is untrusted input: every field
 * may be missing, null, or the wrong type. This function never throws — an
 * unreadable body becomes `unknown_outcome`, which the scheduler records as
 * indeterminate rather than as a failure, so a retry cannot double-post.
 *
 * Rules are applied in a fixed order so the most specific interpretation wins:
 * a real `published` entry beats a duplicate marker, which beats a `failed`
 * entry, which beats a generic non-200 block.
 */
export function classifyRunResult(input: {
  date: string
  httpStatus: number
  body: Record<string, unknown>
  attemptNo: number
  now: Date
}): AttemptOutcome {
  const { date, httpStatus, body, attemptNo, now } = input

  const receipt = asRecord(body.receipt)
  const publishedEntry = receipt === null ? null : findEntryForDate(receipt.published, date)
  const failedEntry = receipt === null ? null : findEntryForDate(receipt.failed, date)

  // (b) A real published entry for this date.
  if (httpStatus === 200 && publishedEntry !== null) {
    return {
      status: 'published',
      postId: asString(publishedEntry.post_id),
      scheduledPublishTime: asString(publishedEntry.scheduled_publish_time),
      reasonCode: null,
    }
  }

  // (c) The runner recognised this date as already on the receipt.
  if (httpStatus === 200) {
    const duplicate = findEntryForDate(body.skipped_as_duplicate, date)
    if (duplicate !== null) {
      return {
        status: 'published',
        postId: null,
        scheduledPublishTime: null,
        reasonCode: 'ALREADY_ON_RECEIPT',
      }
    }
  }

  // (d) A failed entry for this date.
  if (httpStatus === 200 && failedEntry !== null) {
    const error = asString(failedEntry.error)
    if (error === MISSED_WINDOW_ERROR) {
      return { status: 'missed_window', reasonCode: 'MISSED_WINDOW' }
    }
    // The last-moment check refused the send (grant revoked / claim lost): nothing went out.
    if (error === ABORTED_BEFORE_SEND_ERROR) {
      return { status: 'blocked', reasonCode: 'ABORTED_BEFORE_SEND' }
    }

    const certainty = asString(failedEntry.certainty)
    if (certainty === 'rejected' || certainty === 'rate_limited') {
      const reasonCode = certainty === 'rate_limited' ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REJECTED'
      if (attemptNo >= AUTO_PUBLISH_MAX_ATTEMPTS) {
        return { status: 'failed_final', reasonCode }
      }
      const nextRetryAt = new Date(now.getTime() + backoffMinutesFor(attemptNo) * 60_000).toISOString()
      return { status: 'failed_retryable', reasonCode, nextRetryAt }
    }

    return { status: 'unknown_outcome', reasonCode: 'PROVIDER_OUTCOME_UNKNOWN' }
  }

  // (e) The runner published but could not persist its receipt.
  if (httpStatus === 500 && asString(body.error) === 'PUBLISH_RECEIPT_NOT_PERSISTED') {
    if (publishedEntry !== null) {
      return {
        status: 'published',
        postId: asString(publishedEntry.post_id),
        scheduledPublishTime: asString(publishedEntry.scheduled_publish_time),
        reasonCode: 'RECEIPT_NOT_PERSISTED',
      }
    }
    return { status: 'unknown_outcome', reasonCode: 'RECEIPT_NOT_PERSISTED' }
  }

  // (f) Any other non-200 status is a block.
  if (httpStatus !== 200) {
    const error = asString(body.error)
    const reasonCode = error !== null && error.length > 0 ? error : `HTTP_${httpStatus}`
    return { status: 'blocked', reasonCode }
  }

  // (g) 200 but nothing about this date.
  return { status: 'unknown_outcome', reasonCode: 'NO_RESULT_FOR_DATE' }
}

// Referenced so the ceiling constant stays part of this module's public surface
// for callers that validate a grant before deciding claims.
void AUTO_PUBLISH_MAX_PER_DAY_CEILING
