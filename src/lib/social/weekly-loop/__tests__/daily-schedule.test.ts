import { describe, expect, it, vi } from 'vitest'
import type { VersionRow } from '../version-groups'
import { groupVersions } from '../version-groups'
import { dailyVersionDecisions, dailyWindows, mondayOf, occupiedDays, poolDepthDays, DAILY_LOOK_DAYS } from '../daily-schedule'

vi.mock('../version-groups', () => ({ groupVersions: vi.fn() }))

interface DatedRow extends VersionRow {
  scheduledOn: string | null
}

function datedRow(id: string, scheduledOn: string | null): DatedRow {
  return { id, created_at: '2026-11-01T00:00:00Z', brief: {}, overlay: null, scheduledOn }
}

describe('dailyWindows', () => {
  it('computes today, slot dates and look window in NZ time', () => {
    const w = dailyWindows(new Date('2026-11-05T00:00:00Z'))
    expect(w.today).toBe('2026-11-05')
    expect(w.slotDates).toEqual(['2026-11-06', '2026-11-07'])
    expect(w.lookStart).toBe('2026-11-06')
    expect(w.lookEnd).toBe('2026-12-03')
    expect(w.lookEnd).toBe('2026-12-03')
    expect(DAILY_LOOK_DAYS).toBe(28)
  })

  it('rolls over to the next NZ day after midnight NZ', () => {
    const w = dailyWindows(new Date('2026-11-05T12:30:00Z'))
    expect(w.today).toBe('2026-11-06')
  })
})

describe('mondayOf', () => {
  it('returns the same day for a Monday', () => {
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
  })

  it('returns the previous Monday for a Sunday', () => {
    expect(mondayOf('2026-11-08')).toBe('2026-11-02')
  })

  it('returns the Monday of the week for a Wednesday', () => {
    expect(mondayOf('2026-11-11')).toBe('2026-11-09')
  })
})

describe('dailyVersionDecisions', () => {
  it('keeps dated versions, drops superseded and ambiguous ones', () => {
    vi.mocked(groupVersions).mockReturnValueOnce({
      groups: [
        { latestId: 'b', memberIds: ['a', 'b'] },
        { latestId: 'd', memberIds: ['c', 'd'] },
      ],
      ambiguous: [{ ids: ['e'], reason: 'x' }],
    })

    const rows: DatedRow[] = [
      datedRow('a', '2026-11-20'),
      datedRow('b', null),
      datedRow('c', null),
      datedRow('d', null),
      datedRow('e', '2026-11-09'),
    ]

    const { keep, excluded } = dailyVersionDecisions(rows)

    expect(keep).toEqual(new Set(['a', 'd']))
    expect(excluded.get('b')).toBe('version_already_scheduled')
    expect(excluded.get('c')).toBe('superseded')
    expect(excluded.get('e')).toBe('ambiguous_version')
    expect(excluded.size).toBe(3)
  })
})

describe('occupiedDays', () => {
  it('returns only dated rows with their product key', () => {
    const out = occupiedDays(
      [
        { id: 'a', scheduledOn: '2026-11-06' },
        { id: 'b', scheduledOn: null },
      ],
      (id) => (id === 'a' ? 'tourA' : null),
    )
    expect(out).toEqual([{ id: 'a', publishOn: '2026-11-06', productKey: 'tourA' }])
  })
})

describe('poolDepthDays', () => {
  it('divides the pool by the daily quota', () => {
    expect(poolDepthDays(3, 1)).toBe(3)
  })

  it('returns null when the quota is zero', () => {
    expect(poolDepthDays(3, 0)).toBeNull()
  })

  it('floors the division', () => {
    expect(poolDepthDays(5, 2)).toBe(2)
  })
})

describe('dailyVersionDecisions · exclusion', () => {
  const ex = { weekly_pack: { excluded_by_card: { at: 'x', by: 'y', reason: 'z' } } }
  it('the newest version was excluded → the whole reel stays off (no older version comes back)', () => {
    vi.mocked(groupVersions).mockReturnValueOnce({ groups: [{ latestId: 'v3', memberIds: ['v2', 'v3'] }], ambiguous: [] })
    const { keep, excluded } = dailyVersionDecisions([
      { id: 'v2', created_at: '2026-11-01', brief: {}, overlay: null, scheduledOn: null },
      { id: 'v3', created_at: '2026-11-02', brief: ex, overlay: null, scheduledOn: null },
    ])
    expect([...keep]).toEqual([])
    expect(excluded.get('v3')).toBe('excluded_by_card')
    expect(excluded.get('v2')).toBe('version_excluded')
  })

  it('a version made after the exclusion (now the newest) can be scheduled', () => {
    vi.mocked(groupVersions).mockReturnValueOnce({ groups: [{ latestId: 'v4', memberIds: ['v3', 'v4'] }], ambiguous: [] })
    const { keep, excluded } = dailyVersionDecisions([
      { id: 'v3', created_at: '2026-11-02', brief: ex, overlay: null, scheduledOn: null },
      { id: 'v4', created_at: '2026-11-03', brief: {}, overlay: null, scheduledOn: null },
    ])
    expect([...keep]).toEqual(['v4'])
    expect(excluded.get('v3')).toBe('superseded')
  })
})

