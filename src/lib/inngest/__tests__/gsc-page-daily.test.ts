// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => ({
  supabaseAdmin: (await import('@/lib/gsc/__tests__/fake-db')).fakeDb.client,
}))

import { fakeDb } from '@/lib/gsc/__tests__/fake-db'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import {
  GSC_PAGE_DAILY_CRON,
  GSC_PAGE_DAILY_PULL_EVENT,
  GSC_PAGE_DAILY_TZ,
  type PullOrder,
} from '@/lib/gsc/page-daily-plan'
import type { PlanResult } from '@/lib/gsc/page-daily-store'
import {
  buildPullEvents,
  defaultPullDeps,
  gscPageDailyFanOut,
  gscPageDailyPull,
  runGscPageDailyFanOut,
  type FanOutStep,
  type PullEvent,
} from '../functions/gsc-page-daily'

const A = 'c0000000-0000-0000-0000-000000000000'
const B = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const SITE = 'https://a.example.com/'

/** A fake step that records step ids and sent event batches, and runs the work inline. */
function fakeStep(): { ids: string[]; sent: PullEvent[][]; step: FanOutStep } {
  const ids: string[] = []
  const sent: PullEvent[][] = []
  const step: FanOutStep = {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      ids.push(id)
      return fn()
    },
    async sendEvent(id: string, events: PullEvent[]): Promise<unknown> {
      ids.push(id)
      sent.push(events)
      return { ids: [] }
    },
  }
  return { ids, sent, step }
}

/** The single cron_run_logs row written by a fan-out run. */
function runLog(): Record<string, unknown> | undefined {
  return (fakeDb.tables.cron_run_logs ?? [])[0]
}

/** Read one key out of a run log's summary without casting. */
function field(row: Record<string, unknown> | undefined, key: string): unknown {
  const summary = row?.summary
  if (typeof summary !== 'object' || summary === null || !(key in summary)) return undefined
  return Reflect.get(summary, key)
}

