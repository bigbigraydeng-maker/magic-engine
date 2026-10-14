/**
 * Campaign Daily Plan — auto-publish authorization contract.
 *
 * This module owns the *contract* only: command schemas, the authorization
 * record shape, and the pure verdict/selection helpers. It never talks to a
 * provider and never touches the database — the route does that, so the
 * fail-closed rules here stay unit-testable without a network or a Supabase
 * stub.
 *
 * Relationship to `daily-plan-publish.ts`: that module is the *manual* publish
 * bridge — a human sends an explicit command per batch. This module is the
 * standing authorization a human grants once, which a scheduler may then act
 * on unattended. Because the scheduler acts without a human in the loop, every
 * decision here fails closed: an unparseable expiry is treated as expired, a
 * changed plan revision invalidates the grant, and a revoked grant is refused
 * before anything else is considered.
 */
import { z } from 'zod'

export const DAILY_PLAN_AUTO_PUBLISH_AUTHORIZED_EVENT = 'daily_plan.auto_publish.authorized' as const
export const DAILY_PLAN_AUTO_PUBLISH_REVOKED_EVENT = 'daily_plan.auto_publish.revoked' as const
/** One publish attempt by the unattended publisher reached an outcome (published / blocked / failed / unknown / missed). */
export const DAILY_PLAN_AUTO_PUBLISH_ATTEMPTED_EVENT = 'daily_plan.auto_publish.attempted' as const

/**
 * Outcome of one unattended publish attempt.
 *
 * `unknown_outcome` exists because a provider call can time out after the
 * provider has already accepted it; the attempt must be recorded as
 * indeterminate rather than as a failure, so a retry does not double-post.
 * `missed_window` records a date whose slot passed before the scheduler could
 * act — it is not a failure, it is a skipped opportunity.
 */
export const AUTO_PUBLISH_ATTEMPT_STATUSES = [
  'claimed',
  'published',
  'blocked',
  'failed_retryable',
  'failed_final',
  'unknown_outcome',
  'missed_window',
  'dry_run',
] as const

export type AutoPublishAttemptStatus = (typeof AUTO_PUBLISH_ATTEMPT_STATUSES)[number]

/** Hard ceiling on posts per day, regardless of what a caller requests. */
export const AUTO_PUBLISH_MAX_PER_DAY_CEILING = 3

/** Default lifetime of a grant when the caller does not specify one. */
export const AUTO_PUBLISH_DEFAULT_EXPIRY_DAYS = 14

/** Hard ceiling on grant lifetime, so a typo cannot authorize months of posting. */
export const AUTO_PUBLISH_MAX_EXPIRY_DAYS = 30

// Same loose UUID *shape* check as daily-plan.ts — this repo's seeded client
// ids (e.g. CTS `c0000000-…`) are not RFC4122-valid, so `z.uuid()` rejects them.
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Meta Page ids are numeric strings; reject anything else before we spend a call. */
const pageIdSchema = z.string().regex(/^\d{5,25}$/, 'page_id must be a numeric Meta Page id')

/**
 * Inbound command that grants a standing auto-publish authorization.
 *
 * `confirm` defaults to `false`: a caller who says nothing gets a rejected
 * grant rather than an armed scheduler. Arming requires explicitly sending
 * `confirm: true`.
 */
export const CampaignDailyAutoPublishAuthorizeCommandSchema = z.object({
  /** Echo of the path client id. Mismatch is refused (see route). */
  client_id: uuidLike,
  campaign_id: uuidLike,
  plan_id: uuidLike,
  plan_revision: z.string().datetime(),
  review_revision: uuidLike,
  page_id: pageIdSchema,
  /** The exact dates this grant covers. Omitted dates are never auto-published. */
  dates: z
    .array(dateStringSchema)
    .min(1)
    .max(31)
    .refine(dates => new Set(dates).size === dates.length, 'dates must be unique'),
  max_per_day: z.number().int().min(1).max(AUTO_PUBLISH_MAX_PER_DAY_CEILING).default(1),
  expires_in_days: z.number().int().min(1).max(AUTO_PUBLISH_MAX_EXPIRY_DAYS).default(AUTO_PUBLISH_DEFAULT_EXPIRY_DAYS),
  confirm: z.boolean().default(false),
  /**
   * Recalled dates are blocked for good unless the PM explicitly lifts them here
   * (a recalled post that was fixed and should go out again). Must be a subset of `dates`.
   */
  lift_recalled_dates: z.array(dateStringSchema).max(31).default([]),
}).refine(command => command.lift_recalled_dates.every(date => command.dates.includes(date)), {
  message: 'lift_recalled_dates must be a subset of dates',
  path: ['lift_recalled_dates'],
})

