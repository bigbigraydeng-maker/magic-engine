import { describe, it, expect } from 'vitest'
import {
  pickComparison,
  computeMetricDeltas,
  buildWindowLabel,
} from '../delta'
import { normalisePath } from '../path-utils'

describe('pickComparison', () => {
  it('returns { latest: null, previous: null } when snapshots are empty', () => {
    const result = pickComparison([], 7)
    expect(result).toEqual({ latest: null, previous: null })
  })

  it('returns latest only when one snapshot exists', () => {
    const snap = { synced_at: '2026-06-03T00:00:00Z', pages: [] }
    const result = pickComparison([snap], 7)
    expect(result.latest).toBe(snap)
    expect(result.previous).toBeNull()
  })

  it('picks the snapshot closest to 7 days before latest', () => {
    const snapshots = [
      { synced_at: '2026-06-03T00:00:00Z', pages: [] }, // latest
      { synced_at: '2026-06-02T00:00:00Z', pages: [] }, // 1d gap
      { synced_at: '2026-05-28T00:00:00Z', pages: [] }, // 6d gap ← first tied winner
      { synced_at: '2026-05-26T00:00:00Z', pages: [] }, // 8d gap ← second tied
      { synced_at: '2026-04-30T00:00:00Z', pages: [] }, // 34d gap
    ]
    const result = pickComparison(snapshots, 7)
    expect(result.latest?.synced_at).toBe('2026-06-03T00:00:00Z')
    // 5-28 is 1d off; 5-26 is also 1d off; earlier array entry wins ties
    expect(result.previous?.synced_at).toBe('2026-05-28T00:00:00Z')
  })
})

describe('computeMetricDeltas', () => {
  type Row = { p: string; v: number }

  it('returns deltas for pages present in both snapshots', () => {
    const latest: Row[]   = [{ p: '/a', v: 100 }, { p: '/b', v: 50 }]
    const previous: Row[] = [{ p: '/a', v: 80  }, { p: '/b', v: 50 }]

    const { byPath } = computeMetricDeltas(
      latest, previous,
      r => r.p, r => r.v, normalisePath,
    )

    expect(byPath.get('/a')).toMatchObject({
      delta: 20,
      deltaPct: 25,
      existedInPrevious: true,
    })
    expect(byPath.get('/b')).toMatchObject({
      delta: 0,
      deltaPct: 0,
      existedInPrevious: true,
    })
  })

  it('marks new pages with existedInPrevious=false and null delta', () => {
    const latest: Row[]   = [{ p: '/new-page', v: 30 }]
    const previous: Row[] = []

    const { byPath } = computeMetricDeltas(
      latest, previous,
      r => r.p, r => r.v, normalisePath,
    )

    expect(byPath.get('/new-page')).toMatchObject({
      delta: null,
      deltaPct: null,
      existedInPrevious: false,
    })
  })

  it('returns droppedOffPaths for pages in previous but not latest', () => {
    const latest: Row[]   = [{ p: '/a', v: 10 }]
    const previous: Row[] = [{ p: '/a', v: 10 }, { p: '/gone', v: 50 }]

    const { droppedOffPaths } = computeMetricDeltas(
      latest, previous,
      r => r.p, r => r.v, normalisePath,
    )

    expect(droppedOffPaths.has('/gone')).toBe(true)
    expect(droppedOffPaths.has('/a')).toBe(false)
  })

  it('handles divide-by-zero when previous is 0', () => {
    const latest: Row[]   = [{ p: '/a', v: 10 }]
    const previous: Row[] = [{ p: '/a', v: 0  }]

    const { byPath } = computeMetricDeltas(
      latest, previous,
      r => r.p, r => r.v, normalisePath,
    )

    expect(byPath.get('/a')).toMatchObject({
      delta: 10,
      deltaPct: null,
      existedInPrevious: true,
    })
  })

  it('normalises paths cross-source (http vs path-only)', () => {
    const latest   = [{ p: 'https://example.com/blog/foo', v: 20 }]
    const previous = [{ p: '/blog/foo?utm=x',                v: 10 }]

    const { byPath } = computeMetricDeltas(
      latest, previous,
      r => r.p, r => r.v, normalisePath,
    )

    expect(byPath.get('/blog/foo')).toMatchObject({
      delta: 10,
      deltaPct: 100,
    })
  })
})

describe('buildWindowLabel', () => {
  it('uses "Nd" label when gap is exactly target', () => {
    const result = buildWindowLabel('2026-06-03T00:00:00Z', '2026-05-27T00:00:00Z', 7)
    expect(result.label).toBe('7d')
    expect(result.days).toBe(7)
  })

  it('uses "Nd" label when gap is 6d or 8d (±1d tolerance)', () => {
    const r6 = buildWindowLabel('2026-06-03T00:00:00Z', '2026-05-28T00:00:00Z', 7)
    expect(r6.label).toBe('7d')

    const r8 = buildWindowLabel('2026-06-03T00:00:00Z', '2026-05-26T00:00:00Z', 7)
    expect(r8.label).toBe('7d')
  })

  it('falls back to "since YYYY-MM-DD" when gap differs too much from target', () => {
    const result = buildWindowLabel('2026-06-03T00:00:00Z', '2026-05-15T00:00:00Z', 7)
    expect(result.label).toBe('since 2026-05-15')
    expect(result.days).toBe(19)
  })
})

describe('normalisePath', () => {
  it('strips scheme/host from full URLs', () => {
    expect(normalisePath('https://example.com/blog/foo')).toBe('/blog/foo')
  })

  it('strips query and fragment', () => {
    expect(normalisePath('/blog/foo?utm=x#section')).toBe('/blog/foo')
  })

  it('strips trailing slash but preserves root', () => {
    expect(normalisePath('/blog/foo/')).toBe('/blog/foo')
    expect(normalisePath('/')).toBe('/')
  })

  it('returns empty string for empty input', () => {
    expect(normalisePath('')).toBe('')
  })
})
