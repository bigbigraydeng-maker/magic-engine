import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FactCheckInput, FactCheckResult } from '../fact-check'
import type { VersionRow } from '../version-groups'
import { groupVersions } from '../version-groups'
import { runWeeklyLoop, type WeeklyLoopDeps, type WeeklyLoopOrderRow } from '../run'
import type { WriteReelScheduleArgs, WriteReelScheduleResult } from '../schedule-writer'

vi.mock('../fact-check', () => ({
  checkFacts: vi.fn((input: FactCheckInput): FactCheckResult => {
    const overlay = input.texts.overlay ?? ''
    const verdict = overlay.includes('FAIL') ? 'fail' : 'pass'
    const m = /tour:(\w+)/.exec(overlay)
    return { verdict, targetTourId: m ? m[1] : null, catalogVersion: input.catalogVersion, items: [] }
  }),
}))

vi.mock('../version-groups', () => ({
  groupVersions: vi.fn((rows: readonly VersionRow[]) => ({
    groups: rows.map((r) => ({ latestId: r.id, memberIds: [r.id] })),
    ambiguous: [],
  })),
}))

const NOW = new Date('2026-11-05T00:00:00Z') // 13:00 NZ, 2026-11-05: daily slots are 2026-11-06 and 2026-11-07

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

const AGENT_ON = { quota: { reel_per_week: 3 }, social_agent: { enabled: true } }

function makeDeps(rows: WeeklyLoopOrderRow[], opts: { config?: unknown; planTier?: unknown; write?: (args: WriteReelScheduleArgs) => WriteReelScheduleResult; factWrite?: 'written' | 'conflict' } = {}): WeeklyLoopDeps {
  return {
    loadClient: vi.fn(async () => ({ id: 'c1', name: 'Client One', industry: null, config: opts.config ?? AGENT_ON, planTier: 'planTier' in opts ? opts.planTier : 'growth' })),
    loadOrders: vi.fn(async () => ({ rows, truncated: false })),
    loadFactSource: vi.fn(async () => ({ ok: true as const, catalogVersion: 7, tours: [], aliasesByTourId: {} })),
    writeFactCheck: vi.fn(async () => opts.factWrite ?? ('written' as const)),
    writeSchedule: vi.fn(async (args: WriteReelScheduleArgs): Promise<WriteReelScheduleResult> =>
      opts.write ? opts.write(args) : { ok: true, dryRun: args.dryRun, written: args.assignments, skipped: [] }),
  }
}

beforeEach(() => { vi.mocked(groupVersions).mockClear() })

function dated(id: string, publishOn: string, over: Partial<WeeklyLoopOrderRow> = {}): WeeklyLoopOrderRow {
  return row(id, { brief: { copy: { caption: `post ${id}` }, weekly_pack: { publish_on: publishOn } }, ...over })
}

function withOverlay(id: string, overlay: string, over: Partial<WeeklyLoopOrderRow> = {}): WeeklyLoopOrderRow {
  return row(id, { output: { caption: overlay, maliang_check: { status: 'pass', reasons: [], questions: [] } }, ...over })
}

function calls(deps: WeeklyLoopDeps): WriteReelScheduleArgs[] {
  return vi.mocked(deps.writeSchedule).mock.calls.map(([a]) => a)
}

