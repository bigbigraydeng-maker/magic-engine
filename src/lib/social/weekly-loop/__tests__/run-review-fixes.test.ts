import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FactCheckInput, FactCheckResult } from '../fact-check'
import type { VersionRow } from '../version-groups'
import { groupVersions } from '../version-groups'
import { runWeeklyLoop, incompleteReasons, type WeeklyLoopDeps, type WeeklyLoopOrderRow } from '../run'
import type { WriteReelScheduleArgs, WriteReelScheduleResult } from '../schedule-writer'

vi.mock('../fact-check', () => ({
  checkFacts: vi.fn((input: FactCheckInput): FactCheckResult => {
    const overlay = input.texts.overlay ?? ''
    const verdict = overlay.includes('FAIL') ? 'fail' : overlay.includes('HUMAN') ? 'needs_human' : 'pass'
    return { verdict, targetTourId: null, catalogVersion: input.catalogVersion, items: [] }
  }),
}))

vi.mock('../version-groups', () => ({
  groupVersions: vi.fn((rows: readonly VersionRow[]) => ({
    groups: rows.map((r) => ({ latestId: r.id, memberIds: [r.id] })),
    ambiguous: [],
  })),
}))

const NOW = new Date('2026-11-05T00:00:00Z')

const maliangPass = { status: 'pass', reasons: [], questions: [] }

function row(id: string, over: Partial<WeeklyLoopOrderRow> = {}): WeeklyLoopOrderRow {
  return {
    id,
    status: 'approved',
    created_at: `2026-11-0${id.slice(1)}T00:00:00Z`,
    updated_at: `2026-11-04T00:00:0${id.slice(1)}Z`,
    angle: `Title ${id}`,
    brief: { copy: { caption: `post ${id}` } },
    output: { caption: `overlay ${id}`, maliang_check: { status: 'pass', reasons: [], questions: [] } },
    review_ref: { approved_at: '2026-11-01T00:00:00Z' },
    published_ref: { video_state: 'DRAFT' },
    ...over,
  }
}

function makeDeps(rows: WeeklyLoopOrderRow[], opts: { factOk?: boolean } = {}): WeeklyLoopDeps {
  return {
    loadClient: vi.fn(async () => ({
      id: 'c1',
      name: 'Client One',
      industry: null,
      config: { quota: { reel_per_week: 3 } },
    })),
    loadOrders: vi.fn(async () => ({ rows, truncated: false })),
    loadFactSource: vi.fn(async () =>
      opts.factOk === false
        ? { ok: false as const, reason: 'catalog_empty' }
        : { ok: true as const, catalogVersion: 7, tours: [], aliasesByTourId: {} },
    ),
    writeFactCheck: vi.fn(async () => 'written' as const),
    writeSchedule: vi.fn(
      async (args: WriteReelScheduleArgs): Promise<WriteReelScheduleResult> => ({
        ok: true,
        dryRun: args.dryRun,
        written: args.assignments,
        skipped: [],
      }),
    ),
  }
}

beforeEach(() => {
  vi.mocked(groupVersions).mockClear()
})

