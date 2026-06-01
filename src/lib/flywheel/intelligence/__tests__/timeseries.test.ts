/**
 * Tests for timeseries.ts pure functions — Phase 22.B.2.
 * Run: npx jest timeseries
 */

import {
  bucketByGranularity,
  computeDeltaPct,
  movingAverage,
  detectGap,
  buildSparkline,
  type RawMetricPoint,
} from '../timeseries'

const TZ = 'Pacific/Auckland'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a raw metric point at UTC midnight of the given date.
 * Using UTC midnight avoids timezone edge cases where UTC noon == next day in NZST.
 */
function pt(dateStr: string, value: number): RawMetricPoint {
  return { measured_at: `${dateStr}T00:00:00.000Z`, metric_value: value }
}

// ─── bucketByGranularity ──────────────────────────────────────────────────────

describe('bucketByGranularity — day granularity', () => {
  const BASE_ARGS = ['seo.gsc.clicks', 'seo', 'GSC Clicks', 'count', 'higher_is_better'] as const

  test('empty input returns empty points', () => {
    const result = bucketByGranularity([], 'day', TZ, ...BASE_ARGS)
    expect(result.points).toEqual([])
    expect(result.hasDataGap).toBe(false)
    expect(result.deltaPct7d).toBeNull()
  })

  test('single point returns one bucket, deltaPct null', () => {
    const result = bucketByGranularity([pt('2026-06-01', 100)], 'day', TZ, ...BASE_ARGS)
    expect(result.points).toHaveLength(1)
    expect(result.points[0].value).toBe(100)
    expect(result.deltaPct7d).toBeNull()
  })

  test('two same-day points are summed (count metric, day granularity)', () => {
    const raw = [pt('2026-06-01', 50), pt('2026-06-01', 70)]
    const result = bucketByGranularity(raw, 'day', TZ, ...BASE_ARGS)
    expect(result.points).toHaveLength(1)
    expect(result.points[0].value).toBe(120)
  })

  test('7 consecutive days produce 7 buckets in ascending order', () => {
    const raw = Array.from({ length: 7 }, (_, i) => pt(`2026-06-0${i + 1}`, (i + 1) * 10))
    const result = bucketByGranularity(raw, 'day', TZ, ...BASE_ARGS)
    expect(result.points).toHaveLength(7)
    expect(result.points[0].value).toBe(10)
    expect(result.points[6].value).toBe(70)
  })

  test('unsorted input produces sorted output', () => {
    const raw = [pt('2026-06-03', 30), pt('2026-06-01', 10), pt('2026-06-02', 20)]
    const result = bucketByGranularity(raw, 'day', TZ, ...BASE_ARGS)
    expect(result.points.map(p => p.value)).toEqual([10, 20, 30])
  })
})

describe('bucketByGranularity — rank metric (lower_is_better)', () => {
  const RANK_ARGS = ['seo.gsc.avg_position', 'seo', 'Avg Position', 'rank', 'lower_is_better'] as const

  test('two same-day rank readings are averaged, not summed', () => {
    const raw = [pt('2026-06-01', 4.0), pt('2026-06-01', 6.0)]
    const result = bucketByGranularity(raw, 'day', TZ, ...RANK_ARGS)
    expect(result.points).toHaveLength(1)
    expect(result.points[0].value).toBeCloseTo(5.0)
  })
})

describe('bucketByGranularity — weekly granularity', () => {
  const ARGS = ['seo.gsc.clicks', 'seo', 'GSC Clicks', 'count', 'higher_is_better'] as const

  test('7 daily points collapse into 1 weekly bucket (same ISO week)', () => {
    // 2026-06-01 is a Monday
    const raw = Array.from({ length: 7 }, (_, i) => pt(`2026-06-0${i + 1}`, 10))
    const result = bucketByGranularity(raw, 'week', TZ, ...ARGS)
    expect(result.points).toHaveLength(1)
    // Weekly count: average for week granularity
    expect(result.points[0].value).toBeCloseTo(10)
  })

  test('14 daily points spanning 2 weeks collapse into 2 weekly buckets', () => {
    const raw = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 1)) // 2026-06-01
      d.setUTCDate(d.getUTCDate() + i)
      const dateStr = d.toISOString().slice(0, 10)
      return pt(dateStr, 10)
    })
    const result = bucketByGranularity(raw, 'week', TZ, ...ARGS)
    expect(result.points).toHaveLength(2)
  })
})

// ─── computeDeltaPct ──────────────────────────────────────────────────────────

describe('computeDeltaPct', () => {
  test('empty array returns null', () => {
    expect(computeDeltaPct([], 7)).toBeNull()
  })

  test('single point returns null', () => {
    expect(computeDeltaPct([{ ts: '2026-06-01T00:00:00.000Z', value: 100 }], 7)).toBeNull()
  })

  test('100 → 150 over 7 days = +50%', () => {
    const points = [
      { ts: '2026-05-25T00:00:00.000Z', value: 100 },
      { ts: '2026-06-01T00:00:00.000Z', value: 150 },
    ]
    const result = computeDeltaPct(points, 7)
    expect(result).toBeCloseTo(50)
  })

  test('150 → 100 over 7 days = -33.3%', () => {
    const points = [
      { ts: '2026-05-25T00:00:00.000Z', value: 150 },
      { ts: '2026-06-01T00:00:00.000Z', value: 100 },
    ]
    const result = computeDeltaPct(points, 7)
    expect(result).toBeCloseTo(-33.33, 1)
  })

  test('reference value = 0 returns null (avoid divide-by-zero)', () => {
    const points = [
      { ts: '2026-05-25T00:00:00.000Z', value: 0 },
      { ts: '2026-06-01T00:00:00.000Z', value: 100 },
    ]
    expect(computeDeltaPct(points, 7)).toBeNull()
  })

  test('returns null when no point found within tolerance of window', () => {
    const points = [
      { ts: '2026-05-01T00:00:00.000Z', value: 100 },  // 31 days ago
      { ts: '2026-06-01T00:00:00.000Z', value: 150 },
    ]
    // 7-day window — 31-day-old point is too far, tolerance = 1.5 days
    expect(computeDeltaPct(points, 7)).toBeNull()
  })
})

