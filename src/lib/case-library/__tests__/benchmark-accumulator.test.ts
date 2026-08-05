/**
 * Tests for src/lib/case-library/benchmark-accumulator.ts
 *
 * 覆盖重点：
 *   - 门槛边界（3 条写入 / 2 条跳过）
 *   - 指标方向归一化（lower_is_better 必须翻符号）
 *   - **字段级隔离**：写入 payload 绝不能包含 LEVEL 字段（score_p50/p75/p90 /
 *     source / confidence / sample_size），否则外部研究基准会被无声覆盖
 *   - 单客户样本必须被置信度惩罚 + 打上小样本标记
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  calcPercentiles,
  normaliseDeltaPct,
  calcGrowthConfidence,
  isLowConfidenceSample,
  buildGrowthNotes,
  accumulateBenchmarks,
  MIN_SAMPLE_THRESHOLD,
  LOW_SAMPLE_CEILING,
  REPRESENTATIVE_METRICS,
  TARGET_BUSINESS_SIZE,
  TARGET_MARKET,
} from '../benchmark-accumulator'

// ── 1. calcPercentiles ────────────────────────────────────────────────────────

describe('calcPercentiles', () => {
  it('returns null for empty array', () => {
    expect(calcPercentiles([])).toBeNull()
  })

  it('returns all equal for single value', () => {
    const r = calcPercentiles([42])!
    expect(r.p50).toBe(42)
    expect(r.p75).toBe(42)
    expect(r.p90).toBe(42)
  })

  it('returns correct median for odd-length array', () => {
    expect(calcPercentiles([50, 10, 30, 20, 40])!.p50).toBe(30)
  })

  it('returns interpolated P75 for even-length array', () => {
    expect(calcPercentiles([1, 2, 3, 4])!.p75).toBeCloseTo(3.25, 1)
  })

  it('handles negative values (metric went backwards)', () => {
    const r = calcPercentiles([-30, -10, -20])!
    expect(r.p50).toBe(-20)
  })

  it('handles already-sorted and reverse-sorted identically', () => {
    const asc = calcPercentiles([1, 2, 3, 4, 5])!
    const desc = calcPercentiles([5, 4, 3, 2, 1])!
    expect(asc.p50).toBe(desc.p50)
    expect(asc.p90).toBe(desc.p90)
  })
})

// ── 2. Constants ──────────────────────────────────────────────────────────────

describe('constants', () => {
  it('MIN_SAMPLE_THRESHOLD is 3', () => {
    expect(MIN_SAMPLE_THRESHOLD).toBe(3)
  })

  it('LOW_SAMPLE_CEILING is above the write threshold, so 3-4 samples get flagged', () => {
    expect(LOW_SAMPLE_CEILING).toBeGreaterThan(MIN_SAMPLE_THRESHOLD)
  })

  it('writes to the bucket huatuo actually reads (small / AU_NZ)', () => {
    expect(TARGET_BUSINESS_SIZE).toBe('small')
    expect(TARGET_MARKET).toBe('AU_NZ')
  })
})

describe('REPRESENTATIVE_METRICS', () => {
  it('maps seo.gsc.clicks to the seo dimension', () => {
    expect(REPRESENTATIVE_METRICS['seo.gsc.clicks'].dimension).toBe('seo')
  })

  it('maps geo.query.mention_rate to ai_visibility', () => {
    expect(REPRESENTATIVE_METRICS['geo.query.mention_rate'].dimension).toBe('ai_visibility')
  })

  it('excludes vanity / activity metrics', () => {
    expect(REPRESENTATIVE_METRICS['seo.gsc.impressions']).toBeUndefined()
    expect(REPRESENTATIVE_METRICS['seo.gsc.avg_position']).toBeUndefined()
    expect(REPRESENTATIVE_METRICS['social.posts.published_count']).toBeUndefined()
  })

  it('every registered metric declares an explicit direction', () => {
    for (const def of Object.values(REPRESENTATIVE_METRICS)) {
      expect(['higher_is_better', 'lower_is_better']).toContain(def.direction)
    }
  })
})

// ── 3. normaliseDeltaPct ──────────────────────────────────────────────────────

describe('normaliseDeltaPct', () => {
  it('passes higher_is_better through unchanged', () => {
    expect(normaliseDeltaPct(12.5, 'higher_is_better')).toBe(12.5)
    expect(normaliseDeltaPct(-8, 'higher_is_better')).toBe(-8)
  })

  it('flips lower_is_better so an improvement reads positive', () => {
    // Oztop avg_position 从 40 掉到 30 = delta_pct -25 = 排名改善
    expect(normaliseDeltaPct(-25, 'lower_is_better')).toBe(25)
    expect(normaliseDeltaPct(14, 'lower_is_better')).toBe(-14)
  })
})

// ── 4. calcGrowthConfidence ───────────────────────────────────────────────────

describe('calcGrowthConfidence', () => {
  it('caps hard when all samples come from a single client', () => {
    // 29 samples but 1 client → not an industry benchmark, just client history
    expect(calcGrowthConfidence(29, 1)).toBeLessThanOrEqual(0.4)
  })

  it('penalises 2 clients less than 1 client', () => {
    expect(calcGrowthConfidence(10, 2)).toBeGreaterThan(calcGrowthConfidence(10, 1))
  })

  it('applies no client penalty at 3+ clients', () => {
    expect(calcGrowthConfidence(10, 3)).toBe(calcGrowthConfidence(10, 5))
  })

  it('increases with sample size at fixed client count', () => {
    expect(calcGrowthConfidence(20, 3)).toBeGreaterThan(calcGrowthConfidence(4, 3))
  })

  it('never exceeds 0.9 and never goes negative', () => {
    expect(calcGrowthConfidence(1000, 100)).toBeLessThanOrEqual(0.9)
    expect(calcGrowthConfidence(0, 0)).toBeGreaterThanOrEqual(0)
  })
})

describe('isLowConfidenceSample', () => {
  it('flags fewer than 3 clients regardless of sample count', () => {
    expect(isLowConfidenceSample(50, 1)).toBe(true)
    expect(isLowConfidenceSample(50, 2)).toBe(true)
  })

  it('flags small samples even with enough clients', () => {
    expect(isLowConfidenceSample(3, 5)).toBe(true)
  })

  it('does not flag a healthy sample', () => {
    expect(isLowConfidenceSample(20, 4)).toBe(false)
  })
})

describe('buildGrowthNotes', () => {
  it('marks LOW CONFIDENCE when under 3 clients', () => {
    expect(buildGrowthNotes(29, 1, 28, 12.3)).toContain('LOW CONFIDENCE')
  })

  it('marks LOW CONFIDENCE on a small sample', () => {
    expect(buildGrowthNotes(3, 4, 28, 5)).toContain('LOW CONFIDENCE')
  })

  it('omits the warning for a healthy sample', () => {
    expect(buildGrowthNotes(20, 4, 28, 9)).not.toContain('LOW CONFIDENCE')
  })

  it('states sample size, client count and window', () => {
    const notes = buildGrowthNotes(12, 3, 28, 7.5)
    expect(notes).toContain('n=12')
    expect(notes).toContain('3 clients')
    expect(notes).toContain('28d')
  })
})

// ── 5. accumulateBenchmarks ───────────────────────────────────────────────────

interface MockOpts {
  clients?: Array<{ id: string; industry: string | null }>
  clientsError?: { message: string } | null
  outcomes?: Array<Record<string, unknown>>
  outcomesError?: { message: string } | null
  existing?: { id: string } | null
  checkError?: { message: string } | null
  writeError?: { message: string } | null
}

function makeSupabase(opts: MockOpts = {}) {
  const {
    clients = [{ id: 'c1', industry: 'flooring' }],
    clientsError = null,
    outcomes = [],
    outcomesError = null,
    existing = null,
    checkError = null,
    writeError = null,
  } = opts

  const updateFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: writeError }),
  })
  const insertFn = vi.fn().mockResolvedValue({ error: writeError })

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'clients') {
      return {
        select: vi.fn().mockResolvedValue({
          data: clientsError ? null : clients,
          error: clientsError,
        }),
      }
    }

    if (table === 'flywheel_outcomes') {
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              gte: vi.fn().mockResolvedValue({
                data: outcomesError ? null : outcomes,
                error: outcomesError,
              }),
            }),
          }),
        }),
      }
    }

    if (table === 'industry_benchmarks') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: checkError ? null : existing,
            error: checkError,
          }),
        }),
        update: updateFn,
        insert: insertFn,
      }
    }

    return {}
  })

  return { supabase: { from } as never, updateFn, insertFn }
}

/** N 条 seo.gsc.clicks outcome，可指定客户分布。 */
function clickOutcomes(deltas: number[], clientIds: string[] = ['c1']) {
  return deltas.map((delta_pct, i) => ({
    client_id: clientIds[i % clientIds.length],
    metric_key: 'seo.gsc.clicks',
    delta_pct,
    window_days: 28,
  }))
}

