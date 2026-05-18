/**
 * Tests for src/lib/case-library/benchmark-accumulator.ts — P8.12.S2.4
 * TDD: calcPercentiles, accumulateBenchmarks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  calcPercentiles,
  accumulateBenchmarks,
  MIN_SAMPLE_THRESHOLD,
  REPRESENTATIVE_KPIS,
} from '../benchmark-accumulator'

// ── 1. calcPercentiles ────────────────────────────────────────────────────────

describe('calcPercentiles', () => {
  it('returns null for empty array', () => {
    expect(calcPercentiles([])).toBeNull()
  })

  it('returns all equal for single value', () => {
    const r = calcPercentiles([42])
    expect(r).not.toBeNull()
    expect(r!.p50).toBe(42)
    expect(r!.p75).toBe(42)
    expect(r!.p90).toBe(42)
  })

  it('returns correct median for odd-length array', () => {
    // [10,20,30,40,50] → P50=30
    const r = calcPercentiles([50, 10, 30, 20, 40])
    expect(r!.p50).toBe(30)
  })

  it('returns interpolated P75 for even-length array', () => {
    // [1,2,3,4] → P75 = 3 + 0.25*(4-3) = 3.25 ≈ 3.3 (rounded to 1 dp)
    const r = calcPercentiles([1, 2, 3, 4])
    expect(r!.p75).toBeCloseTo(3.25, 1)
  })

  it('returns P50/P75/P90 for 10 values 10..100', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const r = calcPercentiles(values)!
    // P50: idx = 4.5 → (50+60)/2 = 55
    expect(r.p50).toBeCloseTo(55, 1)
    // P75: idx = 6.75 → 70 + 0.75*(80-70) = 77.5
    expect(r.p75).toBeCloseTo(77.5, 1)
    // P90: idx = 8.1 → 90 + 0.1*(100-90) = 91
    expect(r.p90).toBeCloseTo(91, 1)
  })

  it('handles already-sorted and reverse-sorted identically', () => {
    const asc = calcPercentiles([1, 2, 3, 4, 5])
    const desc = calcPercentiles([5, 4, 3, 2, 1])
    expect(asc!.p50).toBe(desc!.p50)
    expect(asc!.p75).toBe(desc!.p75)
    expect(asc!.p90).toBe(desc!.p90)
  })
})

// ── 2. MIN_SAMPLE_THRESHOLD ───────────────────────────────────────────────────

describe('MIN_SAMPLE_THRESHOLD', () => {
  it('is a positive integer >= 3', () => {
    expect(MIN_SAMPLE_THRESHOLD).toBeGreaterThanOrEqual(3)
    expect(Number.isInteger(MIN_SAMPLE_THRESHOLD)).toBe(true)
  })
})

// ── 3. REPRESENTATIVE_KPIS ────────────────────────────────────────────────────

describe('REPRESENTATIVE_KPIS', () => {
  it('maps authority_score to seo dimension', () => {
    expect(REPRESENTATIVE_KPIS['authority_score']).toBeDefined()
    expect(REPRESENTATIVE_KPIS['authority_score'].dimension).toBe('seo')
  })
})

// ── 4. accumulateBenchmarks ───────────────────────────────────────────────────

/** Build a minimal Supabase mock for accumulateBenchmarks tests. */
function makeAccumulatorSupabase({
  outcomes = [] as Array<Record<string, unknown>>,
  outcomesError = null as null | { message: string },
  existingBenchmark = null as null | { id: string; source: string },
  benchmarkCheckError = null as null | { message: string },
  upsertError = null as null | { message: string },
} = {}) {
  const upsertFn = vi.fn().mockImplementation((_table: string) => {
    if (_table === 'industry_benchmarks') {
      return { eq: vi.fn().mockResolvedValue({ error: upsertError }) }
    }
    return {}
  })

  // We track call order to differentiate outcome fetches from benchmark checks
  let selectCallCount = 0

  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'prescription_outcomes') {
      return {
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue({ data: outcomesError ? null : outcomes, error: outcomesError }),
        }),
      }
    }

    if (table === 'industry_benchmarks') {
      selectCallCount++
      const callIdx = selectCallCount

      // Odd calls = check existence (maybeSingle), even calls = update/insert
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: benchmarkCheckError ? null : existingBenchmark,
            error: benchmarkCheckError,
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: upsertError }),
        }),
        insert: vi.fn().mockResolvedValue({ error: upsertError }),
      }
    }

    return {}
  })

  return { from: fromFn, _upsertFn: upsertFn }
}

/** Build 5+ outcome rows for industry_category='tourism' to exceed MIN_SAMPLE_THRESHOLD. */
function makeTourismOutcomes(count = 6): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    actual_value: 30 + i * 5,
    kpi_metric: 'authority_score',
    dimension: 'seo',
    prescription_cases: {
      industry_category: 'tourism',
      business_size: 'small',
      market: 'AU',
    },
  }))
}

