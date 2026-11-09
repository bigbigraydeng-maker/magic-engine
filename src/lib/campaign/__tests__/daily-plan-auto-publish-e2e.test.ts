/**
 * End-to-end trial of the auto-publish sweep over a working in-memory database.
 *
 * Real: the sweep, the decision rules, and every store function (claim, finish,
 * list, tombstone, confirm). Faked: the two tables (with a real UNIQUE(plan_id,date)
 * and real conditional updates), plan/scope reads, and the publish runner (which has
 * its own tests). The point is the sequence over several sweeps — claims, retries,
 * unknown outcomes, recalls, concurrent sweeps — which per-function tests cannot show.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db: { attempts: Row[]; auth: Row[] } = { attempts: [], auth: [] }
let idCounter = 0

function matchesOr(row: Row, expr: string): boolean {
  // only the one expression the store uses: reason_code.is.null,reason_code.neq.RECALLED
  if (expr !== 'reason_code.is.null,reason_code.neq.RECALLED') throw new Error(`fake db: unsupported or(): ${expr}`)
  return row.reason_code === null || row.reason_code === undefined || row.reason_code !== 'RECALLED'
}

function makeBuilder(table: string) {
  const rows = (): Row[] => {
    if (table === 'daily_plan_auto_publish_attempts') return db.attempts
    if (table === 'daily_plan_auto_publish_auth') return db.auth
    throw new Error(`fake db: table not modelled: ${table}`)
  }
  let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  let payload: Row | Row[] = {}
  let onConflict = ''
  let returning = false
  const filters: Array<(row: Row) => boolean> = []

  const run = (): { data: unknown; error: { code?: string; message: string } | null } => {
    if (op === 'insert' || op === 'upsert') {
      const list = Array.isArray(payload) ? payload : [payload]
      for (const item of list) {
        const existing = rows().find(r => r.plan_id === item.plan_id && r.date === item.date)
        if (existing && op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key' } }
        if (existing) Object.assign(existing, item)
        else rows().push({ id: `row-${++idCounter}`, reason_code: null, next_retry_at: null, post_id: null, scheduled_publish_time: null, ...item })
      }
      return { data: null, error: null }
    }
    const matched = rows().filter(r => filters.every(f => f(r)))
    if (op === 'update') {
      for (const r of matched) Object.assign(r, payload)
      return { data: returning ? matched.map(r => ({ ...r })) : null, error: null }
    }
    return { data: matched.map(r => ({ ...r })), error: null }
  }

  const builder = {
    select: () => {
      if (op !== 'select') returning = true
      return builder
    },
    insert: (row: Row) => { op = 'insert'; payload = row; return builder },
    upsert: (row: Row | Row[], opts: { onConflict: string }) => { op = 'upsert'; payload = row; onConflict = opts.onConflict; return builder },
    update: (patch: Row) => { op = 'update'; payload = patch; return builder },
    eq: (col: string, value: unknown) => { filters.push(r => r[col] === value); return builder },
    in: (col: string, values: unknown[]) => { filters.push(r => values.includes(r[col])); return builder },
    is: (col: string, value: null) => { filters.push(r => (r[col] ?? null) === value); return builder },
    not: (col: string, _is: string, value: null) => { filters.push(r => (r[col] ?? null) !== value); return builder },
    gte: (col: string, value: string) => { filters.push(r => String(r[col]) >= value); return builder },
    or: (expr: string) => { filters.push(r => matchesOr(r, expr)); return builder },
    maybeSingle: async () => {
      const result = run()
      const list = result.data as Row[] | null
      return { data: list && list.length > 0 ? list[0] : null, error: result.error }
    },
    then: (resolve: (value: unknown) => unknown) => resolve(run()),
  }
  void onConflict
  return builder
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => makeBuilder(table) } }))

import { runAutoPublishSweep, type AutoPublishWorkerDeps, type RunPublishInput } from '../daily-plan-auto-publish-worker'
import {
  claimAttempt,
  confirmUnknownOutcome,
  finishAttempt,
  listAttempts,
  listLiveAuthorizations,
} from '../daily-plan-auto-publish-worker-store'
import { getActiveAuthorization, tombstoneRecalledDates } from '../daily-plan-auto-publish-store'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const PLAN = 'b0000000-0000-0000-0000-000000000001'
const T0 = new Date('2026-10-11T18:00:00Z') // 07:00 NZ on 2026-10-12
const TOMORROW = '2026-10-13'
const min = (n: number) => new Date(T0.getTime() + n * 60_000)

function seedGrant(overrides: Row = {}) {
  db.auth.push({
    id: 'auth-1', request_id: 'req-auth-1', client_id: CLIENT, campaign_id: 'a0000000-0000-0000-0000-000000000001',
    plan_id: PLAN, plan_revision: '2026-10-01T00:00:00.000Z', review_revision: '10000000-0000-0000-0000-000000000001',
    page_id: '227633594573276', dates: [TOMORROW], lifted_dates: [], max_per_day: 1,
    authorized_by_email: 'pm@example.test', authorized_by_user_id: 'f0000000-0000-0000-0000-000000000001',
    authorized_at: '2026-10-10T00:00:00.000Z', activated_at: '2026-10-10T00:00:05.000Z', expires_at: '2026-10-24T00:00:00.000Z',
    revoked_at: null, revoked_by_email: null, revoked_reason: null, ...overrides,
  })
}

type Script = (input: RunPublishInput) => Promise<{ status: number; body: Record<string, unknown> }>
const ok: Script = async input =>
  input.command.no_publish
    ? { status: 200, body: { success: true } }
    : { status: 200, body: { receipt: { published: [{ date: input.command.dates?.[0], post_id: 'post-1', scheduled_publish_time: '2026-10-13T19:00:00.000Z' }], failed: [] } } }

function makeDeps(now: Date, runPublish: Script, extra: { receiptRecalled?: string[] } = {}) {
  const sent = vi.fn(runPublish)
  const deps: AutoPublishWorkerDeps = {
    now,
    clock: () => now,
    switches: { live: true, clientIds: [CLIENT] },
    listLiveAuthorizations,
    isGlobalAdmin: () => true,
    getActiveAuthorization,
    loadPlanState: async () => ({
      planRevision: '2026-10-01T00:00:00.000Z', reviewRevision: '10000000-0000-0000-0000-000000000001',
      publishedDates: [], receiptRecalledDates: extra.receiptRecalled ?? [],
    }),
    loadScope: async () => ({ clientStatus: 'active', campaignStatus: 'active' }),
    listAttempts,
    claimAttempt,
    finishAttempt,
    runPublish: sent,
    emit: async () => undefined,
  }
  return { deps, sent, liveCalls: () => sent.mock.calls.filter(c => c[0].command.no_publish === false).length }
}

beforeEach(() => {
  db.attempts = []
  db.auth = []
  idCounter = 0
  seedGrant()
})

describe('auto-publish over a working database', () => {
  it('🔴 publishes once; the next sweeps find the claim and never send again', async () => {
    const first = makeDeps(T0, ok)
    await runAutoPublishSweep(first.deps)
    expect(first.liveCalls()).toBe(1)
    expect(db.attempts).toHaveLength(1)
    expect(db.attempts[0]).toMatchObject({ date: TOMORROW, status: 'published', post_id: 'post-1', provider_impact: 'FB_SCHEDULED' })

    // the plan receipt is deliberately NOT updated in this fake: the attempts table alone must prevent a re-send
    for (const t of [min(60), min(120)]) {
      const again = makeDeps(t, ok)
      await runAutoPublishSweep(again.deps)
      expect(again.liveCalls()).toBe(0)
    }
    expect(db.attempts).toHaveLength(1)
  })

  it('🔴 two sweeps racing on the same date: exactly one sends (the unique claim)', async () => {
    const a = makeDeps(T0, ok)
    const b = makeDeps(T0, ok)
    await Promise.all([runAutoPublishSweep(a.deps), runAutoPublishSweep(b.deps)])
    expect(a.liveCalls() + b.liveCalls()).toBe(1)
    expect(db.attempts).toHaveLength(1)
    expect(db.attempts[0].status).toBe('published')
  })

  it('a definite Facebook refusal is retried after the backoff, with the next attempt number, then published', async () => {
    const refuse: Script = async input =>
      input.command.no_publish
        ? { status: 200, body: { success: true } }
        : { status: 200, body: { receipt: { published: [], failed: [{ date: TOMORROW, error: 'x', certainty: 'rejected' }] } } }
    await runAutoPublishSweep(makeDeps(T0, refuse).deps)
    expect(db.attempts[0]).toMatchObject({ status: 'failed_retryable', attempt_no: 1 })

    const early = makeDeps(min(5), ok)
    await runAutoPublishSweep(early.deps)
    expect(early.liveCalls()).toBe(0) // still waiting

    const due = makeDeps(min(11), ok)
    await runAutoPublishSweep(due.deps)
    expect(due.liveCalls()).toBe(1)
    expect(db.attempts[0]).toMatchObject({ status: 'published', attempt_no: 2 })
  })

  it('after three definite refusals the date is failed_final and is never tried again', async () => {
    const refuse: Script = async input =>
      input.command.no_publish
        ? { status: 200, body: { success: true } }
        : { status: 200, body: { receipt: { published: [], failed: [{ date: TOMORROW, error: 'x', certainty: 'rejected' }] } } }
    await runAutoPublishSweep(makeDeps(T0, refuse).deps) // attempt 1
    await runAutoPublishSweep(makeDeps(min(11), refuse).deps) // attempt 2
    await runAutoPublishSweep(makeDeps(min(40), refuse).deps) // attempt 3
    expect(db.attempts[0]).toMatchObject({ status: 'failed_final', attempt_no: 3 })

    const later = makeDeps(min(300), ok)
    await runAutoPublishSweep(later.deps)
    expect(later.liveCalls()).toBe(0)
  })

  it('🔴 an unknown outcome is never retried; a human saying "not published" re-opens exactly that date', async () => {
    const boom: Script = async input => {
      if (input.command.no_publish) return { status: 200, body: { success: true } }
      throw new Error('socket hang up')
    }
    await runAutoPublishSweep(makeDeps(T0, boom).deps)
    expect(db.attempts[0]).toMatchObject({ status: 'unknown_outcome', reason_code: 'RUNNER_THREW' })

    for (const t of [min(30), min(600)]) {
      const again = makeDeps(t, ok)
      await runAutoPublishSweep(again.deps)
      expect(again.liveCalls()).toBe(0)
    }

    const confirmed = await confirmUnknownOutcome({ planId: PLAN, clientId: CLIENT, date: TOMORROW, outcome: 'not_published', now: min(700) })
    expect(confirmed?.status).toBe('failed_retryable')
    const resumed = makeDeps(min(701), ok)
    await runAutoPublishSweep(resumed.deps)
    expect(resumed.liveCalls()).toBe(1)
    expect(db.attempts[0].status).toBe('published')
  })

  it('a human saying "published" closes the date for good', async () => {
    const boom: Script = async input => {
      if (input.command.no_publish) return { status: 200, body: { success: true } }
      throw new Error('socket hang up')
    }
    await runAutoPublishSweep(makeDeps(T0, boom).deps)
    await confirmUnknownOutcome({ planId: PLAN, clientId: CLIENT, date: TOMORROW, outcome: 'published', now: min(10) })
    const again = makeDeps(min(20), ok)
    await runAutoPublishSweep(again.deps)
    expect(again.liveCalls()).toBe(0)
    expect(db.attempts[0].status).toBe('published')
  })

  it('🔴 a recall (tombstone) stops the date even though the grant still lists it; a confirm cannot reopen a tombstone', async () => {
    await tombstoneRecalledDates({ clientId: CLIENT, planId: PLAN, dates: [TOMORROW] })
    expect(db.attempts[0]).toMatchObject({ status: 'blocked', reason_code: 'RECALLED' })
    const sweep = makeDeps(T0, ok)
    await runAutoPublishSweep(sweep.deps)
    expect(sweep.liveCalls()).toBe(0)
    expect(await confirmUnknownOutcome({ planId: PLAN, clientId: CLIENT, date: TOMORROW, outcome: 'not_published', now: min(5) })).toBeNull()
  })

  it('a gate block is written, then re-evaluated each sweep and sent once the cause is fixed', async () => {
    const blocked: Script = async () => ({ status: 409, body: { success: false, error: 'PRICE_FACT_UNVERIFIED' } })
    await runAutoPublishSweep(makeDeps(T0, blocked).deps)
    expect(db.attempts[0]).toMatchObject({ status: 'blocked', reason_code: 'PRICE_FACT_UNVERIFIED' })

    const fixed = makeDeps(min(60), ok)
    await runAutoPublishSweep(fixed.deps)
    expect(fixed.liveCalls()).toBe(1)
    expect(db.attempts[0].status).toBe('published')
  })

  it('revoking the grant stops the next sweep cold', async () => {
    db.auth[0].revoked_at = '2026-10-11T00:00:00.000Z'
    const sweep = makeDeps(T0, ok)
    const summary = await runAutoPublishSweep(sweep.deps)
    expect(sweep.sent).not.toHaveBeenCalled()
    expect(summary.authorizations).toBe(0)
    expect(db.attempts).toHaveLength(0)
  })
})
