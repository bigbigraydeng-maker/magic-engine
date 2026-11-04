/**
 * Tests for the reel scheduled go-public Inngest function. The executor
 * (`runScheduledPromote`) is stubbed through `runOne`; only the wiring is on trial.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createReelScheduledFunction,
  DEFAULT_PUBLISH_HOUR,
  nzHour,
  publishHourOf,
  REEL_SCHEDULED_CRON,
  REEL_SCHEDULED_EVENT,
  REEL_SCHEDULED_FUNCTION_ID,
  type ReelScheduledDeps,
} from '../cloud-reel-scheduled-go-public'
import { CLOUD_FN_PREFIX } from '../../client'
import type { ScheduledResult } from '@/lib/factory/publish/promote/scheduled-action'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

type Fn = ReturnType<typeof createReelScheduledFunction>

const optsOf = (fn: Fn) =>
  Reflect.get(fn, 'opts') as {
    id?: string
    triggers?: { cron?: string; event?: string }[]
    retries?: number
    concurrency?: { limit?: number }
  }

const handlerOf = (fn: Fn) =>
  Reflect.get(fn, 'fn') as (args: { event: unknown; step: unknown }) => Promise<unknown>

const fakeStep = () => ({
  run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()),
})

const okResult = (orderId: string): ScheduledResult => ({
  order_id: orderId,
  outcome: 'published',
  reason: 'published',
  needs_person: false,
})

function makeDeps(
  env: Record<string, string | undefined>,
  over: Partial<ReelScheduledDeps> = {},
): ReelScheduledDeps {
  return {
    env: () => env,
    now: () => new Date('2026-11-09T05:00:00Z'),
    listClients: vi.fn(async () => [
      { id: 'c1', config: {} },
      { id: 'c2', config: {} },
    ]),
    loadDueOrderIds: vi.fn(async (clientId: string) =>
      clientId === 'c1' ? ['o1', 'o2'] : ['o3'],
    ),
    runOne: vi.fn(async (orderId: string) => okResult(orderId)),
    startRun: vi.fn(async () => 'run-1'),
    finishRun: vi.fn(async () => undefined),
    ...over,
  }
}

const cronEvent = { name: 'inngest/scheduled.timer', data: {} }
const dueEvent = (data: Record<string, unknown>) => ({ name: REEL_SCHEDULED_EVENT, data })

describe('reel-scheduled-go-public function', () => {
  it('🔴 is registered with the cron and event triggers, never retries, serialises globally', () => {
    const fn = createReelScheduledFunction(makeDeps({}))
    const opts = optsOf(fn)
    expect(opts.id).toBe(`${CLOUD_FN_PREFIX}reel-scheduled-go-public`)
    expect(opts.id).toBe(REEL_SCHEDULED_FUNCTION_ID)
    expect(opts.triggers?.[0]?.cron).toBe(REEL_SCHEDULED_CRON)
    expect(REEL_SCHEDULED_CRON).toBe('TZ=Pacific/Auckland */30 * * * *')
    expect(opts.triggers?.[1]?.event).toBe(REEL_SCHEDULED_EVENT)
    expect(REEL_SCHEDULED_EVENT).toBe('social/reel.scheduled_go_public.due')
    expect(opts.retries).toBe(0)
    expect(opts.concurrency?.limit).toBe(1)
  })

  it('🔴 switch off: cron writes a disabled receipt and calls neither loadDueOrderIds nor runOne', async () => {
    const deps = makeDeps({})
    const fn = createReelScheduledFunction(deps)
    const out = (await handlerOf(fn)({ event: cronEvent, step: fakeStep() })) as { status: string }
    expect(out.status).toBe('disabled')
    expect(deps.listClients).not.toHaveBeenCalled()
    expect(deps.loadDueOrderIds).not.toHaveBeenCalled()
    expect(deps.runOne).not.toHaveBeenCalled()
    expect(deps.finishRun).toHaveBeenCalledTimes(1)
  })

  it('🔴 switch on: no runOne before 18:00 NZ, runs each due id at 18:00 NZ with dryRun false', async () => {
    const env = { WEEKLY_PACK_REEL_SCHEDULED_PUBLIC: 'true' }

    const early = makeDeps(env, { now: () => new Date('2026-11-09T04:00:00Z') })
    const earlyFn = createReelScheduledFunction(early)
    await handlerOf(earlyFn)({ event: cronEvent, step: fakeStep() })
    expect(early.runOne).not.toHaveBeenCalled()

    const onTime = makeDeps(env, { now: () => new Date('2026-11-09T05:00:00Z') })
    const onTimeFn = createReelScheduledFunction(onTime)
    await handlerOf(onTimeFn)({ event: cronEvent, step: fakeStep() })
    const calls = (onTime.runOne as unknown as { mock: { calls: [string, { dryRun: boolean; executedBy: string }][] } }).mock.calls
    expect(calls.map((c) => c[0])).toEqual(['o1', 'o2', 'o3'])
    for (const [, opts] of calls) {
      expect(opts.dryRun).toBe(false)
      expect(opts.executedBy.startsWith('system:week-card:')).toBe(true)
    }
  })

  it('client config weekly_pack.publish_hour 9 → runs at 09:00 NZ', async () => {
    const env = { WEEKLY_PACK_REEL_SCHEDULED_PUBLIC: 'true' }
    const deps = makeDeps(env, {
      now: () => new Date('2026-11-08T20:00:00Z'),
      listClients: vi.fn(async () => [
        { id: 'c1', config: { publishing_calendar_config: { weekly_pack: { publish_hour: 9 } } } },
      ]),
      loadDueOrderIds: vi.fn(async () => ['o1']),
    })
    const fn = createReelScheduledFunction(deps)
    await handlerOf(fn)({ event: cronEvent, step: fakeStep() })
    expect(deps.runOne).toHaveBeenCalledTimes(1)
    expect((deps.runOne as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]).toBe('o1')
  })

  it('🔴 one runOne throws → that order is a failed result with needs_person, the next order still runs', async () => {
    const env = { WEEKLY_PACK_REEL_SCHEDULED_PUBLIC: 'true' }
    const deps = makeDeps(env, {
      listClients: vi.fn(async () => [{ id: 'c1', config: {} }]),
      loadDueOrderIds: vi.fn(async () => ['o1', 'o2']),
      runOne: vi.fn(async (orderId: string) => {
        if (orderId === 'o1') throw new Error('boom')
        return okResult(orderId)
      }),
    })
    const fn = createReelScheduledFunction(deps)
    const out = (await handlerOf(fn)({ event: cronEvent, step: fakeStep() })) as {
      clients: { results: ScheduledResult[] }[]
    }
    const results = out.clients[0].results
    expect(results[0]).toMatchObject({ order_id: 'o1', outcome: 'failed', needs_person: true })
    expect(results[1]).toMatchObject({ order_id: 'o2', outcome: 'published' })
    const finish = (deps.finishRun as unknown as { mock: { calls: [{ failed: number }][] } }).mock.calls[0][0]
    expect(finish.failed).toBeGreaterThanOrEqual(1)
  })

  it('🔴 manual event with switch off → runOne called with dryRun true', async () => {
    const deps = makeDeps({})
    const fn = createReelScheduledFunction(deps)
    await handlerOf(fn)({ event: dueEvent({ clientId: 'c1' }), step: fakeStep() })
    const calls = (deps.runOne as unknown as { mock: { calls: [string, { dryRun: boolean }][] } }).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const [, opts] of calls) expect(opts.dryRun).toBe(true)
  })

  it('publishHourOf unit cases', () => {
    expect(publishHourOf({})).toBe(DEFAULT_PUBLISH_HOUR)
    expect(publishHourOf({ publishing_calendar_config: { weekly_pack: { publish_hour: 7 } } })).toBe(7)
    expect(publishHourOf({ publishing_calendar_config: { weekly_pack: { publish_hour: 24 } } })).toBe(DEFAULT_PUBLISH_HOUR)
    expect(publishHourOf({ publishing_calendar_config: { weekly_pack: { publish_hour: '7' } } })).toBe(DEFAULT_PUBLISH_HOUR)
  })

  it('nzHour(new Date("2026-11-09T05:00:00Z")) === 18', () => {
    expect(nzHour(new Date('2026-11-09T05:00:00Z'))).toBe(18)
  })
})
