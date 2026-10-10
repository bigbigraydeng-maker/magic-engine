/**
 * SEO meta-cycle rank sampler · Inngest wiring test.
 *
 * Tests the ASSEMBLY (triggers, namespace, retry/concurrency policy, that every side effect sits
 * inside a step, that the receipts carry calls + cost). The sampling logic itself is covered in
 * src/lib/seo-meta/cycle/__tests__/rank-sampler.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const startCronRunId = vi.fn(async (_job: string) => 'run-1')
const finish = vi.fn(async (_opts: Record<string, unknown>) => undefined)
const failOpenCronRuns = vi.fn(async (_job: string, _msg: string, _opts: { startedBefore: Date }) => 1)
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (job: string) => startCronRunId(job),
  cronRunHandle: () => ({ finish }),
  failOpenCronRuns: (job: string, msg: string, opts: { startedBefore: Date }) => failOpenCronRuns(job, msg, opts),
  startCronRun: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

const loadDueRows = vi.fn()
const sampleOneRow = vi.fn()
vi.mock('@/lib/seo-meta/cycle/rank-sampler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/seo-meta/cycle/rank-sampler')>('@/lib/seo-meta/cycle/rank-sampler')
  return { ...actual, loadDueRows: (...a: unknown[]) => loadDueRows(...a), sampleOneRow: (...a: unknown[]) => sampleOneRow(...a) }
})

import { buildRankSampleEvents, createRankSamplerFanOutFunction, createRankSamplerOneFunction } from '../functions/seo-meta-rank-sampler'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import { MAX_ROWS_PER_RUN, RANK_SAMPLER_CRON, RANK_SAMPLER_JOB, RANK_SAMPLE_DUE_EVENT } from '@/lib/seo-meta/cycle/rank-sampler'

type Opts = {
  triggers?: Array<{ event?: string; cron?: string }>
  retries?: number
  concurrency?: { limit: number; key?: string }
  onFailure?: (a: { event: { ts?: number }; error?: { message: string } }) => Promise<void>
}
const optsOf = (fn: unknown): Opts => (fn as { opts: Opts }).opts
const handlerOf = (fn: unknown) => (fn as { fn: (a: unknown) => Promise<unknown> }).fn

function fakeStep() {
  const ran: string[] = []
  const sent: unknown[][] = []
  let inside = false
  return {
    ran, sent,
    startedOutsideStep: [] as string[],
    isInside: () => inside,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => { ran.push(id); inside = true; try { return await fn() } finally { inside = false } },
      sendEvent: async (id: string, events: unknown[]) => { ran.push(id); sent.push(events) },
    },
  }
}

describe('registration and policy', () => {
  it('both functions are registered with the cloud- prefix', () => {
    const ids = cloudFunctions.map((f) => f.id())
    expect(ids).toContain(`${CLOUD_FN_PREFIX}seo-meta-rank-sampler-fanout`)
    expect(ids).toContain(`${CLOUD_FN_PREFIX}seo-meta-rank-sampler-one`)
  })

  it('the fan-out is cron-triggered with the single shared RANK_SAMPLER_CRON; the worker listens to the due event, which the local factory worker does not own', () => {
    const fanout = cloudFunctions.find((f) => f.id().endsWith('seo-meta-rank-sampler-fanout'))!
    const one = cloudFunctions.find((f) => f.id().endsWith('seo-meta-rank-sampler-one'))!
    expect(optsOf(fanout).triggers?.[0]?.cron).toBe(RANK_SAMPLER_CRON)
    expect(optsOf(one).triggers?.[0]?.event).toBe(RANK_SAMPLE_DUE_EVENT)
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(RANK_SAMPLE_DUE_EVENT)
  })

  it('🔴 the per-row function never auto-retries (the SERP charge happens inside the step) and runs one row at a time (onFailure closes by job name)', () => {
    const one = cloudFunctions.find((f) => f.id().endsWith('seo-meta-rank-sampler-one'))!
    expect(optsOf(one).retries).toBe(0)
    expect(optsOf(one).concurrency).toEqual({ limit: 1 })
    expect(optsOf(one).onFailure).toBeTypeOf('function')
  })
})

describe('buildRankSampleEvents', () => {
  it('one event per row, dated, with a stable per-row-per-day id', () => {
    const events = buildRankSampleEvents([{ id: 'a', client_id: 'c1' }, { id: 'b', client_id: 'c1' }], '2026-10-23')
    expect(events).toEqual([
      { id: 'seo-meta-rank-a-2026-10-23', name: RANK_SAMPLE_DUE_EVENT, data: { row_id: 'a', client_id: 'c1', day: '2026-10-23' } },
      { id: 'seo-meta-rank-b-2026-10-23', name: RANK_SAMPLE_DUE_EVENT, data: { row_id: 'b', client_id: 'c1', day: '2026-10-23' } },
    ])
  })
})

describe('fan-out', () => {
  beforeEach(() => { vi.clearAllMocks(); startCronRunId.mockResolvedValue('run-1') })

  const NOW = new Date('2026-10-23T20:20:00.000Z')
  async function run() {
    const fn = createRankSamplerFanOutFunction({ supabase: {} as never, now: () => NOW })
    const h = fakeStep()
    const result = await handlerOf(fn)({ step: h.step })
    return { result: result as Record<string, unknown>, h }
  }

  it('dispatches one event per due row and ends — the receipt says dispatched, not sampled, and caps the possible SERP calls', async () => {
    loadDueRows.mockResolvedValue([{ id: 'r1', client_id: 'c1' }, { id: 'r2', client_id: 'c1' }])
    const { result, h } = await run()
    expect(h.sent).toHaveLength(1)
    expect((h.sent[0] as Array<{ data: { row_id: string } }>).map((e) => e.data.row_id)).toEqual(['r1', 'r2'])
    expect(result).toMatchObject({ status: 'dispatched', rows_dispatched: 2, max_provider_calls: 2, no_publish: true })
    expect(finish.mock.calls[0][0]).toMatchObject({ processed: 2, summary: { counts_are: 'dispatched_not_sampled', max_provider_calls: 2 } })
  })

  it('sends nothing when nothing is due, and still writes a receipt (an empty day must be visible, not silent)', async () => {
    loadDueRows.mockResolvedValue([])
    const { result, h } = await run()
    expect(h.sent).toHaveLength(0)
    expect(result).toMatchObject({ status: 'nothing_due', rows_dispatched: 0 })
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('opens the run record inside a step (outside a step Inngest would replay it and insert phantom rows)', async () => {
    loadDueRows.mockResolvedValue([])
    const fn = createRankSamplerFanOutFunction({ supabase: {} as never, now: () => NOW })
    const h = fakeStep()
    let insideWhenOpened: boolean | null = null
    startCronRunId.mockImplementation(async () => { insideWhenOpened = h.isInside(); return 'run-1' })
    await handlerOf(fn)({ step: h.step })
    expect(insideWhenOpened).toBe(true)
  })

  it('never asks for more rows than the per-run ceiling', () => {
    expect(MAX_ROWS_PER_RUN).toBeLessThanOrEqual(30)
  })
})

describe('per-row function', () => {
  beforeEach(() => { vi.clearAllMocks(); startCronRunId.mockResolvedValue('run-1') })

  async function run(data: Record<string, unknown>) {
    const fn = createRankSamplerOneFunction({ supabase: {} as never })
    const h = fakeStep()
    const result = await handlerOf(fn)({ event: { data }, step: h.step })
    return { result, h, fn }
  }

  it('samples exactly the row in the event, and the receipt carries the SERP calls made and their cost', async () => {
    sampleOneRow.mockResolvedValue({ kind: 'sampled', rowId: 'r1', verdict: null, costUsd: 0.012, providerCalls: 1 })
    await run({ row_id: 'r1', client_id: 'c1' })
    expect(sampleOneRow).toHaveBeenCalledTimes(1)
    expect(sampleOneRow.mock.calls[0][0]).toBe('r1')
    expect(finish.mock.calls[0][0]).toMatchObject({ processed: 1, summary: { row_id: 'r1', outcome: 'sampled', provider_calls: 1, cost_usd: 0.012, no_publish: true } })
  })

  it('records a finalised verdict in the receipt', async () => {
    sampleOneRow.mockResolvedValue({ kind: 'finalised', rowId: 'r1', verdict: 'no_detectable_change', costUsd: 0.01, providerCalls: 1 })
    await run({ row_id: 'r1', client_id: 'c1' })
    expect(finish.mock.calls[0][0]).toMatchObject({ summary: { outcome: 'finalised', rank_verdict: 'no_detectable_change' } })
  })

  it('ignores a malformed event: no provider call, no run record', async () => {
    const { result } = await run({})
    expect(result).toEqual({ kind: 'invalid_payload' })
    expect(sampleOneRow).not.toHaveBeenCalled()
    expect(startCronRunId).not.toHaveBeenCalled()
  })

  it('a sampling error propagates (the run is visibly failed, nothing reports success it did not achieve)', async () => {
    sampleOneRow.mockRejectedValue(new Error('rank_sampler_write_failed:boom'))
    await expect(run({ row_id: 'r1', client_id: 'c1' })).rejects.toThrow('rank_sampler_write_failed:boom')
    expect(finish).not.toHaveBeenCalled()
  })

  it('onFailure closes the still-running receipts of this job so a dead run cannot stay "running" forever', async () => {
    const { fn } = await run({}).then((r) => r)
    await optsOf(fn).onFailure!({ event: { ts: 1_700_000_000_000 }, error: { message: 'boom' } })
    expect(failOpenCronRuns).toHaveBeenCalledWith(RANK_SAMPLER_JOB, expect.stringContaining('boom'), { startedBefore: new Date(1_700_000_000_000) })
  })
})
