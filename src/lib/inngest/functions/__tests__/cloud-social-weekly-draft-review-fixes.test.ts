/**
 * Review-fix coverage for the weekly draft function: the two switches, the
 * failure bookkeeping in the run log, and the receipt metadata. The template
 * `cloud-social-weekly-draft.test.ts` covers scheduling and mode resolution;
 * here the focus is on what gets recorded when things go wrong.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createSocialWeeklyDraftFunction,
  resolveMode,
  SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
  type SocialWeeklyDraftDeps,
} from '../cloud-social-weekly-draft'
import type { WeeklyLoopDeps } from '@/lib/social/weekly-loop/run'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

type Fn = ReturnType<typeof createSocialWeeklyDraftFunction>
const handlerOf = (fn: Fn) =>
  (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
const fakeStep = () => ({
  run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()),
})

function makeLoopDeps(): WeeklyLoopDeps {
  return {
    loadClient: vi.fn(async () => ({ id: 'c1', name: 'n', industry: null, config: { weekly_loop: { enabled: true } } })),
    loadOrders: vi.fn(async () => ({ rows: [], truncated: false })),
    loadFactSource: vi.fn(async () => ({ ok: true as const, catalogVersion: 1, tours: [], aliasesByTourId: {} })),
    writeFactCheck: vi.fn(async () => 'written' as const),
    writeSchedule: vi.fn(async () => ({ ok: true as const, dryRun: true, written: [], skipped: [] })),
  }
}

function makeDeps(
  env: Record<string, string | undefined>,
  over: Partial<SocialWeeklyDraftDeps> = {},
): SocialWeeklyDraftDeps {
  return {
    env: () => env,
    now: () => new Date('2026-11-05T00:00:00Z'),
    listClients: vi.fn(async () => [
      { id: 'c1', config: { weekly_loop: { enabled: true } } },
      { id: 'c2', config: { weekly_loop: { enabled: true }, weekly_pack: { draft_weekday: 2 } } },
      { id: 'c3', config: { weekly_loop: { enabled: false } } },
    ]),
    loadClientConfig: vi.fn(async () => ({ weekly_loop: { enabled: true } })),
    loopDeps: () => makeLoopDeps(),
    startRun: vi.fn(async () => 'run-1'),
    finishRun: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    loadMaliangSpend: vi.fn(async () => 0),
    reviewVideo: vi.fn(async () => { throw new Error('reviewVideo not expected in this test') }),
    supabaseUrl: () => 'https://abc.supabase.co',
    reviewReady: () => true,
    reserveMaliangSpend: vi.fn(async () => undefined),
    ...over,
  }
}

const dueEvent = (mode: string) => ({
  name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
  data: { clientId: 'c1', mode },
})

type FinishArg = { failed: number; error?: string; summary: Record<string, unknown> }
const finishArg = (deps: SocialWeeklyDraftDeps): FinishArg =>
  (deps.finishRun as unknown as { mock: { calls: [FinishArg][] } }).mock.calls[0][0]

type Receipt = {
  mode: string
  mode_forced: boolean
  status: string
  error: string | null
  failures: string[]
  manual_tasks?: { code: string }[]
  manual_tasks_delivered?: boolean
  trigger: string
  event_id: string | null
  triggered_at: string
}

describe('social-weekly-draft review fixes', () => {
  it('🔴 ENABLED off + WRITE on + client on + manual write → dry_run forced, nothing written', async () => {
    const loop = makeLoopDeps()
    const deps = makeDeps({ SOCIAL_WEEKLY_LOOP_WRITE: 'true' }, { loopDeps: () => loop })
    const fn = createSocialWeeklyDraftFunction(deps)
    const out = (await handlerOf(fn)({ event: dueEvent('write'), step: fakeStep() })) as Receipt
    expect(out.mode).toBe('dry_run')
    expect(out.mode_forced).toBe(true)
    expect(loop.writeFactCheck).not.toHaveBeenCalled()
    const writeCalls = (loop.writeSchedule as unknown as { mock: { calls: [{ dryRun?: boolean }][] } }).mock.calls
    expect(writeCalls.some((c) => c[0].dryRun === false)).toBe(false)
    expect(resolveMode('write', { SOCIAL_WEEKLY_LOOP_WRITE: 'true' }, true)).toEqual({ mode: 'dry_run', forced: true })
    expect(
      resolveMode('write', { SOCIAL_WEEKLY_LOOP_ENABLED: 'true', SOCIAL_WEEKLY_LOOP_WRITE: 'true' }, true),
    ).toEqual({ mode: 'write', forced: false })
  })

  it('🔴 manual dry_run still runs with ENABLED off', async () => {
    const deps = makeDeps({})
    const fn = createSocialWeeklyDraftFunction(deps)
    const out = (await handlerOf(fn)({ event: dueEvent('dry_run'), step: fakeStep() })) as Receipt
    expect(out.status).toBe('completed')
    expect(out.mode).toBe('dry_run')
    expect(out.mode_forced).toBe(false)
  })

  it('🔴 a truncated read is recorded as a failure in the run log', async () => {
    const env = { SOCIAL_WEEKLY_LOOP_ENABLED: 'true', SOCIAL_WEEKLY_LOOP_WRITE: 'true' }
    const loop = makeLoopDeps()
    vi.mocked(loop.loadOrders).mockResolvedValue({ rows: [], truncated: true })
    const deps = makeDeps(env, { loopDeps: () => loop })
    const fn = createSocialWeeklyDraftFunction(deps)
    const out = (await handlerOf(fn)({ event: dueEvent('write'), step: fakeStep() })) as Receipt
    expect(finishArg(deps).failed).toBeGreaterThan(0)
    expect(finishArg(deps).error).toContain('orders_truncated')
    expect(out.failures).toContain('orders_truncated')
    expect(out.mode).toBe('write')
    const codes = (out.manual_tasks ?? []).map((t) => t.code)
    expect(codes).toContain('run_incomplete')
  })

  it('🔴 a thrown loop in write mode fails loudly with a run_incomplete task', async () => {
    const env = { SOCIAL_WEEKLY_LOOP_ENABLED: 'true', SOCIAL_WEEKLY_LOOP_WRITE: 'true' }
    const loop = makeLoopDeps()
    vi.mocked(loop.loadClient).mockRejectedValue(new Error('db down'))
    const deps = makeDeps(env, { loopDeps: () => loop })
    const fn = createSocialWeeklyDraftFunction(deps)
    const out = (await handlerOf(fn)({ event: dueEvent('write'), step: fakeStep() })) as Receipt
    expect(out.status).toBe('failed')
    expect(out.error).toBe('db down')
    expect(out.manual_tasks_delivered).toBe(true)
    expect((out.manual_tasks ?? []).map((t) => t.code)).toEqual(['run_incomplete'])
    expect(finishArg(deps).failed).toBe(1)
    expect(finishArg(deps).error).toContain('db down')
  })

  it('a clean run logs zero failures', async () => {
    const deps = makeDeps({})
    const fn = createSocialWeeklyDraftFunction(deps)
    const out = (await handlerOf(fn)({ event: dueEvent('dry_run'), step: fakeStep() })) as Receipt
    expect(finishArg(deps).failed).toBe(0)
    expect(finishArg(deps).error).toBeUndefined()
    expect(out.failures).toEqual([])
  })

  it('receipt carries trigger, event id and triggered_at', async () => {
    const cronDeps = makeDeps({})
    const cronFn = createSocialWeeklyDraftFunction(cronDeps)
    const cronOut = (await handlerOf(cronFn)({
      event: {
        id: 'evt-1',
        ts: Date.parse('2026-11-05T01:02:03Z'),
        name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
        data: { clientId: 'c1', mode: 'dry_run', source: 'cron' },
      },
      step: fakeStep(),
    })) as Receipt
    expect(cronOut.trigger).toBe('cron')
    expect(cronOut.event_id).toBe('evt-1')
    expect(cronOut.triggered_at).toBe('2026-11-05T01:02:03.000Z')

    const manualDeps = makeDeps({})
    const manualFn = createSocialWeeklyDraftFunction(manualDeps)
    const manualOut = (await handlerOf(manualFn)({
      event: dueEvent('dry_run'),
      step: fakeStep(),
    })) as Receipt
    expect(manualOut.trigger).toBe('manual_event')
    expect(manualOut.event_id).toBeNull()
    expect(manualOut.triggered_at).toBe('2026-11-05T00:00:00.000Z')
  })
})
