/**
 * The daily check: overdue pending letters become "unknown outcome"; our own breaker trips on the §4.3 thresholds only;
 * half a read trips nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import { EXPIRE_PENDING_MS, OVERDUE_MARGIN_MS, judgeHealth, overduePending, type BreakerLimits, type ReconcileRow } from '../reconcile'
import { runReconcile, type ReconcileDeps } from '@/lib/inngest/functions/triggered-send-reconcile'

const NOW = new Date('2026-11-27T18:30:00.000Z')
const H = 3_600_000
const D = 24 * H
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
let n = 0
function row(p: Partial<ReconcileRow>): ReconcileRow {
  n += 1
  return {
    id: `r${n}`, clientId: 'c1', triggerKey: 'welcome', dedupeScope: 'lifetime', status: 'delivered', reasonCode: null, bounceKind: null,
    firstAttemptAt: ago(2 * H), leaseExpiresAt: null, updatedAt: ago(H), ...p,
  }
}
const many = (count: number, p: Partial<ReconcileRow>) => Array.from({ length: count }, () => row(p))
const hard = { status: 'bounced', bounceKind: 'permanent' }
/** The v1 defaults a proposal carries (design §4.3). */
const V1: BreakerLimits = { window_days: 30, bounce_min_sent: 50, bounce_min_count: 3, bounce_rate_pct: 4, complaint_max: 2, provider_reject_streak: 3 }
const LONG_AGO = ago(365 * D)
const judge = (rows: ReconcileRow[], limits: BreakerLimits = V1, startedAt: string = LONG_AGO) => judgeHealth(rows, limits, startedAt, NOW)

describe('overduePending', () => {
  it('takes real pending letters handed over more than 20 hours ago whose lease has run out', () => {
    const due = row({ status: 'pending', firstAttemptAt: ago(EXPIRE_PENDING_MS + OVERDUE_MARGIN_MS + H) })
    const fresh = row({ status: 'pending', firstAttemptAt: ago(EXPIRE_PENDING_MS - H) })
    // 20 h 10 min: past the claim function's line, but a takeover may still be recording its message id (子牙 P2-5).
    const margin = row({ status: 'pending', firstAttemptAt: ago(EXPIRE_PENDING_MS + 10 * 60 * 1000) })
    const leased = row({ status: 'pending', firstAttemptAt: ago(EXPIRE_PENDING_MS + OVERDUE_MARGIN_MS + H), leaseExpiresAt: new Date(NOW.getTime() + H).toISOString() })
    const neverTried = row({ status: 'pending', firstAttemptAt: null })
    const rehearsal = row({ status: 'pending', dedupeScope: 'shadow', firstAttemptAt: ago(EXPIRE_PENDING_MS + OVERDUE_MARGIN_MS + H) })
    const sent = row({ status: 'sent', firstAttemptAt: ago(EXPIRE_PENDING_MS + OVERDUE_MARGIN_MS + H) })
    expect(overduePending([due, fresh, margin, leased, neverTried, rehearsal, sent], NOW).map((r) => r.id)).toEqual([due.id])
  })
})

