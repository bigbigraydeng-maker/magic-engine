import { describe, expect, it } from 'vitest'
import { classifyMetaChangeOutcome, MIN_IMPRESSIONS_FOR_CLASSIFICATION } from '../outcome-classifier'
import { fromGscPages } from '../candidates'
import type { MetaCycleBaseline } from '../types'

describe('classifyMetaChangeOutcome — sample-size floor (魏征 finding #11)', () => {
  it('returns insufficient_data when baseline impressions are below the floor even if the CTR delta looks huge', () => {
    // 1 click / 3 impressions -> 2 clicks / 3 impressions looks like a +33pp "improvement" — it's noise.
    const result = classifyMetaChangeOutcome(
      { ctr: 0.333, position: 10, impressions: 3 },
      { ctr: 0.666, position: 9, impressions: 3, clicks: 2 },
    )
    expect(result.outcome).toBe('insufficient_data')
  })

  it('returns insufficient_data when observed impressions are below the floor', () => {
    const result = classifyMetaChangeOutcome(
      { ctr: 0.05, position: 10, impressions: 100 },
      { ctr: 0.20, position: 9, impressions: 5, clicks: 1 },
    )
    expect(result.outcome).toBe('insufficient_data')
  })
})

describe('classifyMetaChangeOutcome — real GSC decimal CTR scale (PM 2026-09-20 量纲 bug fix)', () => {
  /**
   * Builds a baseline the same way runner.ts actually does: run a real page
   * through fromGscPages() (the same GSC-shaped raw row candidates.ts parses
   * everywhere else) and read candidate.ctr back out — NOT a hand-typed
   * percentage. This is the exact regression the PM asked for: GSC's real
   * ctr field is a 0-1 decimal fraction, and the classifier must treat it
   * as one throughout, not silently assume 0-100.
   */
  function baselineFromRealGscRow(ctr: number, impressions: number): MetaCycleBaseline {
    const [candidate] = fromGscPages(
      [{ page: 'https://example.com/blog/rotorua-tours', position: 8, impressions, ctr }],
    )
    return { ctr: candidate.ctr, position: candidate.position, impressions: candidate.impressions }
  }

  it('classifies improved for a real decimal CTR move from 0.021 to 0.035', () => {
    const baseline = baselineFromRealGscRow(0.021, 200)
    const observed = { ctr: 0.035, position: 6, impressions: 200, clicks: 7 }
    const result = classifyMetaChangeOutcome(baseline, observed)
    expect(result.outcome).toBe('improved')
    expect(result.ctrDelta).toBeCloseTo(0.014, 5)
  })

  it('classifies regressed for a real decimal CTR move from 0.035 to 0.018', () => {
    const baseline = baselineFromRealGscRow(0.035, 200)
    const observed = { ctr: 0.018, position: 11, impressions: 200, clicks: 4 }
    const result = classifyMetaChangeOutcome(baseline, observed)
    expect(result.outcome).toBe('regressed')
    expect(result.ctrDelta).toBeCloseTo(-0.017, 5)
  })

  it('classifies insufficient_data when impressions are too low, even with a real GSC-shaped baseline', () => {
    const baseline = baselineFromRealGscRow(0.021, MIN_IMPRESSIONS_FOR_CLASSIFICATION - 1)
    const observed = { ctr: 0.05, position: 5, impressions: MIN_IMPRESSIONS_FOR_CLASSIFICATION - 1, clicks: 1 }
    const result = classifyMetaChangeOutcome(baseline, observed)
    expect(result.outcome).toBe('insufficient_data')
  })

  it('a 0.011 decimal-fraction move (1.1 real percentage points) is NOT flat — this is exactly the case the old 0-100 assumption would have miscategorised', () => {
    // Old code treated ctr as 0-100 with FLAT_BAND=1.0 ("1.0" meant "1 whole
    // percentage point" on a 0-100 scale). Fed a REAL 0-1 decimal ctr, that
    // band was 100x too wide (equivalent to ±100 percentage points), so a
    // real, meaningful 1.1pp move like this one would have been swallowed
    // into "flat" every time. Fixed band is 0.01 (also "1 percentage
    // point", but in the correct 0-1 units), so this must NOT be flat.
    const baseline = baselineFromRealGscRow(0.020, 200)
    const observed = { ctr: 0.031, position: 7, impressions: 200, clicks: 6 }
    const result = classifyMetaChangeOutcome(baseline, observed)
    expect(result.outcome).not.toBe('flat')
    expect(result.outcome).toBe('improved')
  })

  it('classifies flat when the delta is within the ±0.01 flat band', () => {
    const baseline = baselineFromRealGscRow(0.05, 200)
    const observed = { ctr: 0.055, position: 10, impressions: 200, clicks: 11 }
    const result = classifyMetaChangeOutcome(baseline, observed)
    expect(result.outcome).toBe('flat')
  })
})