describe('runWeeklyLoop review fixes', () => {
  it('🔴 write mode: a conflict on the fact_check write keeps that reel out of the schedule', async () => {
    const deps = makeDeps([row('w1'), row('w2')])
    deps.writeFactCheck = vi.fn(async (input: { id: string }) =>
      input.id === 'w2' ? ('conflict' as const) : ('written' as const),
    )

    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls).toHaveLength(1)
    expect(scheduleCalls[0][0].assignments.map((a) => a.id)).toEqual(['w1'])

    expect(receipt.counts.skipped_by_reason.fact_check_not_persisted).toBe(1)
    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w2')?.excluded_reason).toBe('fact_check_not_persisted')

    expect(receipt.fact_check_writes).toEqual({ written: 1, conflict: 1, failed: 0 })
    expect(receipt.manual_tasks.map((t) => t.code)).not.toContain('run_incomplete')
  })

  it('🔴 write mode: a failed fact_check write is not scheduled and surfaces run_incomplete', async () => {
    const deps = makeDeps([row('w1'), row('w2')])
    deps.writeFactCheck = vi.fn(async (input: { id: string }) =>
      input.id === 'w2' ? ('failed' as const) : ('written' as const),
    )

    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls).toHaveLength(1)
    expect(scheduleCalls[0][0].assignments.map((a) => a.id)).toEqual(['w1'])

    expect(receipt.fact_check_writes.failed).toBe(1)

    const last = receipt.manual_tasks[receipt.manual_tasks.length - 1]
    expect(last.code).toBe('run_incomplete')
    expect(last.what).toContain('本周排期没跑完整')
    expect(last.what).toContain('fact_check_write_failed:1')
  })

  it('dry_run never filters on persistence', async () => {
    const deps = makeDeps([row('w1'), row('w2')])

    await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    expect(deps.writeFactCheck).not.toHaveBeenCalled()
    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls).toHaveLength(1)
    expect(scheduleCalls[0][0].assignments.map((a) => a.id).sort()).toEqual(['w1', 'w2'])
  })

  it('🔴 truncated read is an error and a run_incomplete task', async () => {
    const deps = makeDeps([row('w1')])
    vi.mocked(deps.loadOrders).mockResolvedValueOnce({ rows: [row('w1')], truncated: true })

    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    expect(receipt.truncated).toBe(true)
    expect(receipt.errors).toContain('orders_truncated')
    expect(receipt.manual_tasks.map((t) => t.code)).toContain('run_incomplete')
  })

  it('schedule writer error-type skips surface run_incomplete', async () => {
    const deps = makeDeps([row('w1')])
    vi.mocked(deps.writeSchedule).mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      written: [],
      skipped: [{ id: 'w1', reason: 'write_failed' }],
    })

    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    const task = receipt.manual_tasks.find((t) => t.code === 'run_incomplete')
    expect(task).toBeDefined()
    expect(task?.what).toContain('schedule_skip_write_failed:1')
  })

  it('card_check_failed from the schedule writer is an error', async () => {
    const deps = makeDeps([row('w1')])
    vi.mocked(deps.writeSchedule).mockResolvedValueOnce({ ok: false, reason: 'card_check_failed' })

    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    expect(receipt.errors).toContain('schedule_card_check_failed')
    expect(receipt.manual_tasks.map((t) => t.code)).toContain('run_incomplete')
  })

  it('a clean write run has no run_incomplete task', async () => {
    const deps = makeDeps([row('w1'), row('w2')])

    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    expect(receipt.errors).toEqual([])
    expect(receipt.manual_tasks.map((t) => t.code)).not.toContain('run_incomplete')
  })

  it('🔴 maliang unverifiable is excluded as maliang_fail and never scheduled', async () => {
    const deps = makeDeps([
      row('w1'),
      row('w2', {
        output: {
          caption: 'overlay w2',
          maliang_check: { status: 'unverifiable', reasons: [], questions: ['cannot see logo'] },
        },
      }),
    ])

    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w2')?.excluded_reason).toBe('maliang_fail')
    expect(byId.get('w2')?.questions).toEqual(['cannot see logo'])
    expect(receipt.counts.maliang_fail).toBe(1)

    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls).toHaveLength(1)
    expect(scheduleCalls[0][0].assignments.map((a) => a.id)).toEqual(['w1'])
  })

  it('incompleteReasons unit cases', () => {
    expect(incompleteReasons({})).toEqual([])

    expect(
      incompleteReasons({
        errors: ['e1'],
        fact_check_writes: { failed: 2 },
        counts: {
          skipped_by_reason: { write_failed: 1, over_quota: 3, promote_check_failed: 2 },
        },
      }),
    ).toEqual([
      'e1',
      'fact_check_write_failed:2',
      'schedule_skip_promote_check_failed:2',
      'schedule_skip_write_failed:1',
    ])
  })
})