describe('judgeHealth (our own breaker, §4.3)', () => {
  it('does not trip on a small sample, even with a bad rate', () => {
    expect(judge([...many(20, {}), ...many(3, hard)]).trip).toBe(false)
  })

  it('trips at 50 letters with 3 hard bounces (6 %)', () => {
    expect(judge([...many(47, {}), ...many(3, hard)])).toMatchObject({ trip: true, code: 'HEALTH_BREAKER', sent: 50, hardBounces: 3 })
  })

  it('does not trip at 3 hard bounces out of 80 (3.75 %), nor on soft bounces', () => {
    expect(judge([...many(77, {}), ...many(3, hard)]).trip).toBe(false)
    expect(judge([...many(40, {}), ...many(10, { status: 'bounced', bounceKind: 'transient' })]).trip).toBe(false)
  })

  it('trips on the second complaint in 30 days, not the first', () => {
    expect(judge([row({}), row({ status: 'complained' })]).trip).toBe(false)
    expect(judge([row({}), ...many(2, { status: 'complained' })])).toMatchObject({ trip: true, code: 'HEALTH_BREAKER', complaints: 2 })
  })

  it('trips when the provider refused the last three in a row, not when one went in between', () => {
    const refused = (h: number) => row({ status: 'failed', reasonCode: 'provider_rejected', firstAttemptAt: ago(h * H) })
    expect(judge([row({ firstAttemptAt: ago(10 * H) }), refused(3), refused(2), refused(1)])).toMatchObject({ trip: true, code: 'PROVIDER_FAILURE' })
    expect(judge([refused(3), row({ firstAttemptAt: ago(2 * H) }), refused(1)]).trip).toBe(false)
  })

  it('uses the stop lines the PM approved, not fixed numbers (子牙 P1-1, 魏征 P1-1)', () => {
    expect(judge([row({}), row({ status: 'complained' })], { ...V1, complaint_max: 1 })).toMatchObject({ trip: true, code: 'HEALTH_BREAKER' })
    expect(judge([...many(3, { status: 'complained' })], { ...V1, complaint_max: 4 }).trip).toBe(false)
  })

  it('counts only letters since the authorization was switched on: a re-authorization starts afresh (P1-2)', () => {
    const before = many(2, { status: 'complained', firstAttemptAt: ago(5 * D) })
    expect(judge([...before, ...many(30, { firstAttemptAt: ago(D) })], V1, ago(2 * D)).trip).toBe(false)
    expect(judge([...before], V1, ago(10 * D)).trip).toBe(true)
  })

  it('a key the provider refused counts toward the refusal streak (子牙 P1-3)', () => {
    const keyError = (h: number) => row({ status: 'failed', reasonCode: 'provider_account_error', firstAttemptAt: ago(h * H) })
    expect(judge([keyError(3), keyError(2), keyError(1)])).toMatchObject({ trip: true, code: 'PROVIDER_FAILURE' })
  })

  it('ignores the rehearsal and letters older than 30 days', () => {
    expect(judge([...many(2, { status: 'complained', dedupeScope: 'shadow' })]).trip).toBe(false)
    expect(judge([...many(2, { status: 'complained', firstAttemptAt: ago(31 * D) })]).trip).toBe(false)
  })
})

function deps(p: Partial<ReconcileDeps>): ReconcileDeps & { finished: unknown[] } {
  const finished: unknown[] = []
  return {
    finished,
    startRun: async () => undefined,
    finishRun: async (_id, _ms, opts) => { finished.push(opts) },
    loadRows: async () => ({ ok: true, rows: [] }),
    expire: async () => ({ expired: [], moved: [], errors: [] }),
    breaker: async () => [],
    now: () => NOW,
    ...p,
  }
}
const step = { run: <T>(_id: string, fn: () => Promise<T>) => fn() }

describe('runReconcile', () => {
  it('a failed read moves nothing and revokes nothing, and says so in the run log', async () => {
    const expire = vi.fn()
    const breaker = vi.fn()
    const d = deps({ loadRows: async () => ({ ok: false, error: 'ledger read: boom' }), expire, breaker })
    const out = await runReconcile(step, d, 'run-1')
    expect(out).toMatchObject({ status: 'read_failed', errors: ['ledger read: boom'], no_send: true })
    expect(expire).not.toHaveBeenCalled()
    expect(breaker).not.toHaveBeenCalled()
    expect(d.finished[0]).toMatchObject({ failed: 1 })
  })

  it('reports expired letters and a tripped breaker', async () => {
    const d = deps({
      expire: async () => ({ expired: ['a', 'b'], moved: ['c'], errors: [] }),
      breaker: async () => [{ clientId: 'c1', triggerKey: 'welcome', authorizationId: 'auth1', verdict: { trip: true, code: 'HEALTH_BREAKER', reason: 'x', sent: 1, hardBounces: 0, complaints: 2 }, revoked: true, errors: [] }],
    })
    const out = await runReconcile(step, d, 'run-2')
    expect(out).toMatchObject({ status: 'done', expired: 2, moved: 1, tripped: [{ clientId: 'c1', trigger: 'welcome', code: 'HEALTH_BREAKER', revoked: true }] })
    expect(d.finished[0]).toMatchObject({ completed: 2, failed: 0 })
  })
})

describe('schedule', () => {
  it('the cron registry watches the same schedule the function runs on', async () => {
    const { CRON_REGISTRY } = await import('@/lib/cron/registry')
    const { TRIGGERED_SEND_RECONCILE_CRON, TRIGGERED_SEND_RECONCILE_JOB } = await import('@/lib/inngest/functions/triggered-send-reconcile')
    const entry = CRON_REGISTRY.find((e) => e.jobName === TRIGGERED_SEND_RECONCILE_JOB)
    expect(entry?.schedule).toBe(TRIGGERED_SEND_RECONCILE_CRON)
  })
})