describe('runWeeklyLoop daily cadence', () => {
  it('1. weekly path when social_agent is off', async () => {
    const deps = makeDeps([row('w1'), row('w2'), row('w3')], { config: { quota: { reel_per_week: 3 } } })
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    expect(receipt.cadence).toBeUndefined()
    const all = calls(deps)
    expect(all.length).toBeGreaterThan(0)
    for (const a of all) {
      expect(a.weekStart).toBe('2026-11-09')
      expect(a.blockOnlyPending).toBeUndefined()
    }
  })

  it('2. agent on, growth: fills two daily slots', async () => {
    const deps = makeDeps([row('w1'), row('w2'), row('w3')])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    const all = calls(deps)
    expect(all).toHaveLength(2)
    expect(all[0].assignments).toEqual([{ id: 'w1', publishOn: '2026-11-06' }])
    expect(all[0].weekStart).toBe('2026-11-02')
    expect(all[1].assignments).toEqual([{ id: 'w2', publishOn: '2026-11-07' }])
    expect(all[1].weekStart).toBe('2026-11-02')
    for (const a of all) {
      expect(a.blockOnlyPending).toBe(true)
      expect(a.scheduledBy).toBe('social-daily-agent')
      expect(a.dryRun).toBe(false)
    }
    expect(receipt.cadence).toBe('daily')
    expect(receipt.reel_per_day).toBe(1)
    expect(receipt.slot_dates).toEqual(['2026-11-06', '2026-11-07'])
    expect(receipt.pool_depth_days).toBe(3)
    expect(receipt.counts.scheduled).toBe(2)
    expect(receipt.no_publish).toBe(true)
  })

  it('3. dry_run: writes nothing', async () => {
    const deps = makeDeps([row('w1'), row('w2'), row('w3')])
    await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })
    const all = calls(deps)
    expect(all.length).toBeGreaterThan(0)
    for (const a of all) expect(a.dryRun).toBe(true)
    expect(deps.writeFactCheck).not.toHaveBeenCalled()
  })

  it('4. dated row occupies its day', async () => {
    const deps = makeDeps([dated('w1', '2026-11-06'), row('w2'), row('w3')])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    const all = calls(deps)
    expect(all).toHaveLength(1)
    expect(all[0].assignments).toEqual([{ id: 'w2', publishOn: '2026-11-07' }])
    for (const a of all) {
      for (const asg of a.assignments) expect(asg.id).not.toBe('w1')
    }
    expect(receipt.counts.already_scheduled).toBe(1)
  })

  it('5. failed dated row still occupies its day', async () => {
    const deps = makeDeps([dated('w1', '2026-11-06', { output: { caption: 'overlay FAIL', maliang_check: { status: 'pass', reasons: [], questions: [] } } }), row('w2')])
    await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    const all = calls(deps)
    expect(all).toHaveLength(1)
    expect(all[0].assignments).toEqual([{ id: 'w2', publishOn: '2026-11-07' }])
  })

  it('6. product adjacency: same tour not on consecutive days', async () => {
    const deps = makeDeps([withOverlay('w1', 'overlay tour:A'), withOverlay('w2', 'overlay tour:A'), withOverlay('w3', 'overlay tour:B')])
    await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    const all = calls(deps)
    expect(all).toHaveLength(2)
    expect(all[0].assignments).toEqual([{ id: 'w1', publishOn: '2026-11-06' }])
    expect(all[1].assignments).toEqual([{ id: 'w3', publishOn: '2026-11-07' }])
  })

  it('7. version already scheduled: no write', async () => {
    vi.mocked(groupVersions).mockImplementationOnce(() => ({
      groups: [{ latestId: 'w2', memberIds: ['w1', 'w2'] }],
      ambiguous: [],
    }))
    const deps = makeDeps([dated('w1', '2026-11-20'), row('w2')])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    expect(calls(deps)).toHaveLength(0)
    expect(receipt.counts.skipped_by_reason.version_already_scheduled).toBe(1)
  })

  it('8. reel_per_day 0: no write, pool depth null', async () => {
    const deps = makeDeps([row('w1'), row('w2'), row('w3')], { config: { quota: { reel_per_week: 3 }, social_agent: { enabled: true, reel_per_day: 0 } } })
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    expect(calls(deps)).toHaveLength(0)
    expect(receipt.reel_per_day).toBe(0)
    expect(receipt.pool_depth_days).toBeNull()
  })

  it('9. unknown plan tier: no write', async () => {
    const deps = makeDeps([row('w1'), row('w2'), row('w3')], { planTier: 'gold' })
    await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    expect(calls(deps)).toHaveLength(0)
  })

  it('10. forceDaily on a weekly-config client', async () => {
    const deps = makeDeps([row('w1'), row('w2'), row('w3')], { config: { quota: { reel_per_week: 3 } } })
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write', forceDaily: true })
    expect(receipt.cadence).toBe('daily')
    expect(calls(deps)).toHaveLength(2)
  })

  it('11a. card_open is not an error', async () => {
    const deps = makeDeps([row('w1'), row('w2'), row('w3')], { write: () => ({ ok: false, reason: 'card_open' }) })
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    expect(receipt.errors).not.toContain('schedule_card_open')
    expect(receipt.counts.skipped_by_reason.card_open).toBe(2)
  })

  it('11b. card_check_failed is an error', async () => {
    const deps = makeDeps([row('w1'), row('w2'), row('w3')], { write: () => ({ ok: false, reason: 'card_check_failed' }) })
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    expect(receipt.errors).toContain('schedule_card_check_failed')
  })

  it('12. fact check conflict: nothing scheduled', async () => {
    const deps = makeDeps([row('w1'), row('w2'), row('w3')], { factWrite: 'conflict' })
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    expect(calls(deps)).toHaveLength(0)
    expect(receipt.counts.skipped_by_reason.fact_check_not_persisted).toBe(3)
  })

  it('never schedules an undated row that failed facts or has no 马良 review', async () => {
    const deps = makeDeps([
      row('w1', { output: { caption: 'overlay FAIL', maliang_check: { status: 'pass', reasons: [], questions: [] } } }),
      row('w2', { output: { caption: 'overlay w2' } }),
      row('w3'),
    ])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'write' })
    const ids = vi.mocked(deps.writeSchedule).mock.calls.flatMap(([a]) => a.assignments.map((x) => x.id))
    expect(ids).toEqual(['w3'])
    expect(receipt.counts.skipped_by_reason.fact_fail).toBe(1)
    expect(receipt.counts.skipped_by_reason.unreviewed).toBe(1)
    expect(receipt.pool_depth_days).toBe(1)
  })
})
