import { isoDate, nzCalendar } from '@/lib/social/week-pack/cadence'

export const SCHEDULED_GRANT_KEY = 'scheduled_go_public'
/** How long an executor may hold a claimed grant before it is treated as interrupted. */
export const SCHEDULED_CLAIM_LEASE_MS = 10 * 60 * 1000

export type ScheduledGrantStatus =
  | 'armed' | 'claimed' | 'consumed' | 'consumed_manual' | 'failed' | 'stale' | 'missed' | 'revoked' | 'unknown'

export interface ScheduledGrant {
  status: ScheduledGrantStatus
  work_order_id: string
  publish_on: string          // YYYY-MM-DD, NZ calendar date approved for publishing
  fingerprint: string         // content fingerprint the approver previewed (no catalog version)
  card_run_id: string
  authorized_by: string       // approver email (global admin)
  authorized_at: string       // ISO
  catalog_version_at_approval: number | null
  attempt_id?: string
  claimed_at?: string
  executed_by?: string
  reason?: string
  updated_at?: string
}

const STATUSES: readonly ScheduledGrantStatus[] = [
  'armed', 'claimed', 'consumed', 'consumed_manual', 'failed', 'stale', 'missed', 'revoked', 'unknown',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isStatus(v: unknown): v is ScheduledGrantStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

/** Reads the grant stored under SCHEDULED_GRANT_KEY in a traffic-row payload; null when absent or malformed. */
export function readGrant(payload: Record<string, unknown>): ScheduledGrant | null {
  const raw = payload[SCHEDULED_GRANT_KEY]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!isStatus(r.status)) return null
  if (!isNonEmptyString(r.work_order_id)) return null
  if (!isNonEmptyString(r.publish_on) || !DATE_RE.test(r.publish_on)) return null
  if (!isNonEmptyString(r.fingerprint)) return null
  if (!isNonEmptyString(r.card_run_id)) return null
  if (!isNonEmptyString(r.authorized_by)) return null
  if (!isNonEmptyString(r.authorized_at)) return null
  const cv = r.catalog_version_at_approval
  if (cv !== undefined && cv !== null && typeof cv !== 'number') return null
  const grant: ScheduledGrant = {
    status: r.status,
    work_order_id: r.work_order_id,
    publish_on: r.publish_on,
    fingerprint: r.fingerprint,
    card_run_id: r.card_run_id,
    authorized_by: r.authorized_by,
    authorized_at: r.authorized_at,
    catalog_version_at_approval: typeof cv === 'number' ? cv : null,
  }
  if (typeof r.attempt_id === 'string') grant.attempt_id = r.attempt_id
  if (typeof r.claimed_at === 'string') grant.claimed_at = r.claimed_at
  if (typeof r.executed_by === 'string') grant.executed_by = r.executed_by
  if (typeof r.reason === 'string') grant.reason = r.reason
  if (typeof r.updated_at === 'string') grant.updated_at = r.updated_at
  return grant
}

/** Returns a copy of payload with the grant set (other keys untouched). */
export function withGrant(payload: Record<string, unknown>, grant: ScheduledGrant): Record<string, unknown> {
  return { ...payload, [SCHEDULED_GRANT_KEY]: grant }
}

/** NZ calendar date (YYYY-MM-DD) for an instant. */
export function nzToday(now: Date): string {
  return isoDate(nzCalendar(now))
}

export type GrantCheck =
  | { ok: true }
  | { ok: false; next: ScheduledGrantStatus | null; reason: string }

/**
 * Checks a grant on the LATEST payload right before claiming. All must hold:
 * status 'armed'; grant.publish_on === currentPublishOn === today; grant.fingerprint === currentFingerprint;
 * isApprover(grant.authorized_by) is still true.
 */
export function checkGrant(args: {
  grant: ScheduledGrant | null
  today: string
  currentPublishOn: string | null
  currentFingerprint: string
  isApprover: (email: string) => boolean
}): GrantCheck {
  const { grant, today, currentPublishOn, currentFingerprint, isApprover } = args
  if (!grant) return { ok: false, next: null, reason: 'no_grant' }
  if (grant.status !== 'armed') return { ok: false, next: null, reason: `grant_${grant.status}` }
  if (grant.publish_on < today) return { ok: false, next: 'missed', reason: 'missed_day' }
  if (grant.publish_on > today) return { ok: false, next: null, reason: 'not_today' }
  if (currentPublishOn !== grant.publish_on) return { ok: false, next: 'stale', reason: 'publish_day_changed' }
  if (currentFingerprint !== grant.fingerprint) return { ok: false, next: 'stale', reason: 'content_changed' }
  if (!isApprover(grant.authorized_by)) return { ok: false, next: 'stale', reason: 'approver_not_admin' }
  return { ok: true }
}

/** Grant moved to 'claimed' for one executor attempt. */
export function claimedGrant(grant: ScheduledGrant, attemptId: string, executedBy: string, now: Date): ScheduledGrant {
  return {
    ...grant,
    status: 'claimed',
    attempt_id: attemptId,
    claimed_at: now.toISOString(),
    executed_by: executedBy,
    updated_at: now.toISOString(),
  }
}

/** A claimed grant whose lease ran out (the executor died part-way). */
export function isLeaseExpired(grant: ScheduledGrant, now: Date): boolean {
  if (grant.status !== 'claimed') return false
  if (!grant.claimed_at) return false
  const claimedMs = Date.parse(grant.claimed_at)
  if (Number.isNaN(claimedMs)) return false
  return claimedMs + SCHEDULED_CLAIM_LEASE_MS <= now.getTime()
}

const REVOCABLE: readonly ScheduledGrantStatus[] = ['armed', 'stale', 'missed', 'failed', 'unknown']

/** Any non-terminal grant can be revoked by a person; terminal ones (consumed / consumed_manual / revoked) cannot. Returns the new grant or null when there is nothing to revoke. */
export function revokedGrant(grant: ScheduledGrant | null, by: string, now: Date): ScheduledGrant | null {
  if (!grant) return null
  if (!REVOCABLE.includes(grant.status)) return null
  return grantWithStatus(grant, 'revoked', `revoked_by:${by}`, now)
}

/** Grant with a new status and reason (updated_at = now). */
export function grantWithStatus(grant: ScheduledGrant, status: ScheduledGrantStatus, reason: string, now: Date): ScheduledGrant {
  return { ...grant, status, reason, updated_at: now.toISOString() }
}
