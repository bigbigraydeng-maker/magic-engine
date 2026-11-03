import { describe, expect, it, vi } from 'vitest'
import type { FactCheckInput, FactCheckResult } from '@/lib/social/weekly-loop/fact-check'
import type { VersionRow } from '@/lib/social/weekly-loop/version-groups'
import {
  createSocialWeeklyDraftFunction,
  SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
  type ClientRunReceipt,
  type SocialWeeklyDraftDeps,
} from '../cloud-social-weekly-draft'
import type { WeeklyLoopDeps, WeeklyLoopOrderRow } from '@/lib/social/weekly-loop/run'
import type { MaliangCheck } from '@/lib/maliang/render-check'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/social/weekly-loop/fact-check', () => ({
  checkFacts: vi.fn((input: FactCheckInput): FactCheckResult => {
    const overlay = input.texts.overlay ?? ''
    return { verdict: overlay.includes('FAIL') ? 'fail' : 'pass', targetTourId: null, catalogVersion: input.catalogVersion, items: [] }
  }),
}))
vi.mock('@/lib/social/weekly-loop/version-groups', () => ({
  groupVersions: vi.fn((rows: readonly VersionRow[]) => ({
    groups: rows.map((r) => ({ latestId: r.id, memberIds: [r.id] })),
    ambiguous: [],
  })),
}))

const NOW = new Date('2026-11-05T00:00:00Z')
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const PASS: MaliangCheck = {
  status: 'pass',
  checked_at: '2026-11-05T00:00:00.000Z',
  video_url: 'v',
  reasons: [],
  frames: [],
  model: 'm',
}

const WRITE_ENV = { SOCIAL_WEEKLY_LOOP_ENABLED: 'true', SOCIAL_WEEKLY_LOOP_WRITE: 'true' }

function row(id: string, over: Partial<WeeklyLoopOrderRow> = {}): WeeklyLoopOrderRow {
  return {
    id,
    status: 'approved',
    created_at: `2026-11-0${id.slice(1)}T00:00:00Z`,
    updated_at: `upd-${id}`,
    angle: `Title ${id}`,
    brief: { copy: { caption: `post ${id}` } },
    output: { caption: `overlay ${id}`, video_path: `cts/${id}.mp4` },
    review_ref: { approved_at: '2026-11-01T00:00:00Z' },
    published_ref: { video_state: 'DRAFT' },
    ...over,
  }
}

function rows(): WeeklyLoopOrderRow[] {
  return [
    row('w1'),
    row('w2', {
      output: {
        caption: 'overlay w2',
        video_path: 'cts/w2.mp4',
        maliang_check: { status: 'pass', reasons: [], questions: [] },
      },
    }),
    row('w3', { output: { caption: 'overlay FAIL', video_path: 'cts/w3.mp4' } }),
  ]
}

function makeLoopDeps(writeImpl?: WeeklyLoopDeps['writeFactCheck']): WeeklyLoopDeps {
  return {
    loadClient: vi.fn(async () => ({
      id: 'c1',
      name: 'Client One',
      industry: null,
      config: { weekly_loop: { enabled: true }, quota: { reel_per_week: 3 } },
    })),
    loadOrders: vi.fn(async () => ({ rows: rows(), truncated: false })),
    loadFactSource: vi.fn(async () => ({ ok: true as const, catalogVersion: 7, tours: [], aliasesByTourId: {} })),
    writeFactCheck: vi.fn(writeImpl ?? (async () => 'written' as const)),
    writeSchedule: vi.fn(async (args) => ({ ok: true as const, dryRun: args.dryRun, written: args.assignments, skipped: [] })),
  }
}

