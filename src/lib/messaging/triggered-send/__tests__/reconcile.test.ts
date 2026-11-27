/**
 * The daily check: overdue pending letters become "unknown outcome"; our own breaker trips on the §4.3 thresholds only;
 * half a read trips nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import { EXPIRE_PENDING_MS, judgeHealth, overduePending, type ReconcileRow } from '../reconcile'
import { runReconcile, type ReconcileDeps } from '@/lib/inngest/functions/triggered-send-reconcile'

const NOW = new Date('2026-11-27T18:30:00.000Z')
const H = 3_600_000
const D = 24 * H
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
let n = 0
function row(p: Partial<ReconcileRow>): ReconcileRow {
  n += 1
  return {
    id: `r${n}`, clientId: 'c1', dedupeScope: 'lifetime', status: 'delivered', reasonCode: null, bounceKind: null,
    firstAttemptAt: ago(2 * H), leaseExpiresAt: null, updatedAt: ago(H), ...p,
  }
}
const many = (count: number, p: Partial<ReconcileRow>) => Array.from({ length: count }, () => row(p))
const hard = { status: 'bounced', bounceKind: 'permanent' }

describe('overduePending', () => {
  it('takes real pending letters handed over more than 20 hours ago whose lease has run out', () => {
    const due = row({ status: 'pending', firstAttemptAt: ago(EXPIRE_PENDING_MS + H) })
    const fresh = row({ status: 'pending', firstAttemptAt: ago(EXPIRE_PENDING_MS - H) })
    const leased = row({ status: 'pending', firstAttemptAt: ago(EXPIRE_PENDING_MS + H), leaseExpiresAt: new Date(NOW.getTime() + H).toISOString() })
    const neverTried = row({ status: 'pending', firstAttemptAt: null })
    const rehearsal = row({ status: 'pending', dedupeScope: 'shadow', firstAttemptAt: ago(EXPIRE_PENDING_MS + H) })
    const sent = row({ status: 'sent', firstAttemptAt: ago(EXPIRE_PENDING_MS + H) })
    expect(overduePending([due, fresh, leased, neverTried, rehearsal, sent], NOW).map((r) => r.id)).toEqual([due.id])
  })
})

describe('judgeHealth (our own breaker, §4.3)', () => {
  it('does not trip on a small sample, even with a bad rate', () => {
    expect(judgeHealth([...many(20, {}), ...many(3, hard)], NOW).trip).toBe(false)
  })

  it('trips at 50 letters with 3 hard bounces (6 %)', () => {
    expect(judgeHealth([...many(47, {}), ...many(3, hard)], NOW)).toMatchObject({ trip: true, code: 'HEALTH_BREAKER', sent: 50, hardBounces: 3 })
  })

  it('does not trip at 3 hard bounces out of 80 (3.75 %), nor on soft bounces', () => {
    expect(judgeHealth([...many(77, {}), ...many(3, hard)], NOW).trip).toBe(false)
    expect(judgeHealth([...many(40, {}), ...many(10, { status: 'bounced', bounceKind: 'transient' })], NOW).trip).toBe(false)
  })

  it('trips on the second complaint in 30 days, not the first', () => {
    expect(judgeHealth([row({}), row({ status: 'complained' })], NOW).trip).toBe(false)
    expect(judgeHealth([row({}), ...many(2, { status: 'complained' })], NOW)).toMatchObject({ trip: true, code: 'HEALTH_BREAKER', complaints: 2 })
  })

  it('trips when the provider refused the last three in a row, not when one went in between', () => {
    const refused = (h: number) => row({ status: 'failed', reasonCode: 'provider_rejected', firstAttemptAt: ago(h * H) })
    expect(judgeHealth([row({ firstAttemptAt: ago(10 * H) }), refused(3), refused(2), refused(1)], NOW)).toMatchObject({ trip: true, code: 'PROVIDER_FAILURE' })
    expect(judgeHealth([refused(3), row({ firstAttemptAt: ago(2 * H) }), refused(1)], NOW).trip).toBe(false)
  })

  it('ignores the rehearsal and letters older than 30 days', () => {
    expect(judgeHealth([...many(2, { status: 'complained', dedupeScope: 'shadow' })], NOW).trip).toBe(false)
    expect(judgeHealth([...many(2, { status: 'complained', firstAttemptAt: ago(31 * D) })], NOW).trip).toBe(false)
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
      breaker: async () => [{ clientId: 'c1', verdict: { trip: true, code: 'HEALTH_BREAKER', reason: 'x', sent: 1, hardBounces: 0, complaints: 2 }, revoked: ['auth1'], errors: [] }],
    })
    const out = await runReconcile(step, d, 'run-2')
    expect(out).toMatchObject({ status: 'done', expired: 2, moved: 1, tripped: [{ clientId: 'c1', code: 'HEALTH_BREAKER', revoked: 1 }] })
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
