/**
 * The daily check over letters ME sent itself (design §6.5 "每日对账", §4.3 "自家闸线", §17 P2-2c-3). Pure: no database,
 * no clock; the reader / writer is `reconcile-prod.ts`, the schedule is the Inngest function `triggered-send-reconcile`.
 *
 *  1. **Overdue pending letters**: a letter claimed and handed to the provider more than 20 hours ago whose outcome was
 *     never written stays `pending` for ever when nobody claims that guest again (the authorization was revoked or ran
 *     out, a switch went off, the template changed, the guest changed name or address — the claim function, which does
 *     the same move, never sees those rows; review 魏征 P2-1, 子牙 point 4). The daily check moves them to
 *     `unknown_outcome` exactly like the claim function does (`expired_20h`), whatever the authorization and switches
 *     say, so a person is asked to check them. A letter whose lease is still running is left alone.
 *  2. **Our own breaker**: when the letters of the last 30 days bounce or draw complaints beyond the thresholds below, or
 *     the provider refused the last three in a row, the client's sending authorization is revoked by the system
 *     (`system:HEALTH_BREAKER` / `system:PROVIDER_FAILURE`), so the next letter does not go. The thresholds are the ones
 *     the PM approved: the authorization's own `send.health_breaker` (§4.3; v1 defaults 30 days / 50 letters / 3 hard
 *     bounces over 4 % / 2 complaints / 3 refusals). Only letters of that authorization's trigger handed over since it
 *     was switched on count: a re-authorization after a stop starts a fresh count (review 魏征 P1-2).
 *
 * Only real letters count (`dedupe_scope` other than the rehearsal's `shadow`).
 */

import { leftProvider } from './receipt'
import { isLiveScope } from './trigger-scope'

/** Same as the claim function: a pending letter older than this is an unknown outcome. */
export const EXPIRE_PENDING_MS = 20 * 60 * 60 * 1000
/** The longest breaker window a rule may set (send-rule.ts: window_days 7..90): how far back the reader goes. */
export const MAX_BREAKER_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

/** The authorization's own stop lines (`send.health_breaker`, send-rule.ts). */
export interface BreakerLimits {
  window_days: number
  bounce_min_sent: number
  bounce_min_count: number
  bounce_rate_pct: number
  complaint_max: number
  provider_reject_streak: number
}

/**
 * When the stop lines cannot be read from the authorization: the strictest values a rule may hold. Not a guess at
 * "probably fine" — an unreadable rule is also revoked by the sender itself (`RULE_INVALID`).
 */
export const STRICTEST_LIMITS: BreakerLimits = {
  window_days: 90, bounce_min_sent: 10, bounce_min_count: 1, bounce_rate_pct: 1, complaint_max: 1, provider_reject_streak: 1,
}
export const PROVIDER_REJECTED = 'provider_rejected'
/** A key the provider refused (revoked, deleted, domain not verified): also a refusal for the streak (§17.4, 子牙 P1-3). */
export const PROVIDER_ACCOUNT_ERROR = 'provider_account_error'
const REFUSALS: ReadonlySet<string> = new Set([PROVIDER_REJECTED, PROVIDER_ACCOUNT_ERROR])
/**
 * A letter is only called overdue this long after its first attempt: 20 hours (as the claim function) plus the longest
 * claim lease and a send call, so a takeover that started at 19.9 hours can still record its message id (子牙 P2-5).
 */
export const OVERDUE_MARGIN_MS = 30 * 60 * 1000
export const EXPIRED_REASON = 'expired_20h'

/** The ledger columns the daily check reads. No address, no name. */
export interface ReconcileRow {
  id: string
  clientId: string
  triggerKey: string
  dedupeScope: string
  status: string
  reasonCode: string | null
  bounceKind: string | null
  firstAttemptAt: string | null
  leaseExpiresAt: string | null
  updatedAt: string
}

function ms(iso: string | null): number {
  if (iso === null) return Number.NaN
  return Date.parse(iso)
}

/** Letters to move to `unknown_outcome`: real, still pending, handed over more than 20½ hours ago, lease not running. */
export function overduePending(rows: readonly ReconcileRow[], now: Date): ReconcileRow[] {
  const nowMs = now.getTime()
  return rows.filter((r) => {
    if (!isLiveScope(r.dedupeScope) || r.status !== 'pending') return false
    const first = ms(r.firstAttemptAt)
    if (Number.isNaN(first) || nowMs - first <= EXPIRE_PENDING_MS + OVERDUE_MARGIN_MS) return false
    const lease = ms(r.leaseExpiresAt)
    return Number.isNaN(lease) || lease <= nowMs
  })
}

export type BreakerVerdict =
  | { trip: false; sent: number; hardBounces: number; complaints: number }
  | { trip: true; code: 'HEALTH_BREAKER' | 'PROVIDER_FAILURE'; reason: string; sent: number; hardBounces: number; complaints: number }

function lastAttempts(rows: readonly ReconcileRow[], n: number): ReconcileRow[] {
  return rows
    .filter((r) => !Number.isNaN(ms(r.firstAttemptAt)) && r.status !== 'pending')
    .sort((a, b) => ms(b.firstAttemptAt) - ms(a.firstAttemptAt))
    .slice(0, n)
}

/**
 * One authorization's letters → stop or not (§4.3). `startedAt` = when the authorization was switched on: letters
 * handed over before it never count. Rows of the rehearsal, of other clients or triggers are the caller's to drop;
 * this only drops the rehearsal and letters outside the window.
 */
export function judgeHealth(rows: readonly ReconcileRow[], limits: BreakerLimits, startedAt: string, now: Date): BreakerVerdict {
  const since = Math.max(now.getTime() - limits.window_days * 24 * 60 * 60 * 1000, ms(startedAt) || 0)
  const recent = rows.filter((r) => isLiveScope(r.dedupeScope) && ms(r.firstAttemptAt) >= since)
  const sent = recent.filter((r) => leftProvider(r.status)).length
  const hardBounces = recent.filter((r) => r.status === 'bounced' && r.bounceKind === 'permanent').length
  const complaints = recent.filter((r) => r.status === 'complained').length
  const counts = { sent, hardBounces, complaints }
  if (complaints >= limits.complaint_max) {
    return { trip: true, code: 'HEALTH_BREAKER', reason: `${complaints} 次投诉（安全线 ${limits.complaint_max} 次）`, ...counts }
  }
  if (sent >= limits.bounce_min_sent && hardBounces >= limits.bounce_min_count && hardBounces * 100 > sent * limits.bounce_rate_pct) {
    return { trip: true, code: 'HEALTH_BREAKER', reason: `发出 ${sent} 封，${hardBounces} 封地址无效退回（安全线 ${limits.bounce_rate_pct}%）`, ...counts }
  }
  const streak = limits.provider_reject_streak
  const last = lastAttempts(recent, streak)
  if (last.length === streak && last.every((r) => r.status === 'failed' && r.reasonCode !== null && REFUSALS.has(r.reasonCode))) {
    return { trip: true, code: 'PROVIDER_FAILURE', reason: `发信服务连续拒收 ${streak} 封`, ...counts }
  }
  return { trip: false, ...counts }
}