describe('accumulateBenchmarks', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns zeros when no outcomes exist', async () => {
    const supabase = makeAccumulatorSupabase({ outcomes: [] })
    const result = await accumulateBenchmarks(supabase as never)
    expect(result.benchmarksUpdated).toBe(0)
    expect(result.groupsSkipped).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('returns error when outcomes fetch fails', async () => {
    const supabase = makeAccumulatorSupabase({ outcomesError: { message: 'db error' } })
    const result = await accumulateBenchmarks(supabase as never)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('db error')
  })

  it('skips groups below minSamples threshold', async () => {
    const outcomes = makeTourismOutcomes(2) // below default threshold of 5
    const supabase = makeAccumulatorSupabase({ outcomes })
    const result = await accumulateBenchmarks(supabase as never)
    expect(result.benchmarksUpdated).toBe(0)
    expect(result.groupsSkipped).toBe(1)
  })

  it('inserts new benchmark when no existing row', async () => {
    const outcomes = makeTourismOutcomes(6)
    const insertFn = vi.fn().mockResolvedValue({ error: null })
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'prescription_outcomes') {
        return {
          select: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: outcomes, error: null }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        insert: insertFn,
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }
    })

    const result = await accumulateBenchmarks({ from: fromFn } as never)
    expect(result.benchmarksUpdated).toBe(1)
    expect(insertFn).toHaveBeenCalledOnce()

    const insertedRow = insertFn.mock.calls[0][0] as Record<string, unknown>
    expect(insertedRow.industry_category).toBe('tourism')
    expect(insertedRow.dimension).toBe('seo')
    expect(insertedRow.source).toBe('outcome_aggregation')
    expect(typeof insertedRow.score_p50).toBe('number')
    expect(typeof insertedRow.score_p75).toBe('number')
    expect(typeof insertedRow.score_p90).toBe('number')
    expect(insertedRow.sample_size).toBe(6)
  })

  it('updates existing benchmark when row already exists', async () => {
    const outcomes = makeTourismOutcomes(6)
    const updateEqFn = vi.fn().mockResolvedValue({ error: null })
    const updateFn = vi.fn().mockReturnValue({ eq: updateEqFn })

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'prescription_outcomes') {
        return {
          select: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: outcomes, error: null }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'bench-1', source: 'manual' }, error: null }),
        }),
        update: updateFn,
        insert: vi.fn(),
      }
    })

    const result = await accumulateBenchmarks({ from: fromFn } as never)
    expect(result.benchmarksUpdated).toBe(1)
    expect(updateFn).toHaveBeenCalledOnce()
  })

  it('skips outcomes with null actual_value', async () => {
    const outcomes: Array<Record<string, unknown>> = [
      { actual_value: null, kpi_metric: 'authority_score', dimension: 'seo',
        prescription_cases: { industry_category: 'tourism', business_size: 'small', market: 'AU' } },
    ]
    const supabase = makeAccumulatorSupabase({ outcomes })
    const result = await accumulateBenchmarks(supabase as never)
    expect(result.benchmarksUpdated).toBe(0)
  })

  it('skips outcomes without matching industry_category', async () => {
    const outcomes: Array<Record<string, unknown>> = makeTourismOutcomes(6).map(o => ({
      ...o,
      prescription_cases: { industry_category: null, business_size: 'small', market: 'AU' },
    }))
    const supabase = makeAccumulatorSupabase({ outcomes })
    const result = await accumulateBenchmarks(supabase as never)
    expect(result.benchmarksUpdated).toBe(0)
  })

  it('skips non-representative kpi_metrics (e.g. organic_traffic)', async () => {
    const outcomes = makeTourismOutcomes(6).map(o => ({ ...o, kpi_metric: 'organic_traffic' }))
    const supabase = makeAccumulatorSupabase({ outcomes })
    const result = await accumulateBenchmarks(supabase as never)
    expect(result.benchmarksUpdated).toBe(0)
    expect(result.groupsSkipped).toBe(0) // not even counted as skipped — just ignored
  })

  it('respects custom minSamples parameter', async () => {
    const outcomes = makeTourismOutcomes(3) // 3 samples, below default 5
    const insertFn = vi.fn().mockResolvedValue({ error: null })
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'prescription_outcomes') {
        return {
          select: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: outcomes, error: null }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        insert: insertFn,
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }
    })

    // With minSamples=3 it should pass
    const result = await accumulateBenchmarks({ from: fromFn } as never, 3)
    expect(result.benchmarksUpdated).toBe(1)
  })

  it('confidence increases with sample_size (capped at 0.95)', async () => {
    const makeOutcomes = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        actual_value: 40 + i,
        kpi_metric: 'authority_score',
        dimension: 'seo',
        prescription_cases: { industry_category: 'tourism', business_size: 'small', market: 'AU' },
      }))

    const insertedRows: Array<Record<string, unknown>> = []
    const makeFn = (count: number) => vi.fn().mockImplementation((table: string) => {
      if (table === 'prescription_outcomes') {
        return { select: vi.fn().mockReturnValue({ not: vi.fn().mockResolvedValue({ data: makeOutcomes(count), error: null }) }) }
      }
      return {
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        insert: vi.fn().mockImplementation(row => { insertedRows.push(row); return Promise.resolve({ error: null }) }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }
    })

    await accumulateBenchmarks({ from: makeFn(5) } as never)
    await accumulateBenchmarks({ from: makeFn(20) } as never)

    const conf5 = insertedRows[0]?.confidence as number
    const conf20 = insertedRows[1]?.confidence as number
    expect(conf5).toBeLessThan(conf20)
    expect(conf20).toBeLessThanOrEqual(0.95)
  })

  it('records error on benchmark check failure, continues', async () => {
    const outcomes = makeTourismOutcomes(6)
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'prescription_outcomes') {
        return { select: vi.fn().mockReturnValue({ not: vi.fn().mockResolvedValue({ data: outcomes, error: null }) }) }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'check failed' } }),
        }),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }
    })

    const result = await accumulateBenchmarks({ from: fromFn } as never)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('check failed')
    expect(result.benchmarksUpdated).toBe(0)
  })
})