function makeDeps(
  env: Record<string, string | undefined>,
  loop: WeeklyLoopDeps,
  over: Partial<SocialWeeklyDraftDeps> = {},
): SocialWeeklyDraftDeps {
  return {
    env: () => env,
    now: () => NOW,
    listClients: vi.fn(async () => []),
    loadClientConfig: vi.fn(async () => ({ weekly_loop: { enabled: true } })),
    loopDeps: () => loop,
    startRun: vi.fn(async () => 'run-1'),
    finishRun: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    loadMaliangSpend: vi.fn(async () => 0),
    reviewVideo: vi.fn(async () => PASS),
    supabaseUrl: () => 'https://abc.supabase.co',
    ...over,
  }
}

const fakeStep = () => ({
  run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()),
})

const handlerOf = (fn: ReturnType<typeof createSocialWeeklyDraftFunction>) =>
  Reflect.get(fn, 'fn') as (args: unknown) => Promise<unknown>

const due = (data: Record<string, unknown>) => ({
  name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
  data: { clientId: 'c1', ...data },
})

async function run(deps: SocialWeeklyDraftDeps, event: unknown): Promise<ClientRunReceipt> {
  const fn = createSocialWeeklyDraftFunction(deps)
  return (await handlerOf(fn)({ event, step: fakeStep() })) as ClientRunReceipt
}

function maliangWrites(loop: WeeklyLoopDeps) {
  return vi
    .mocked(loop.writeFactCheck)
    .mock.calls.map(([a]) => a)
    .filter((a) => !('fact_check' in a.output))
}

