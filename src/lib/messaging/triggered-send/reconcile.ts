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
 *     (`system:HEALTH_BREAKER` / `system:PROVIDER_FAILURE`), so the next letter does not go. Thresholds are the v1 ones of
 *     §4.3 (no false stops on small samples: 50 letters, 3 hard bounces and more than 4 %; two complaints).
 *
 * Only real letters count (`dedupe_scope` other than the rehearsal's `shadow`).
 */

import { leftProvider } from './receipt'
import { isLiveScope } from './trigger-scope'

/** Same as the claim function: a pending letter older than this is an unknown outcome. */
export const EXPIRE_PENDING_MS = 20 * 60 * 60 * 1000
export const BREAKER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const BREAKER_MIN_SENT = 50
export const BREAKER_MIN_HARD_BOUNCES = 3
export const BREAKER_HARD_BOUNCE_RATE = 0.04
export const BREAKER_MAX_COMPLAINTS = 2
export const BREAKER_CONSECUTIVE_REJECTED = 3
export const PROVIDER_REJECTED = 'provider_rejected'
export const EXPIRED_REASON = 'expired_20h'

/** The ledger columns the daily check reads. No address, no name. */
export interface ReconcileRow {
  id: string
  clientId: string
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

/** Letters to move to `unknown_outcome`: real, still pending, handed over more than 20 hours ago, lease not running. */
export function overduePending(rows: readonly ReconcileRow[], now: Date): ReconcileRow[] {
  const nowMs = now.getTime()
  return rows.filter((r) => {
    if (!isLiveScope(r.dedupeScope) || r.status !== 'pending') return false
    const first = ms(r.firstAttemptAt)
    if (Number.isNaN(first) || nowMs - first <= EXPIRE_PENDING_MS) return false
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

/** One client's letters → stop or not (§4.3). Rows outside the 30-day window or from the rehearsal are ignored. */
export function judgeHealth(rows: readonly ReconcileRow[], now: Date): BreakerVerdict {
  const since = now.getTime() - BREAKER_WINDOW_MS
  const recent = rows.filter((r) => isLiveScope(r.dedupeScope) && ms(r.firstAttemptAt) >= since)
  const sent = recent.filter((r) => leftProvider(r.status)).length
  const hardBounces = recent.filter((r) => r.status === 'bounced' && r.bounceKind === 'permanent').length
  const complaints = recent.filter((r) => r.status === 'complained').length
  const counts = { sent, hardBounces, complaints }
  if (complaints >= BREAKER_MAX_COMPLAINTS) {
    return { trip: true, code: 'HEALTH_BREAKER', reason: `30 天内 ${complaints} 次投诉`, ...counts }
  }
  if (sent >= BREAKER_MIN_SENT && hardBounces >= BREAKER_MIN_HARD_BOUNCES && hardBounces / sent > BREAKER_HARD_BOUNCE_RATE) {
    return { trip: true, code: 'HEALTH_BREAKER', reason: `30 天内发出 ${sent} 封，${hardBounces} 封地址无效退回`, ...counts }
  }
  const last = lastAttempts(recent, BREAKER_CONSECUTIVE_REJECTED)
  if (last.length === BREAKER_CONSECUTIVE_REJECTED && last.every((r) => r.status === 'failed' && r.reasonCode === PROVIDER_REJECTED)) {
    return { trip: true, code: 'PROVIDER_FAILURE', reason: `发信服务连续拒收 ${BREAKER_CONSECUTIVE_REJECTED} 封`, ...counts }
  }
  return { trip: false, ...counts }
}
