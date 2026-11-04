import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FactCheckInput, FactCheckResult } from '../fact-check'
import type { VersionRow } from '../version-groups'
import { groupVersions } from '../version-groups'
import { runWeeklyLoop, type WeeklyLoopDeps, type WeeklyLoopOrderRow } from '../run'
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

describe('runWeeklyLoop', () => {
  it('dry_run writes nothing', async () => {
    const deps = makeDeps([row('w1'), row('w2')])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    expect(deps.writeFactCheck).not.toHaveBeenCalled()
    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls.length).toBeGreaterThan(0)
    for (const [args] of scheduleCalls) {
      expect(args.dryRun).toBe(true)
    }
    expect(receipt.mode).toBe('dry_run')
    expect(receipt.manual_tasks_delivered).toBe(false)
    expect(receipt.fact_check_writes).toEqual({ written: 0, conflict: 0, failed: 0 })
    expect(receipt.no_publish).toBe(true)
  })

  it('write mode writes fact checks for every checked row, then schedules', async () => {
    const deps = makeDeps([
      row('w1'),
      row('w2', { output: { caption: 'overlay FAIL', maliang_check: { status: 'pass', reasons: [], questions: [] } } }),
      row('w3', { output: { caption: 'overlay HUMAN', maliang_check: { status: 'pass', reasons: [], questions: [] } } }),
    ])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    const factCalls = vi.mocked(deps.writeFactCheck).mock.calls
    expect(factCalls).toHaveLength(3)

    const verdictById = new Map<string, string>()
    for (const [arg] of factCalls) {
      const fc = arg.output.fact_check as { catalog_version: number; verdict: string }
      expect(fc.catalog_version).toBe(7)
      expect(arg.output.maliang_check).toBeDefined()
      verdictById.set(arg.id, fc.verdict)
    }
    expect(verdictById.get('w1')).toBe('pass')
    expect(verdictById.get('w2')).toBe('fail')
    expect(verdictById.get('w3')).toBe('needs_human')

    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls).toHaveLength(1)
    const [scheduleArgs] = scheduleCalls[0]
    expect(scheduleArgs.dryRun).toBe(false)
    expect(scheduleArgs.assignments.map((a) => a.id)).toEqual(['w1'])

    const factOrder = vi.mocked(deps.writeFactCheck).mock.invocationCallOrder[0]
    const scheduleOrder = vi.mocked(deps.writeSchedule).mock.invocationCallOrder[0]
    expect(factOrder).toBeLessThan(scheduleOrder)

    expect(receipt.manual_tasks_delivered).toBe(true)
    expect(receipt.fact_check_writes.written).toBe(3)
  })

  it('stops when the fact source is unreadable, even in write mode', async () => {
    const deps = makeDeps([row('w1'), row('w2')], { factOk: false })
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    expect(receipt.status).toBe('stopped')
    expect(receipt.stop_reason).toBe('fact_source_unreadable:catalog_empty')
    expect(deps.writeSchedule).not.toHaveBeenCalled()
    expect(deps.writeFactCheck).not.toHaveBeenCalled()
    expect(receipt.scheduled).toEqual([])
    expect(receipt.manual_tasks.map((t) => t.code)).toEqual(['fact_source_unreadable'])
    expect(receipt.manual_tasks[0].href).toContain('/dashboard/clients/c1/tour-catalog')
  })

  it('excludes unreviewed and maliang-fail rows and carries questions', async () => {
    const deps = makeDeps([
      row('w1', { output: { caption: 'overlay w1' } }),
      row('w2', { output: { caption: 'overlay w2', maliang_check: { status: 'fail', reasons: ['x'] } } }),
      row('w3', {
        output: { caption: 'overlay w3', maliang_check: { status: 'pass', reasons: [], questions: ['face at 0:03'] } },
      }),
    ])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w1')?.excluded_reason).toBe('unreviewed')
    expect(byId.get('w2')?.excluded_reason).toBe('maliang_fail')
    expect(byId.get('w3')?.excluded_reason).toBeNull()
    expect(byId.get('w3')?.questions).toEqual(['face at 0:03'])

    expect(receipt.counts.unreviewed).toBe(1)
    expect(receipt.counts.maliang_fail).toBe(1)

    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls).toHaveLength(1)
    expect(scheduleCalls[0][0].assignments.map((a) => a.id)).toEqual(['w3'])

    expect(receipt.manual_tasks.map((t) => t.code)).toContain('unreviewed_by_maliang')
  })

  it('reports ambiguous versions and does not schedule them', async () => {
    vi.mocked(groupVersions).mockReturnValueOnce({
      groups: [
        { latestId: 'w2', memberIds: ['w1', 'w2'] },
        { latestId: 'w3', memberIds: ['w3'] },
      ],
      ambiguous: [{ ids: ['w1', 'w2'], reason: 'conflicting_links' }],
    })
    const deps = makeDeps([row('w1'), row('w2'), row('w3')])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    expect(receipt.counts.ambiguous).toBe(2)
    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w1')?.excluded_reason).toBe('ambiguous_version')
    expect(byId.get('w2')?.excluded_reason).toBe('ambiguous_version')

    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls).toHaveLength(1)
    expect(scheduleCalls[0][0].assignments.map((a) => a.id)).toEqual(['w3'])
  })

  it('excludes superseded versions', async () => {
    vi.mocked(groupVersions).mockReturnValueOnce({
      groups: [{ latestId: 'w2', memberIds: ['w1', 'w2'] }],
      ambiguous: [],
    })
    const deps = makeDeps([row('w1'), row('w2')])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w1')?.excluded_reason).toBe('superseded')
    expect(receipt.counts.superseded).toBe(1)

    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls).toHaveLength(1)
    expect(scheduleCalls[0][0].assignments.map((a) => a.id)).toEqual(['w2'])
  })

  it('produces a zero_eligible manual task when there are no candidates', async () => {
    const deps = makeDeps([row('w1', { status: 'in_review' }), row('w2', { status: 'in_review' })])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    expect(receipt.counts.in_review).toBe(2)
    expect(receipt.counts.candidates).toBe(0)
    expect(deps.writeSchedule).not.toHaveBeenCalled()
    expect(receipt.manual_tasks.map((t) => t.code)).toEqual(['zero_eligible'])
    expect(receipt.manual_tasks[0].href).toContain('/dashboard/clients/c1/content-factory')
  })

  it('produces an all_filtered manual task when every candidate is filtered', async () => {
    const deps = makeDeps([
      row('w1', { output: { caption: 'overlay FAIL', maliang_check: { status: 'pass', reasons: [], questions: [] } } }),
      row('w2', { output: { caption: 'overlay FAIL', maliang_check: { status: 'pass', reasons: [], questions: [] } } }),
    ])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    expect(receipt.manual_tasks.map((t) => t.code)).toEqual(['all_filtered'])
    expect(receipt.manual_tasks[0].what).toContain('2')
  })

  it('computes receipt counts correctly', async () => {
    const deps = makeDeps([
      row('w1'),
      row('w2', { output: { caption: 'overlay FAIL', maliang_check: { status: 'pass', reasons: [], questions: [] } } }),
      row('w3', { output: { caption: 'overlay HUMAN', maliang_check: { status: 'pass', reasons: [], questions: [] } } }),
      row('w4', { status: 'in_review' }),
      row('w5', { brief: { copy: { caption: 'post w5' }, weekly_pack: { publish_on: '2026-11-11' } } }),
      row('w6'),
    ])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    expect(receipt.counts.orders_read).toBe(6)
    expect(receipt.counts.in_review).toBe(1)
    expect(receipt.counts.candidates).toBe(5)
    expect(receipt.counts.fact_pass).toBe(3)
    expect(receipt.counts.fact_fail).toBe(1)
    expect(receipt.counts.fact_needs_human).toBe(1)
    expect(receipt.counts.eligible).toBe(3)
    expect(receipt.counts.already_scheduled).toBe(1)
    expect(receipt.counts.scheduled).toBe(2)
    expect(receipt.counts.skipped_by_reason.fact_fail).toBe(1)
    expect(receipt.counts.skipped_by_reason.fact_needs_human).toBe(1)

    const scheduleCalls = vi.mocked(deps.writeSchedule).mock.calls
    expect(scheduleCalls).toHaveLength(1)
    const ids = scheduleCalls[0][0].assignments.map((a) => a.id).sort()
    expect(ids).toEqual(['w1', 'w6'])

    expect(receipt.reel_per_week).toBe(3)
    expect(receipt.week_start).toBe('2026-11-09')
    expect(receipt.week_end).toBe('2026-11-15')
    expect(receipt.catalog_version).toBe(7)
  })

  it('never writes review_ref or checklist_human', async () => {
    const deps = makeDeps([
      row('w1', {
        review_ref: { approved_at: '2026-11-01T00:00:00Z', checklist_human: [{ key: 'k', outcome: 'PASS' }] },
      }),
    ])
    await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })

    const factCalls = vi.mocked(deps.writeFactCheck).mock.calls
    expect(factCalls.length).toBeGreaterThan(0)
    for (const [arg] of factCalls) {
      expect(Object.keys(arg).sort()).toEqual(['clientId', 'id', 'output', 'readUpdatedAt'])
      expect(Object.keys(arg.output)).not.toContain('review_ref')
      expect(JSON.stringify(arg)).not.toContain('checklist_human')
      expect(arg.readUpdatedAt).toBe('2026-11-04T00:00:01Z')
    }
  })
})