describe('accumulateBenchmarks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns zeros when there are no outcomes', async () => {
    const { supabase } = makeSupabase({ outcomes: [] })
    const result = await accumulateBenchmarks(supabase)
    expect(result.benchmarksUpdated).toBe(0)
    expect(result.groupsSkipped).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('surfaces a clients fetch error', async () => {
    const { supabase } = makeSupabase({ clientsError: { message: 'clients boom' } })
    const result = await accumulateBenchmarks(supabase)
    expect(result.errors[0]).toContain('clients boom')
  })

  it('surfaces an outcomes fetch error', async () => {
    const { supabase } = makeSupabase({ outcomesError: { message: 'outcomes boom' } })
    const result = await accumulateBenchmarks(supabase)
    expect(result.errors[0]).toContain('outcomes boom')
  })

  it('skips a group with 2 samples (below threshold)', async () => {
    const { supabase, updateFn, insertFn } = makeSupabase({ outcomes: clickOutcomes([10, 20]) })
    const result = await accumulateBenchmarks(supabase)
    expect(result.benchmarksUpdated).toBe(0)
    expect(result.groupsSkipped).toBe(1)
    expect(updateFn).not.toHaveBeenCalled()
    expect(insertFn).not.toHaveBeenCalled()
  })

  it('writes a group with exactly 3 samples (threshold boundary)', async () => {
    const { supabase, insertFn } = makeSupabase({ outcomes: clickOutcomes([10, 20, 30]) })
    const result = await accumulateBenchmarks(supabase)
    expect(result.benchmarksUpdated).toBe(1)
    expect(result.groupsSkipped).toBe(0)
    expect(insertFn).toHaveBeenCalledOnce()
  })

  it('respects an explicit higher minSamples argument', async () => {
    const { supabase } = makeSupabase({ outcomes: clickOutcomes([10, 20, 30]) })
    const result = await accumulateBenchmarks(supabase, 5)
    expect(result.benchmarksUpdated).toBe(0)
    expect(result.groupsSkipped).toBe(1)
  })

  it('NEVER writes LEVEL fields when updating an existing external benchmark', async () => {
    const { supabase, updateFn } = makeSupabase({
      outcomes: clickOutcomes([10, 20, 30]),
      existing: { id: 'bench-1' },
    })
    await accumulateBenchmarks(supabase)

    expect(updateFn).toHaveBeenCalledOnce()
    const payload = updateFn.mock.calls[0][0] as Record<string, unknown>

    // 这几个字段属于外部研究数据，accumulator 碰到就是事故
    for (const forbidden of ['score_p50', 'score_p75', 'score_p90', 'source', 'confidence', 'sample_size']) {
      expect(payload).not.toHaveProperty(forbidden)
    }
    // 该写的 GROWTH 字段要在
    expect(payload).toHaveProperty('realistic_3mo_growth_pct')
    expect(payload).toHaveProperty('growth_source', 'ME client outcomes')
    expect(payload).toHaveProperty('growth_sample_size', 3)
  })

  it('inserts into the small / AU_NZ bucket with the mapped industry code', async () => {
    const { supabase, insertFn } = makeSupabase({
      clients: [{ id: 'c1', industry: 'flooring' }],
      outcomes: clickOutcomes([10, 20, 30]),
    })
    await accumulateBenchmarks(supabase)

    const payload = insertFn.mock.calls[0][0] as Record<string, unknown>
    expect(payload.industry_category).toBe('building_supplies')
    expect(payload.business_size).toBe('small')
    expect(payload.market).toBe('AU_NZ')
    expect(payload.dimension).toBe('seo')
  })

  it('maps CTS travel to tourism_operator', async () => {
    const { supabase, insertFn } = makeSupabase({
      clients: [{ id: 'c1', industry: 'travel' }],
      outcomes: clickOutcomes([10, 20, 30]),
    })
    await accumulateBenchmarks(supabase)
    expect((insertFn.mock.calls[0][0] as Record<string, unknown>).industry_category).toBe('tourism_operator')
  })

  it('stores the median growth, not the mean', async () => {
    // [1, 2, 300] → median 2, mean 101
    const { supabase, insertFn } = makeSupabase({ outcomes: clickOutcomes([1, 2, 300]) })
    await accumulateBenchmarks(supabase)
    expect((insertFn.mock.calls[0][0] as Record<string, unknown>).realistic_3mo_growth_pct).toBe(2)
  })

  it('caps growth_confidence when every sample is from one client', async () => {
    const { supabase, insertFn } = makeSupabase({
      outcomes: clickOutcomes([10, 20, 30, 40, 50, 60], ['c1']),
    })
    await accumulateBenchmarks(supabase)
    const payload = insertFn.mock.calls[0][0] as Record<string, unknown>
    expect(payload.growth_client_count).toBe(1)
    expect(payload.growth_confidence as number).toBeLessThanOrEqual(0.4)
    expect(payload.notes as string).toContain('LOW CONFIDENCE')
  })

  it('counts distinct clients across the group', async () => {
    const { supabase, insertFn } = makeSupabase({
      clients: [
        { id: 'c1', industry: 'flooring' },
        { id: 'c2', industry: 'tiles' },
        { id: 'c3', industry: '建材' },
      ],
      outcomes: clickOutcomes([10, 20, 30, 40, 50, 60], ['c1', 'c2', 'c3']),
    })
    await accumulateBenchmarks(supabase)
    const payload = insertFn.mock.calls[0][0] as Record<string, unknown>
    expect(payload.growth_client_count).toBe(3)
    expect(payload.notes as string).not.toContain('LOW CONFIDENCE')
  })

  it('ignores metrics outside REPRESENTATIVE_METRICS', async () => {
    const noise = [10, 20, 30].map(delta_pct => ({
      client_id: 'c1',
      metric_key: 'seo.gsc.impressions',
      delta_pct,
      window_days: 28,
    }))
    const { supabase, insertFn } = makeSupabase({ outcomes: noise })
    const result = await accumulateBenchmarks(supabase)
    expect(result.benchmarksUpdated).toBe(0)
    expect(insertFn).not.toHaveBeenCalled()
  })

  it('counts clients whose industry cannot be mapped and does not aggregate them', async () => {
    const { supabase, insertFn } = makeSupabase({
      clients: [{ id: 'c1', industry: 'unclassifiable widget polishing' }],
      outcomes: clickOutcomes([10, 20, 30]),
    })
    const result = await accumulateBenchmarks(supabase)
    expect(result.clientsUnmapped).toBe(1)
    expect(result.benchmarksUpdated).toBe(0)
    expect(insertFn).not.toHaveBeenCalled()
  })

  it('adds a migration hint when the growth_* columns are missing', async () => {
    const { supabase } = makeSupabase({
      outcomes: clickOutcomes([10, 20, 30]),
      writeError: { message: "PGRST204: Could not find the 'growth_source' column" },
    })
    const result = await accumulateBenchmarks(supabase)
    expect(result.errors[0]).toContain('apply migration')
  })

  it('reports a benchmark lookup error without writing', async () => {
    const { supabase, updateFn, insertFn } = makeSupabase({
      outcomes: clickOutcomes([10, 20, 30]),
      checkError: { message: 'lookup failed' },
    })
    const result = await accumulateBenchmarks(supabase)
    expect(result.errors[0]).toContain('lookup failed')
    expect(updateFn).not.toHaveBeenCalled()
    expect(insertFn).not.toHaveBeenCalled()
  })
})