describe('social-weekly-draft · 马良 backfill', () => {
  it('write mode reviews only the unreviewed fact-passing reel and stamps the verdict with an updated_at guard', async () => {
    const loop = makeLoopDeps()
    const deps = makeDeps(WRITE_ENV, loop)
    const receipt = await run(deps, due({ mode: 'write' }))

    expect(deps.reviewVideo).toHaveBeenCalledTimes(1)
    const target = vi.mocked(deps.reviewVideo).mock.calls[0][0]
    expect(target.id).toBe('w1')
    expect(target.videoUrl).toContain('content-factory/cts/w1.mp4')

    const writes = maliangWrites(loop)
    expect(writes).toHaveLength(1)
    const write = writes[0]
    expect(write.id).toBe('w1')
    expect(write.readUpdatedAt).toBe('upd-w1')
    const output = write.output as Record<string, unknown>
    expect((output.maliang_check as { status: string }).status).toBe('pass')
    expect(output.machine_reviewed).toBe(true)
    expect(output.caption).toBe('overlay w1')

    expect(receipt.maliang_backfill).toMatchObject({
      enabled: true,
      off_reason: null,
      targets: 1,
      spent_usd: 0.05,
      reviewed: [{ id: 'w1', status: 'pass', persisted: 'written' }],
    })

    expect(deps.loadMaliangSpend).toHaveBeenCalledTimes(1)
    const [spendClientId, spendSince] = vi.mocked(deps.loadMaliangSpend).mock.calls[0]
    expect(spendClientId).toBe('c1')
    expect(spendSince.getTime()).toBe(NOW.getTime() - WEEK_MS)
  })

  it('cron-style dry run reports the target but spends nothing', async () => {
    const loop = makeLoopDeps()
    const deps = makeDeps({}, loop)
    const receipt = await run(deps, due({ mode: 'dry_run' }))

    expect(deps.reviewVideo).not.toHaveBeenCalled()
    expect(maliangWrites(loop)).toHaveLength(0)
    expect(loop.writeFactCheck).not.toHaveBeenCalled()
    expect(receipt.maliang_backfill).toMatchObject({
      enabled: false,
      off_reason: 'dry_run_without_maliang_review',
      targets: 1,
      spent_usd: 0,
      reviewed: [],
    })
  })

  it('manual dry run with maliang_review: true reviews, writes nothing, and the card sees the verdict in memory', async () => {
    const loop = makeLoopDeps()
    const deps = makeDeps({}, loop)
    const receipt = await run(deps, due({ mode: 'dry_run', maliang_review: true }))

    expect(deps.reviewVideo).toHaveBeenCalledTimes(1)
    expect(loop.writeFactCheck).not.toHaveBeenCalled()
    expect(receipt.maliang_backfill?.reviewed).toEqual([{ id: 'w1', status: 'pass', persisted: 'not_written' }])

    const item = (receipt.items ?? []).find((i) => i.id === 'w1')
    expect(item).toBeDefined()
    expect(item?.maliang).toBe('pass')
    expect(item?.excluded_reason ?? null).toBeNull()
  })

  it('unreadable budget means no review and a reported failure', async () => {
    const loop = makeLoopDeps()
    const deps = makeDeps(WRITE_ENV, loop, {
      loadMaliangSpend: vi.fn(async () => {
        throw new Error('db down')
      }),
    })
    const receipt = await run(deps, due({ mode: 'write' }))

    expect(deps.reviewVideo).not.toHaveBeenCalled()
    expect(receipt.maliang_backfill?.off_reason).toBe('spend_unreadable')
    expect(receipt.failures).toContain('maliang_spend_unreadable')

    const finishCalls = vi.mocked(deps.finishRun).mock.calls
    expect(finishCalls.length).toBeGreaterThanOrEqual(1)
    expect(finishCalls[0][0].failed).toBeGreaterThanOrEqual(1)
  })

  it('budget already used up: nothing reviewed, skip counted', async () => {
    const loop = makeLoopDeps()
    const deps = makeDeps(WRITE_ENV, loop, { loadMaliangSpend: vi.fn(async () => 0.5) })
    const receipt = await run(deps, due({ mode: 'write' }))

    expect(deps.reviewVideo).not.toHaveBeenCalled()
    expect(receipt.maliang_backfill?.targets).toBe(0)
    expect(receipt.maliang_backfill?.skipped).toEqual({ budget: 1 })
  })

  it('a lost race is a conflict (not a failure); a thrown write is a failure', async () => {
    const conflictImpl = async (a: Parameters<WeeklyLoopDeps['writeFactCheck']>[0]) =>
      'fact_check' in a.output ? ('written' as const) : ('conflict' as const)
    const conflictLoop = makeLoopDeps(conflictImpl)
    const conflictDeps = makeDeps(WRITE_ENV, conflictLoop)
    const conflictReceipt = await run(conflictDeps, due({ mode: 'write' }))

    expect(conflictReceipt.maliang_backfill?.reviewed[0].persisted).toBe('conflict')
    expect(conflictReceipt.failures.some((f) => f.startsWith('maliang_write_failed'))).toBe(false)

    const throwImpl = async (a: Parameters<WeeklyLoopDeps['writeFactCheck']>[0]) => {
      if ('fact_check' in a.output) return 'written' as const
      throw new Error('boom')
    }
    const throwLoop = makeLoopDeps(throwImpl)
    const throwDeps = makeDeps(WRITE_ENV, throwLoop)
    const throwReceipt = await run(throwDeps, due({ mode: 'write' }))

    expect(throwReceipt.maliang_backfill?.reviewed[0].persisted).toBe('failed')
    expect(throwReceipt.failures).toContain('maliang_write_failed:1')
  })

  it('a failed plan read does not take the run down', async () => {
    const loop = makeLoopDeps()
    loop.loadOrders = vi
      .fn()
      .mockRejectedValueOnce(new Error('read down'))
      .mockResolvedValue({ rows: rows(), truncated: false })
    const deps = makeDeps(WRITE_ENV, loop)
    const receipt = await run(deps, due({ mode: 'write' }))

    expect(deps.reviewVideo).not.toHaveBeenCalled()
    expect(receipt.maliang_backfill?.off_reason?.startsWith('plan_failed')).toBe(true)
    expect(receipt.failures.some((f) => f.startsWith('maliang_plan_failed'))).toBe(true)
    expect(deps.finishRun).toHaveBeenCalledTimes(1)
  })
})
