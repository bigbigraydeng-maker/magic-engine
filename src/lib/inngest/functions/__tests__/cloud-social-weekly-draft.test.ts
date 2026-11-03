/**
 * The daily fan-out and the per-client due handler: scheduling, the two switches,
 * mode resolution and the run log. The loop's own rules live in
 * `lib/social/weekly-loop/__tests__`; here `runWeeklyLoop` is exercised through
 * stub deps so only the wiring is on trial.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createSocialWeeklyDraftFunction,
  resolveMode,
  SOCIAL_WEEKLY_DRAFT_CRON,
  SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
  SOCIAL_WEEKLY_DRAFT_FUNCTION_ID,
  type SocialWeeklyDraftDeps,
} from '../cloud-social-weekly-draft'
import { CLOUD_FN_PREFIX } from '../../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { WEEKLY_LOOP_JOB, type WeeklyLoopDeps } from '@/lib/social/weekly-loop/run'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

type Fn = ReturnType<typeof createSocialWeeklyDraftFunction>
const optsOf = (fn: Fn) =>
  (
    fn as unknown as {
      opts: {
        id?: string
        triggers?: { cron?: string; event?: string }[]
        retries?: number
        concurrency?: { limit?: number; key?: string }
      }
    }
  ).opts
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
    ...over,
  }
}

const cronEvent = { name: 'inngest/scheduled.timer', data: {} }
const dueEvent = (mode: string) => ({
  name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
  data: { clientId: 'c1', mode },
})

describe('social-weekly-draft function', () => {
  it('🔴 is scheduled daily at 08:30 NZ, also listens for the due event, never retries, serialises per client', () => {
    const fn = createSocialWeeklyDraftFunction(makeDeps({}))
    const opts = optsOf(fn)
    expect(opts.id).toBe(`${CLOUD_FN_PREFIX}social-weekly-draft`)
    expect(opts.id).toBe(SOCIAL_WEEKLY_DRAFT_FUNCTION_ID)
    expect(opts.triggers?.[0]?.cron).toBe(SOCIAL_WEEKLY_DRAFT_CRON)
    expect(SOCIAL_WEEKLY_DRAFT_CRON).toBe('TZ=Pacific/Auckland 30 8 * * *')
    expect(opts.triggers?.[1]?.event).toBe('social/week_pack.draft_due')
    expect(opts.retries).toBe(0)
    expect(opts.concurrency?.key).toBe('event.data.clientId')
  })

  it('🔴 cron 登记表里有它：由 Inngest 调度、写运行记录，周期跟上面的常量是同一个（去掉 TZ 前缀）', () => {
    const entry = CRON_REGISTRY.find((e) => e.jobName === WEEKLY_LOOP_JOB)
    expect(entry).toMatchObject({
      scheduler: 'inngest',
      logsRuns: true,
      service: 'inngest:cloud-social-weekly-draft',
    })
    expect(entry?.schedule).toBe(SOCIAL_WEEKLY_DRAFT_CRON.replace(/^TZ=\S+\s+/, ''))
  })

  it('🔴 ENABLED switch off blocks the cron fan-out (no client list, no events, disabled receipt)', async () => {
    for (const env of [{}, { SOCIAL_WEEKLY_LOOP_ENABLED: 'yes' }]) {
      const deps = makeDeps(env)
      const fn = createSocialWeeklyDraftFunction(deps)
      const out = (await handlerOf(fn)({ event: cronEvent, step: fakeStep() })) as { status: string }
      expect(out.status).toBe('disabled')
      expect(deps.listClients).not.toHaveBeenCalled()
      expect(deps.send).not.toHaveBeenCalled()
      expect(deps.finishRun).toHaveBeenCalledTimes(1)
      const call = (deps.finishRun as unknown as { mock: { calls: [{ summary: { status: string } }][] } }).mock.calls[0][0]
      expect(call.summary.status).toBe('disabled')
    }
  })

  it('ENABLED on: dispatches one due event for the client whose draft day is today', async () => {
    const deps = makeDeps({ SOCIAL_WEEKLY_LOOP_ENABLED: 'true' })
    const fn = createSocialWeeklyDraftFunction(deps)
    await handlerOf(fn)({ event: cronEvent, step: fakeStep() })
    expect(deps.send).toHaveBeenCalledTimes(1)
    const sent = (deps.send as unknown as { mock: { calls: [unknown[]][] } }).mock.calls[0][0]
    expect(sent).toEqual([
      {
        id: 'social-weekly-draft:c1:2026-11-05',
        name: 'social/week_pack.draft_due',
        data: { clientId: 'c1', mode: 'dry_run', source: 'cron' },
      },
    ])
  })

  it('🔴 WRITE switch off forces dry_run even when the event asks for write', async () => {
    const loop = makeLoopDeps()
    const deps = makeDeps({ SOCIAL_WEEKLY_LOOP_ENABLED: 'true' }, { loopDeps: () => loop })
    const fn = createSocialWeeklyDraftFunction(deps)
    const out = (await handlerOf(fn)({ event: dueEvent('write'), step: fakeStep() })) as {
      mode: string
      mode_forced: boolean
    }
    expect(out.mode).toBe('dry_run')
    expect(out.mode_forced).toBe(true)
    expect(loop.writeFactCheck).not.toHaveBeenCalled()
    const writeCalls = (loop.writeSchedule as unknown as { mock: { calls: [{ dryRun?: boolean }][] } }).mock.calls
    expect(writeCalls.some((c) => c[0].dryRun === false)).toBe(false)
  })

  it('WRITE switch on + client enabled → write; client disabled → dry_run forced', async () => {
    const env = { SOCIAL_WEEKLY_LOOP_ENABLED: 'true', SOCIAL_WEEKLY_LOOP_WRITE: 'true' }
    const onDeps = makeDeps(env)
    const onFn = createSocialWeeklyDraftFunction(onDeps)
    const onOut = (await handlerOf(onFn)({ event: dueEvent('write'), step: fakeStep() })) as {
      mode: string
      mode_forced: boolean
    }
    expect(onOut.mode).toBe('write')
    expect(onOut.mode_forced).toBe(false)

    const offDeps = makeDeps(env, {
      loadClientConfig: vi.fn(async () => ({ weekly_loop: { enabled: false } })),
    })
    const offFn = createSocialWeeklyDraftFunction(offDeps)
    const offOut = (await handlerOf(offFn)({ event: dueEvent('write'), step: fakeStep() })) as {
      mode: string
      mode_forced: boolean
    }
    expect(offOut.mode).toBe('dry_run')
    expect(offOut.mode_forced).toBe(true)
  })

  it('🔴 manual dry_run runs while ENABLED is off', async () => {
    const loop = makeLoopDeps()
    const deps = makeDeps({}, { loopDeps: () => loop })
    const fn = createSocialWeeklyDraftFunction(deps)
    const out = (await handlerOf(fn)({ event: dueEvent('dry_run'), step: fakeStep() })) as {
      kind: string
      status: string
      mode: string
    }
    expect(out.kind).toBe('client_run')
    expect(out.status).toBe('completed')
    expect(out.mode).toBe('dry_run')
    // Once for the 马良 backfill plan (a read-only preview), once for the loop itself.
    expect(loop.loadOrders).toHaveBeenCalledTimes(2)
    expect(deps.reviewVideo).not.toHaveBeenCalled()
    expect(deps.finishRun).toHaveBeenCalledTimes(1)
  })

  it('due event without clientId fails loudly and logs an error', async () => {
    const deps = makeDeps({})
    const fn = createSocialWeeklyDraftFunction(deps)
    const out = (await handlerOf(fn)({
      event: { name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT, data: {} },
      step: fakeStep(),
    })) as { status: string }
    expect(out.status).toBe('failed')
    expect(deps.finishRun).toHaveBeenCalledTimes(1)
    const call = (deps.finishRun as unknown as { mock: { calls: [{ error?: string }][] } }).mock.calls[0][0]
    expect(typeof call.error).toBe('string')
  })

  it('resolveMode unit cases', () => {
    expect(resolveMode('write', { SOCIAL_WEEKLY_LOOP_ENABLED: 'true', SOCIAL_WEEKLY_LOOP_WRITE: 'true' }, true)).toEqual({ mode: 'write', forced: false })
    expect(resolveMode('write', { SOCIAL_WEEKLY_LOOP_WRITE: 'TRUE' }, true)).toEqual({ mode: 'dry_run', forced: true })
    expect(resolveMode('dry_run', { SOCIAL_WEEKLY_LOOP_WRITE: 'true' }, true)).toEqual({ mode: 'dry_run', forced: false })
    expect(resolveMode(undefined, {}, true)).toEqual({ mode: 'dry_run', forced: false })
  })
})
