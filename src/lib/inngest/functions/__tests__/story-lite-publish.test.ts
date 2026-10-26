/**
 * The ten-minute story sweep function: wiring and run-log behaviour. The sweep's own rules are covered in
 * `social/story-lite/__tests__/sender.test.ts`; here the sweep runs over an empty store so only scheduling,
 * retries and the run log are on trial.
 */
import { describe, expect, it, vi } from 'vitest'
import { createStoryLitePublishFunction, STORY_LITE_PUBLISH_CRON, STORY_LITE_PUBLISH_FUNCTION_ID, STORY_LITE_PUBLISH_JOB } from '../story-lite-publish'
import { CLOUD_FN_PREFIX } from '../../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { InMemoryLiteStore } from '@/lib/social/story-lite/in-memory-store'
import { DEFAULT_SWEEP_CONFIG, type SenderDeps, type SweepSummary } from '@/lib/social/story-lite/sender'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))

type Fn = ReturnType<typeof createStoryLitePublishFunction>
const optsOf = (fn: Fn) =>
  (fn as unknown as {
    opts: { id?: string; triggers?: { cron?: string }[]; retries?: number; concurrency?: { limit?: number } }
  }).opts
const handlerOf = (fn: Fn) => (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
const fakeStep = () => ({ run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()) })

function depsWith(store: InMemoryLiteStore): SenderDeps {
  return {
    now: new Date('2026-10-12T00:00:00Z'),
    store,
    switches: { live: false, clientIds: [] },
    config: DEFAULT_SWEEP_CONFIG,
    checkFile: async () => 'OK',
    getPageToken: async () => null,
    publish: async () => {
      throw new Error('publish must never be called in rehearsal')
    },
    emit: async () => undefined,
  }
}

function build(store: InMemoryLiteStore) {
  const startRun = vi.fn(async () => 'run-1')
  const finishRun = vi.fn(async (_input: { runId: string; startedAt: number; summary?: SweepSummary; error?: string }) => undefined)
  const fn = createStoryLitePublishFunction({ buildDeps: () => depsWith(store), startRun, finishRun })
  return { fn, startRun, finishRun }
}

describe('story-lite-publish function', () => {
  it('🔴 is scheduled every ten minutes in New Zealand time, never retries, never overlaps', () => {
    const { fn } = build(new InMemoryLiteStore())
    const opts = optsOf(fn)
    expect(opts.id).toBe(`${CLOUD_FN_PREFIX}story-lite-publish`)
    expect(opts.triggers?.[0]?.cron).toBe(STORY_LITE_PUBLISH_CRON)
    expect(STORY_LITE_PUBLISH_CRON).toBe('TZ=Pacific/Auckland */10 * * * *')
    expect(opts.retries).toBe(0)
    expect(opts.concurrency?.limit).toBe(1)
  })

  it('🔴 cron 登记表里有它：由 Inngest 调度、写运行记录，周期跟上面的常量是同一个（去掉 TZ 前缀）——没登记 = 它哪天安静地不跑时没人喊', () => {
    const entry = CRON_REGISTRY.find(e => e.jobName === STORY_LITE_PUBLISH_JOB)
    expect(entry).toMatchObject({ scheduler: 'inngest', logsRuns: true, service: `inngest:${STORY_LITE_PUBLISH_FUNCTION_ID}` })
    expect(entry?.schedule).toBe(STORY_LITE_PUBLISH_CRON.replace(/^TZ=\S+\s+/, ''))
  })

  it('runs the sweep inside steps and closes the run log with the summary', async () => {
    const { fn, startRun, finishRun } = build(new InMemoryLiteStore())
    const step = fakeStep()
    const out = await handlerOf(fn)({ step })

    expect(startRun).toHaveBeenCalledTimes(1)
    expect(step.run.mock.calls.map((c) => c[0])).toEqual(['start-run', 'sweep', 'finish-run'])
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][0]).toMatchObject({ runId: 'run-1' })
    expect(finishRun.mock.calls[0][0].summary).toMatchObject({ records: [], staleExpired: [] })
    expect(out).toEqual({})
  })

  it('🔴 a failing sweep closes the run log with the error FIRST, then fails the run loudly', async () => {
    const store = new InMemoryLiteStore()
    store.listLivePacks = async () => {
      throw new Error('db down')
    }
    const { fn, finishRun } = build(store)
    await expect(handlerOf(fn)({ step: fakeStep() })).rejects.toThrow('story-lite-publish sweep failed: db down')
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][0]).toMatchObject({ runId: 'run-1', error: 'db down' })
    expect(finishRun.mock.calls[0][0].summary).toBeUndefined()
  })
})