// ─── movingAverage ────────────────────────────────────────────────────────────

describe('movingAverage', () => {
  const points = [
    { ts: '2026-06-01T00:00:00.000Z', value: 10 },
    { ts: '2026-06-02T00:00:00.000Z', value: 20 },
    { ts: '2026-06-03T00:00:00.000Z', value: 30 },
    { ts: '2026-06-04T00:00:00.000Z', value: 40 },
    { ts: '2026-06-05T00:00:00.000Z', value: 50 },
  ]

  test('n=1 is identity', () => {
    const result = movingAverage(points, 1)
    expect(result.map(p => p.value)).toEqual([10, 20, 30, 40, 50])
  })

  test('n=3 first element uses only available points', () => {
    const result = movingAverage(points, 3)
    expect(result[0].value).toBe(10)        // only 1 point available
    expect(result[1].value).toBe(15)        // avg(10,20)
    expect(result[2].value).toBeCloseTo(20) // avg(10,20,30)
    expect(result[3].value).toBeCloseTo(30) // avg(20,30,40)
    expect(result[4].value).toBeCloseTo(40) // avg(30,40,50)
  })

  test('n <= 0 returns original points', () => {
    const result = movingAverage(points, 0)
    expect(result).toEqual(points)
  })

  test('empty array returns empty', () => {
    expect(movingAverage([], 3)).toEqual([])
  })
})

// ─── detectGap ────────────────────────────────────────────────────────────────

describe('detectGap', () => {
  test('consecutive days (no gap) returns false', () => {
    const points = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 1))
      d.setUTCDate(d.getUTCDate() + i)
      return { ts: d.toISOString(), value: 10 }
    })
    expect(detectGap(points, 3)).toBe(false)
  })

  test('gap of 4 days triggers when minConsecutiveMissing=3', () => {
    const points = [
      { ts: '2026-06-01T00:00:00.000Z', value: 10 },
      { ts: '2026-06-06T00:00:00.000Z', value: 20 }, // 5-day gap
    ]
    expect(detectGap(points, 3)).toBe(true)
  })

  test('gap of 2 days does NOT trigger when minConsecutiveMissing=3', () => {
    const points = [
      { ts: '2026-06-01T00:00:00.000Z', value: 10 },
      { ts: '2026-06-03T00:00:00.000Z', value: 20 }, // 2-day gap
    ]
    expect(detectGap(points, 3)).toBe(false)
  })

  test('empty array returns false', () => {
    expect(detectGap([], 3)).toBe(false)
  })

  test('single point returns false', () => {
    expect(detectGap([{ ts: '2026-06-01T00:00:00.000Z', value: 10 }], 3)).toBe(false)
  })
})

// ─── buildSparkline ───────────────────────────────────────────────────────────

describe('buildSparkline', () => {
  test('all 28 days filled — no nulls', () => {
    const endDate = new Date('2026-06-28T00:00:00.000Z')
    const points  = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 1))
      d.setUTCDate(d.getUTCDate() + i)
      return { ts: d.toISOString(), value: i + 1 }
    })
    const sparkline = buildSparkline(points, 28, endDate)
    expect(sparkline).toHaveLength(28)
    expect(sparkline.every(v => v !== null)).toBe(true)
    expect(sparkline[0]).toBe(1)   // oldest value
    expect(sparkline[27]).toBe(28) // newest value
  })

  test('missing middle day leaves null at correct index', () => {
    const endDate = new Date('2026-06-07T00:00:00.000Z')
    const points = [
      { ts: '2026-06-01T00:00:00.000Z', value: 1 },
      // day 2 and 3 missing
      { ts: '2026-06-04T00:00:00.000Z', value: 4 },
      { ts: '2026-06-05T00:00:00.000Z', value: 5 },
      { ts: '2026-06-06T00:00:00.000Z', value: 6 },
      { ts: '2026-06-07T00:00:00.000Z', value: 7 },
    ]
    const sparkline = buildSparkline(points, 7, endDate)
    expect(sparkline).toHaveLength(7)
    expect(sparkline[0]).toBe(1)    // June 1
    expect(sparkline[1]).toBeNull() // June 2 missing
    expect(sparkline[2]).toBeNull() // June 3 missing
    expect(sparkline[3]).toBe(4)    // June 4
    expect(sparkline[6]).toBe(7)    // June 7 (newest)
  })

  test('returns all nulls for empty points', () => {
    const endDate   = new Date('2026-06-07T00:00:00.000Z')
    const sparkline = buildSparkline([], 7, endDate)
    expect(sparkline).toHaveLength(7)
    expect(sparkline.every(v => v === null)).toBe(true)
  })
})
