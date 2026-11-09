/**
 * The hourly auto-publish function: wiring and run-log behaviour. The sweep's own
 * rules are covered in `campaign/__tests__/daily-plan-auto-publish-worker.test.ts`;
 * here the sweep is a stub so only scheduling, retries and the run log are on trial.
 * (`.opts` / `.fn` bridging is the same one the other function tests use.)
 */
import { describe, expect, it, vi } from 'vitest'
import { createDailyPlanAutoPublishFunction, DAILY_PLAN_AUTO_PUBLISH_CRON, DAILY_PLAN_AUTO_PUBLISH_FUNCTION_ID, DAILY_PLAN_AUTO_PUBLISH_JOB } from '../daily-plan-auto-publish'
import { CLOUD_FN_PREFIX } from '../../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import type { AutoPublishWorkerDeps, SweepSummary } from '@/lib/campaign/daily-plan-auto-publish-worker'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))

type Fn = ReturnType<typeof createDailyPlanAutoPublishFunction>
const optsOf = (fn: Fn) =>
  (fn as unknown as {
    opts: { id?: string; triggers?: { cron?: string }[]; retries?: number; concurrency?: { limit?: number } }
  }).opts
const handlerOf = (fn: Fn) => (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
const fakeStep = () => ({ run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()) })

const emptyDeps = (listLive: () => Promise<never[]>): AutoPublishWorkerDeps => ({
  now: new Date('2026-10-12T00:00:00Z'),
  switches: { live: false, clientIds: [] },
  listLiveAuthorizations: listLive,
  isGlobalAdmin: () => true,
  getActiveAuthorization: async () => null,
  loadPlanState: async () => null,
  loadScope: async () => ({ clientStatus: null, campaignStatus: null }),
  listAttempts: async () => [],
  claimAttempt: async () => false,
  finishAttempt: async () => false,
  runPublish: async () => ({ status: 500, body: {} }),
  emit: async () => undefined,
})

function build(listLive: () => Promise<never[]>) {
  const startRun = vi.fn(async () => 'run-1')
  const finishRun = vi.fn(async (_input: { runId: string; startedAt: number; summary?: SweepSummary; error?: string }) => undefined)
  const fn = createDailyPlanAutoPublishFunction({ buildDeps: () => emptyDeps(listLive), startRun, finishRun })
  return { fn, startRun, finishRun }
}

describe('daily-plan-auto-publish function', () => {
  it('🔴 is scheduled hourly at minute 20 in New Zealand time, never retries, never overlaps', () => {
    const { fn } = build(async () => [])
    const opts = optsOf(fn)
    expect(opts.id).toBe(`${CLOUD_FN_PREFIX}daily-plan-auto-publish`)
    expect(opts.triggers?.[0]?.cron).toBe(DAILY_PLAN_AUTO_PUBLISH_CRON)
    expect(DAILY_PLAN_AUTO_PUBLISH_CRON).toBe('TZ=Pacific/Auckland 20 * * * *')
    expect(opts.retries).toBe(0)
    expect(opts.concurrency?.limit).toBe(1)
  })

  it('🔴 cron 登记表里有它：由 Inngest 调度、写运行记录，周期跟上面的常量是同一个（去掉 TZ 前缀）——没登记 = 它哪天安静地不跑时没人喊', () => {
    const entry = CRON_REGISTRY.find(e => e.jobName === DAILY_PLAN_AUTO_PUBLISH_JOB)
    expect(entry).toMatchObject({ scheduler: 'inngest', logsRuns: true, service: `inngest:${DAILY_PLAN_AUTO_PUBLISH_FUNCTION_ID}` })
    expect(entry?.schedule).toBe(DAILY_PLAN_AUTO_PUBLISH_CRON.replace(/^TZ=\S+\s+/, ''))
  })

  it('runs the sweep inside steps and closes the run log with the summary', async () => {
    const { fn, startRun, finishRun } = build(async () => [])
    const step = fakeStep()
    const out = await handlerOf(fn)({ step })

    expect(startRun).toHaveBeenCalledTimes(1)
    expect(step.run.mock.calls.map(c => c[0])).toEqual(['start-run', 'sweep', 'finish-run'])
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][0]).toMatchObject({ runId: 'run-1' })
    expect(finishRun.mock.calls[0][0].summary).toMatchObject({ authorizations: 0, records: [] })
    expect(out).toEqual({})
  })

  it('🔴 a failing sweep closes the run log with the error FIRST, then fails the run loudly', async () => {
    const { fn, finishRun } = build(async () => {
      throw new Error('db down')
    })
    await expect(handlerOf(fn)({ step: fakeStep() })).rejects.toThrow('daily-plan-auto-publish sweep failed: db down')
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][0]).toMatchObject({ runId: 'run-1', error: 'db down' })
    expect(finishRun.mock.calls[0][0].summary).toBeUndefined()
  })
})
