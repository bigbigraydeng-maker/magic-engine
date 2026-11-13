/**
 * Week-plan confirmation card after a successful write-mode weekly draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SOCIAL_WEEKLY_DRAFT_DUE_EVENT, type SocialWeeklyDraftDeps } from '../cloud-social-weekly-draft'
import type { WeeklyLoopDeps } from '@/lib/social/weekly-loop/run'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
const imageStep = vi.hoisted(() => ({ run: vi.fn(async () => ({ attempted: 0, drafted: 0, planIds: [], skipped: null, error: null })) }))
vi.mock('@/lib/social/image-post-step', () => ({ runImagePostStep: imageStep.run }))
vi.mock('@/lib/ai/openai-client', () => ({ getOpenAIClient: () => ({ chat: { completions: { create: vi.fn() } } }) }))

const weekPlanAfter = vi.hoisted(() => ({
  ensure: vi.fn(async () => ({ status: 'ok' as const, cardRunId: 'c1' })),
}))
vi.mock('@/lib/social/weekly-plan/after-draft', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/social/weekly-plan/after-draft')>()
  return {
    ...orig,
    ensureWeekPlanApprovalAfterDraft: weekPlanAfter.ensure,
  }
})

const loopRun = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/lib/social/weekly-loop/run', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/social/weekly-loop/run')>()
  return { ...orig, runWeeklyLoop: loopRun.run }
})

type DraftFn = ReturnType<Awaited<ReturnType<typeof loadCreateDraft>>>
async function loadCreateDraft() {
  const { createSocialWeeklyDraftFunction } = await import('../cloud-social-weekly-draft')
  return createSocialWeeklyDraftFunction
}

const handlerOf = (fn: DraftFn) =>
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
    writeSchedule: vi.fn(async () => ({ ok: true as const, dryRun: false, written: [], skipped: [] })),
  }
}

function makeDeps(
  env: Record<string, string | undefined>,
  over: Partial<SocialWeeklyDraftDeps> = {},
): SocialWeeklyDraftDeps {
  return {
    env: () => env,
    now: () => new Date('2026-11-05T00:00:00Z'),
    listClients: vi.fn(async () => []),
    loadClientConfig: vi.fn(async () => ({ weekly_loop: { enabled: true } })),
    loopDeps: () => makeLoopDeps(),
    startRun: vi.fn(async () => 'run-1'),
    finishRun: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    loadMaliangSpend: vi.fn(async () => 0),
    reviewVideo: vi.fn(async () => { throw new Error('n/a') }),
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

const completedLoop = {
  kind: 'weekly_loop',
  client_id: 'c1',
  mode: 'write',
  status: 'completed',
  no_publish: true,
  counts: { candidates: 1, scheduled: 1 },
  manual_tasks: [],
  manual_tasks_delivered: true,
} as const

describe('social-weekly-draft week-plan card hook', () => {
  const writeEnv = { SOCIAL_WEEKLY_LOOP_ENABLED: 'true', SOCIAL_WEEKLY_LOOP_WRITE: 'true' }

  const dryRunPreview = {
    kind: 'weekly_loop',
    client_id: 'c1',
    mode: 'dry_run',
    status: 'completed',
    no_publish: true,
    counts: { candidates: 0, scheduled: 0 },
    manual_tasks: [],
    manual_tasks_delivered: false,
    items: [],
  } as const

  beforeEach(() => {
    loopRun.run.mockImplementation(async (_deps, input) =>
      input.mode === 'dry_run' ? dryRunPreview : completedLoop,
    )
  })

  it('calls ensure after a successful write run', async () => {
    weekPlanAfter.ensure.mockClear()
    const createSocialWeeklyDraftFunction = await loadCreateDraft()
    const deps = makeDeps(writeEnv)
    const fn = createSocialWeeklyDraftFunction(deps)
    await handlerOf(fn)({ event: dueEvent('write'), step: fakeStep() })
    expect(weekPlanAfter.ensure).toHaveBeenCalledTimes(1)
    const call = (deps.finishRun as unknown as { mock: { calls: [{ summary: { weekPlanApproval: { status: string } } }][] } }).mock
      .calls[0][0]
    expect(call.summary.weekPlanApproval?.status).toBe('ok')
  })

  it('does not open a card on dry_run or when ensure errors', async () => {
    weekPlanAfter.ensure.mockClear()
    loopRun.run.mockImplementation(async () => ({
      ...completedLoop,
      mode: 'dry_run',
      manual_tasks_delivered: false,
    }))
    const createSocialWeeklyDraftFunction = await loadCreateDraft()
    const depsDry = makeDeps({})
    await handlerOf(createSocialWeeklyDraftFunction(depsDry))({ event: dueEvent('dry_run'), step: fakeStep() })
    expect(weekPlanAfter.ensure).not.toHaveBeenCalled()

    weekPlanAfter.ensure.mockResolvedValueOnce({ status: 'error', reason: 'issue_boom' })
    loopRun.run.mockImplementation(async (_deps, input) =>
      input.mode === 'dry_run' ? dryRunPreview : completedLoop,
    )
    const deps = makeDeps(writeEnv)
    const out = (await handlerOf(createSocialWeeklyDraftFunction(deps))({
      event: dueEvent('write'),
      step: fakeStep(),
    })) as { status: string }
    expect(out.status).toBe('completed')
    expect(deps.finishRun).toHaveBeenCalled()
    const call = (deps.finishRun as unknown as { mock: { calls: [{ summary: { weekPlanApproval: { status: string } } }][] } }).mock
      .calls[0][0]
    expect(call.summary.weekPlanApproval?.status).toBe('error')
  })

  it('does not open a card when the loop failed', async () => {
    weekPlanAfter.ensure.mockClear()
    loopRun.run.mockImplementation(async (_deps, input) =>
      input.mode === 'dry_run'
        ? dryRunPreview
        : { ...completedLoop, status: 'failed', counts: { candidates: 0, scheduled: 0 } },
    )
    const createSocialWeeklyDraftFunction = await loadCreateDraft()
    const deps = makeDeps(writeEnv)
    await handlerOf(createSocialWeeklyDraftFunction(deps))({ event: dueEvent('write'), step: fakeStep() })
    expect(weekPlanAfter.ensure).not.toHaveBeenCalled()
  })
})
