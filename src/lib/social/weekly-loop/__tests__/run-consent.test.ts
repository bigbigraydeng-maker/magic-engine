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

const GRANTED = {
  status: 'granted',
  scope: ['facebook_organic'],
  subject: 'guest',
  confirmed_by: 'system:pm-chat',
  confirmed_at: '2026-11-04T00:00:00.000Z',
  evidence: 'PM chat',
}
const V2_FACE = {
  check_version: 'v2',
  status: 'pass',
  reasons: [],
  questions: ['可辨认人脸 @ 0s，需人确认授权'],
  identifiable_faces: [{ t_start: 0, t_end: 2, count: 1 }],
}

describe('runWeeklyLoop · on-camera consent', () => {
  it('an external upload without consent is not scheduled and raises a consent task', async () => {
    const deps = makeDeps([
      row('w1', {
        brief: { engine: 'external_upload', copy: { caption: 'post w1' } },
        output: { caption: 'overlay w1', maliang_check: V2_FACE },
      }),
    ])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w1')?.excluded_reason).toBe('consent_missing')
    expect(receipt.counts.consent_blocked).toBe(1)
    expect(receipt.scheduled).toHaveLength(0)
    expect(receipt.manual_tasks.some((t) => t.code === 'consent_blocked')).toBe(true)
  })

  it('with granted consent the same reel is scheduled', async () => {
    const deps = makeDeps([
      row('w1', {
        brief: { engine: 'external_upload', copy: { caption: 'post w1' }, talent_consent: GRANTED },
        output: { caption: 'overlay w1', maliang_check: V2_FACE },
      }),
    ])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w1')?.excluded_reason).toBeNull()
    expect(receipt.scheduled.map((s) => s.id)).toContain('w1')
    expect(receipt.counts.consent_blocked).toBe(0)
    expect(receipt.manual_tasks.some((t) => t.code === 'consent_blocked')).toBe(false)
  })

  it('a factory reel with a v2 face and no consent is not gated yet (known gap)', async () => {
    const deps = makeDeps([
      row('w1', {
        brief: { copy: { caption: 'post w1' } },
        output: { caption: 'overlay w1', maliang_check: V2_FACE },
      }),
    ])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w1')?.excluded_reason).toBeNull()
  })

  it('a factory reel with a v1 pass and no faces info still schedules (known gap)', async () => {
    const deps = makeDeps([row('w1')])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w1')?.excluded_reason).toBeNull()
  })

  it('a 马良 fail stays maliang_fail, not a consent reason', async () => {
    const deps = makeDeps([
      row('w1', {
        brief: { engine: 'external_upload', copy: { caption: 'post w1' } },
        output: { caption: 'overlay w1', maliang_check: { status: 'fail', reasons: ['x'], questions: [] } },
      }),
    ])
    const receipt = await runWeeklyLoop(deps, { clientId: 'c1', now: NOW, mode: 'dry_run' })

    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    expect(byId.get('w1')?.excluded_reason).toBe('maliang_fail')
    expect(receipt.counts.consent_blocked).toBe(0)
  })
})