export type CampaignDailyAutoPublishAuthorizeCommand = z.infer<typeof CampaignDailyAutoPublishAuthorizeCommandSchema>

/** Inbound command that revokes an existing authorization. */
export const CampaignDailyAutoPublishRevokeCommandSchema = z.object({
  client_id: uuidLike,
  campaign_id: uuidLike,
  plan_id: uuidLike,
  reason: z.string().trim().min(1).max(300),
})

export type CampaignDailyAutoPublishRevokeCommand = z.infer<typeof CampaignDailyAutoPublishRevokeCommandSchema>

/**
 * A stored authorization row, using the database's snake_case column names.
 *
 * Deliberately not camelCased: this shape is read straight from and written
 * straight to the table, and renaming fields at the boundary is where a
 * `revoked_at`/`revokedAt` mismatch silently disarms the fail-closed checks.
 */
export interface AutoPublishAuthorization {
  id: string
  request_id: string
  client_id: string
  campaign_id: string
  plan_id: string
  plan_revision: string
  review_revision: string
  page_id: string
  dates: string[]
  /** Dates the PM explicitly re-allowed after a recall (see `lift_recalled_dates`). */
  lifted_dates: string[]
  max_per_day: number
  authorized_by_email: string
  authorized_by_user_id: string
  authorized_at: string
  /** Null until the authorisation event was sent; the publisher must treat null as not armed. */
  activated_at: string | null
  expires_at: string
  revoked_at: string | null
  revoked_by_email: string | null
  revoked_reason: string | null
}

export type AuthorizationVerdict =
  | { active: true }
  | { active: false; reason: 'REVOKED' | 'NOT_ACTIVATED' | 'EXPIRED' | 'PLAN_CHANGED' }

/**
 * Decide whether a stored authorization still permits an unattended publish.
 *
 * Checks run in a fixed order so the reported reason is the most specific one:
 * a revoked grant that has also expired reports REVOKED, because revocation is
 * a human decision and expiry is only the passage of time.
 *
 * Fails closed: an `expires_at` that cannot be parsed is treated as EXPIRED
 * rather than as "no expiry".
 */
export function judgeAuthorization(
  auth: AutoPublishAuthorization,
  current: { planId: string; planRevision: string; reviewRevision: string; now: Date },
): AuthorizationVerdict {
  if (auth.revoked_at !== null) return { active: false, reason: 'REVOKED' }
  if (auth.activated_at === null) return { active: false, reason: 'NOT_ACTIVATED' }

  if (
    auth.plan_id !== current.planId ||
    auth.plan_revision !== current.planRevision ||
    auth.review_revision !== current.reviewRevision
  ) {
    return { active: false, reason: 'PLAN_CHANGED' }
  }

  const expiresAt = Date.parse(auth.expires_at)
  if (Number.isNaN(expiresAt)) return { active: false, reason: 'EXPIRED' }
  if (current.now.getTime() >= expiresAt) return { active: false, reason: 'EXPIRED' }

  return { active: true }
}

/**
 * The authorized dates that are still eligible, in the order they were
 * authorized, with duplicates removed.
 *
 * Recalled dates are subtracted: a post that was taken down must not be
 * re-published by the scheduler just because its date is still on the grant.
 */
export function remainingAuthorizedDates(authorizedDates: string[], recalledDates: string[]): string[] {
  const recalled = new Set(recalledDates)
  const seen = new Set<string>()
  const remaining: string[] = []
  for (const date of authorizedDates) {
    if (recalled.has(date)) continue
    if (seen.has(date)) continue
    seen.add(date)
    remaining.push(date)
  }
  return remaining
}

/**
 * The instant a grant expires, `days` days (24h each) after it was authorized.
 *
 * `days` is clamped to 1..AUTO_PUBLISH_MAX_EXPIRY_DAYS so a caller cannot
 * produce a grant that outlives the ceiling, and cannot produce one that is
 * already expired at the moment it is written.
 */
export function computeExpiry(authorizedAt: Date, days: number): Date {
  const clamped = Math.min(Math.max(Math.trunc(days), 1), AUTO_PUBLISH_MAX_EXPIRY_DAYS)
  return new Date(authorizedAt.getTime() + clamped * 24 * 3_600_000)
}