beforeEach(() => {
  fakeDb.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('gsc page daily cloud functions', () => {
  it('both functions are registered with the cloud- prefix', () => {
    const ids = cloudFunctions.map((f) => f.id())
    expect(ids).toContain(`${CLOUD_FN_PREFIX}gsc-page-daily-fanout`)
    expect(ids).toContain(`${CLOUD_FN_PREFIX}gsc-page-daily-pull`)
  })

  it('🔴 the pull event is cloud-only (one event, one owner)', () => {
    // Widening by assignment (no cast): the literal tuple type would reject the comparison outright.
    const workerOwned: readonly string[] = WORKER_OWNED_EVENTS
    expect(workerOwned).not.toContain(GSC_PAGE_DAILY_PULL_EVENT)
  })

  it('🔴 the fan-out trigger is the single schedule constant, with its time zone', () => {
    const triggers: unknown = Reflect.get(gscPageDailyFanOut.opts, 'triggers')
    expect(Array.isArray(triggers)).toBe(true)
    const cronTrigger = (triggers as unknown[]).find(
      (t): t is { cron: string } =>
        typeof t === 'object' && t !== null && 'cron' in t && typeof Reflect.get(t, 'cron') === 'string',
    )
    expect(cronTrigger?.cron).toBe(`TZ=${GSC_PAGE_DAILY_TZ} ${GSC_PAGE_DAILY_CRON}`)
    expect(GSC_PAGE_DAILY_CRON).toBe('30 18 * * *')
  })

  it('🔴 pull: one order per client at a time, at most 3 overall, 2 retries, onFailure wired', () => {
    expect(gscPageDailyPull.opts.concurrency).toEqual([
      { key: 'event.data.client_id', limit: 1 },
      { limit: 3 },
    ])
    expect(gscPageDailyPull.opts.retries).toBe(2)
    expect(typeof gscPageDailyPull.opts.onFailure).toBe('function')

    const triggers: unknown = Reflect.get(gscPageDailyPull.opts, 'triggers')
    expect(Array.isArray(triggers)).toBe(true)
    const eventTrigger = (triggers as unknown[]).find(
      (t): t is { event: string } =>
        typeof t === 'object' && t !== null && 'event' in t && typeof Reflect.get(t, 'event') === 'string',
    )
    expect(eventTrigger?.event).toBe(GSC_PAGE_DAILY_PULL_EVENT)
  })

  it('fan-out: one event per order with deterministic ids; the run log says "dispatched, not pulled"', async () => {
    const orders: PullOrder[] = [
      { client_id: A, kind: 'daily', start_day: '2026-09-21', end_day: '2026-09-25' },
      { client_id: A, kind: 'backfill', start_day: '2026-09-01', end_day: '2026-09-20' },
    ]
    const buildPlan = vi.fn(async (): Promise<PlanResult> => ({ ok: true, orders, clients: 1 }))
    const h = fakeStep()

    const result = await runGscPageDailyFanOut(h.step, { buildPlan })

    expect(result.status).toBe('dispatched')
    expect(result.orders_dispatched).toBe(2)
    expect(result.daily_orders).toBe(1)
    expect(result.backfill_orders).toBe(1)
    expect(result.no_publish).toBe(true)

    expect(h.ids).toEqual(['log-start', 'plan', 'dispatch-pulls', 'log-finish-dispatched'])
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toEqual(buildPullEvents(orders))
    expect(h.sent[0].map((e) => e.id)).toEqual([
      `gsc-page-daily:${A}:daily:2026-09-21:2026-09-25`,
      `gsc-page-daily:${A}:backfill:2026-09-01:2026-09-20`,
    ])
    expect(h.sent[0].every((e) => e.name === GSC_PAGE_DAILY_PULL_EVENT)).toBe(true)

    const row = runLog()
    expect(row?.job_name).toBe('gsc-page-daily')
    expect(row?.status).toBe('completed')
    expect(row?.processed).toBe(2)
    expect(field(row, 'counts_are')).toBe('dispatched_not_pulled')
  })

  it('🔴 "today" is the Pacific date, computed inside a step', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T05:30:00Z'))
    const buildPlan = vi.fn(async (): Promise<PlanResult> => ({ ok: true, orders: [], clients: 0 }))
    const h = fakeStep()

    const result = await runGscPageDailyFanOut(h.step, { buildPlan })

    expect(buildPlan).toHaveBeenCalledWith('2026-09-26')
    expect(result.today).toBe('2026-09-26')
    expect(result.status).toBe('nothing_to_do')
    expect(runLog()?.status).toBe('completed')
    expect(h.sent).toHaveLength(0)
  })

  it('a plan failure writes one failed run log and dispatches nothing', async () => {
    const buildPlan = vi.fn(async (): Promise<PlanResult> => ({ ok: false, reason: 'roster: boom' }))
    const h = fakeStep()

    const result = await runGscPageDailyFanOut(h.step, { buildPlan })

    expect(result.status).toBe('plan_failed')
    expect(result.error).toBe('roster: boom')
    expect(h.sent).toHaveLength(0)

    const row = runLog()
    expect(row?.status).toBe('failed')
    expect(String(row?.error_message)).toContain('roster: boom')
  })

  it('defaultPullDeps().loadSiteUrl reads the shared GSC roster', async () => {
    fakeDb.tables.client_connectors = [
      { client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: SITE } },
      { client_id: B, anchor: 'gsc', status: 'not_connected', config: { site_url: 'https://b.example.com/' } },
    ]

    const deps = defaultPullDeps()
    await expect(deps.loadSiteUrl(A)).resolves.toBe(SITE)
    await expect(deps.loadSiteUrl(B)).resolves.toBeNull()

    fakeDb.fail({ table: 'client_connectors', op: 'select', message: 'boom', times: 1 })
    await expect(deps.loadSiteUrl(A)).rejects.toThrow('[db] GSC roster read failed: boom')
  })
})
