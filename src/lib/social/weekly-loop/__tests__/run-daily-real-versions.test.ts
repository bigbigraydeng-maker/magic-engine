/**
 * Daily cadence with the REAL version grouping: dated rows outside the look window (today, past, any status)
 * must occupy their day and stop other versions of the same reel from getting a date.
 */
import { describe, it, expect, vi } from 'vitest'
import type { FactCheckInput, FactCheckResult } from '../fact-check'
import { runWeeklyLoop, type WeeklyLoopDeps, type WeeklyLoopOrderRow } from '../run'
import type { WriteReelScheduleArgs, WriteReelScheduleResult } from '../schedule-writer'

vi.mock('../fact-check', () => ({
  checkFacts: vi.fn((input: FactCheckInput): FactCheckResult => {
    const m = /tour:(\w+)/.exec(input.texts.overlay ?? '')
    return { verdict: 'pass', targetTourId: m ? m[1] : null, catalogVersion: input.catalogVersion, items: [] }
  }),
}))

const NOW = new Date('2026-11-05T00:00:00Z') // 2026-11-05 13:00 NZ → slots 11-06, 11-07
const PASS = { status: 'pass', reasons: [], questions: [] }

function row(id: string, created: string, over: Partial<WeeklyLoopOrderRow> = {}): WeeklyLoopOrderRow {
  return {
    id,
    status: 'approved',
    created_at: created,
    updated_at: created,
    angle: `Title ${id}`,
    brief: { copy: { caption: `post ${id}` } },
    output: { caption: `overlay ${id} tour:${id}`, maliang_check: PASS },
    review_ref: { approved_at: '2026-11-01T00:00:00Z' },
    published_ref: { video_state: 'DRAFT' },
    ...over,
  }
}

function deps(rows: WeeklyLoopOrderRow[]): WeeklyLoopDeps {
  return {
    loadClient: vi.fn(async () => ({ id: 'c1', name: 'C', industry: null, config: { social_agent: { enabled: true } }, planTier: 'growth' })),
    loadOrders: vi.fn(async () => ({ rows, truncated: false })),
    loadFactSource: vi.fn(async () => ({ ok: true as const, catalogVersion: 7, tours: [], aliasesByTourId: {} })),
    writeFactCheck: vi.fn(async () => 'written' as const),
    writeSchedule: vi.fn(async (a: WriteReelScheduleArgs): Promise<WriteReelScheduleResult> => ({ ok: true, dryRun: a.dryRun, written: a.assignments, skipped: [] })),
  }
}

const assigned = (d: WeeklyLoopDeps) => vi.mocked(d.writeSchedule).mock.calls.flatMap(([a]) => a.assignments)

describe('daily cadence · real version groups', () => {
  it('a version dated TODAY blocks its newer version from getting a date', async () => {
    const today = row('a1', '2026-11-01T00:00:00Z', { brief: { copy: { caption: 'x' }, weekly_pack: { publish_on: '2026-11-05' } } })
    const newer = row('a2', '2026-11-02T00:00:00Z', { brief: { copy: { caption: 'y' }, reopened_from: 'a1' } })
    const d = deps([today, newer])
    const receipt = await runWeeklyLoop(d, { clientId: 'c1', now: NOW, mode: 'write' })
    expect(assigned(d).map((a) => a.id)).not.toContain('a2')
    expect(receipt.counts.skipped_by_reason.version_already_scheduled).toBe(1)
  })

  it('a reel dated today on tour X keeps tour X off tomorrow', async () => {
    const today = row('x1', '2026-11-01T00:00:00Z', {
      brief: { copy: { caption: 'x' }, weekly_pack: { publish_on: '2026-11-05' } },
      output: { caption: 'overlay tour:X', maliang_check: PASS },
    })
    const sameTour = row('x2', '2026-11-02T00:00:00Z', { output: { caption: 'other words tour:X', maliang_check: PASS } })
    const otherTour = row('y1', '2026-11-03T00:00:00Z', { output: { caption: 'more words tour:Y', maliang_check: PASS } })
    const d = deps([today, sameTour, otherTour])
    await runWeeklyLoop(d, { clientId: 'c1', now: NOW, mode: 'write' })
    const a = assigned(d)
    expect(a.find((x) => x.publishOn === '2026-11-06')?.id).toBe('y1')
  })

  it('an in_review row that already has a date still occupies that day', async () => {
    const busy = row('b1', '2026-11-01T00:00:00Z', { status: 'in_review', brief: { copy: { caption: 'x' }, weekly_pack: { publish_on: '2026-11-06' } } })
    const d = deps([busy, row('c1', '2026-11-02T00:00:00Z'), row('c2', '2026-11-03T00:00:00Z')])
    await runWeeklyLoop(d, { clientId: 'c1', now: NOW, mode: 'write' })
    expect(assigned(d).map((a) => a.publishOn)).toEqual(['2026-11-07'])
  })
})
