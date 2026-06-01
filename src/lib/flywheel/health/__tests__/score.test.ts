/**
 * Flywheel health score pure function tests — P22.B.4
 */

import { describe, it, expect } from 'vitest'
import {
  scoreMetricTrend,
  scoreFlywheelMetrics,
  computeAnomalyPenalty,
  scoreToBand,
  buildHealthScore,
  HEALTH_METRICS,
} from '../score'

// ── scoreMetricTrend ──────────────────────────────────────────────────────────

describe('scoreMetricTrend', () => {
  it('returns 0.5 when latest equals avg (no change)', () => {
    expect(scoreMetricTrend(100, 100, false)).toBeCloseTo(0.5)
  })

  it('returns 1.0 when improvement is +5% or more (higher-is-better)', () => {
    // +5% exactly → normalised = (0.05 + 0.05) / 0.10 = 1.0
    expect(scoreMetricTrend(105, 100, false)).toBeCloseTo(1.0)
  })

  it('returns 0.0 when degradation is -5% or more (higher-is-better)', () => {
    expect(scoreMetricTrend(95, 100, false)).toBeCloseTo(0.0)
  })

  it('clamps to 1.0 for large improvements', () => {
    expect(scoreMetricTrend(200, 100, false)).toBe(1.0)
  })

  it('clamps to 0.0 for large degradations', () => {
    expect(scoreMetricTrend(50, 100, false)).toBe(0.0)
  })

  it('inverts logic for lowerIsBetter metrics', () => {
    // avg_position: lower is better; if latest (8) < avg (10) → improvement
    const betterPosition = scoreMetricTrend(8, 10, true)   // -20% = improvement
    const worsePosition  = scoreMetricTrend(12, 10, true)  // +20% = degradation
    expect(betterPosition).toBeGreaterThan(worsePosition)
    expect(betterPosition).toBe(1.0)
    expect(worsePosition).toBe(0.0)
  })

  it('returns 0.5 when avg is zero (avoid division by zero)', () => {
    expect(scoreMetricTrend(100, 0, false)).toBe(0.5)
  })
})

// ── scoreFlywheelMetrics ──────────────────────────────────────────────────────

describe('scoreFlywheelMetrics', () => {
  it('returns noData=true and neutral score (12.5) when no stats', () => {
    const result = scoreFlywheelMetrics('seo', [])
    expect(result.noData).toBe(true)
    expect(result.score).toBeCloseTo(12.5)
  })

  it('returns score=25 when all metrics are at max improvement', () => {
    const stats = [
      { metricKey: 'seo.gsc.clicks', latest: 200, avg30d: 100, lowerIsBetter: false },
      { metricKey: 'seo.gsc.impressions', latest: 200, avg30d: 100, lowerIsBetter: false },
    ]
    const result = scoreFlywheelMetrics('seo', stats)
    expect(result.score).toBeCloseTo(25)
    expect(result.noData).toBe(false)
  })

  it('returns score=0 when all metrics are at max degradation', () => {
    const stats = [
      { metricKey: 'seo.gsc.clicks', latest: 50, avg30d: 100, lowerIsBetter: false },
    ]
    expect(scoreFlywheelMetrics('seo', stats).score).toBeCloseTo(0)
  })

  it('returns score~12.5 when metrics show no change', () => {
    const stats = [
      { metricKey: 'seo.gsc.clicks', latest: 100, avg30d: 100, lowerIsBetter: false },
    ]
    expect(scoreFlywheelMetrics('seo', stats).score).toBeCloseTo(12.5)
  })

  it('averages across multiple metrics of different directions', () => {
    const stats = [
      { metricKey: 'seo.gsc.clicks',      latest: 200, avg30d: 100, lowerIsBetter: false }, // score=1.0
      { metricKey: 'seo.gsc.avg_position', latest: 50,  avg30d: 100, lowerIsBetter: true  }, // score=1.0 (lower = better)
    ]
    const result = scoreFlywheelMetrics('seo', stats)
    expect(result.score).toBeCloseTo(25)
  })
})

// ── computeAnomalyPenalty ─────────────────────────────────────────────────────

describe('computeAnomalyPenalty', () => {
  it('returns 0 when no anomalies', () => {
    expect(computeAnomalyPenalty(0)).toBe(0)
  })

  it('returns 2 per anomaly', () => {
    expect(computeAnomalyPenalty(3)).toBe(6)
  })

  it('caps at 20 regardless of anomaly count', () => {
    expect(computeAnomalyPenalty(50)).toBe(20)
    expect(computeAnomalyPenalty(10)).toBe(20) // 10 × 2 = 20 (exactly at cap)
  })

  it('returns exactly 20 at the cap threshold (10 anomalies)', () => {
    expect(computeAnomalyPenalty(10)).toBe(20)
  })
})

// ── scoreToBand ───────────────────────────────────────────────────────────────

describe('scoreToBand', () => {
  it('healthy for 75–100', () => {
    expect(scoreToBand(100)).toBe('healthy')
    expect(scoreToBand(75)).toBe('healthy')
  })

  it('fair for 50–74', () => {
    expect(scoreToBand(74)).toBe('fair')
    expect(scoreToBand(50)).toBe('fair')
  })

  it('at_risk for 25–49', () => {
    expect(scoreToBand(49)).toBe('at_risk')
    expect(scoreToBand(25)).toBe('at_risk')
  })

  it('critical for 0–24', () => {
    expect(scoreToBand(24)).toBe('critical')
    expect(scoreToBand(0)).toBe('critical')
  })
})

// ── buildHealthScore ──────────────────────────────────────────────────────────

describe('buildHealthScore', () => {
  const perfectBreakdown = [
    { flywheel: 'seo'    as const, score: 25, noData: false },
    { flywheel: 'geo'    as const, score: 25, noData: false },
    { flywheel: 'ads'    as const, score: 25, noData: false },
    { flywheel: 'social' as const, score: 25, noData: false },
  ]

  it('returns total=100 when all flywheels perfect and no anomalies', () => {
    const result = buildHealthScore(perfectBreakdown, 0)
    expect(result.total).toBe(100)
    expect(result.band).toBe('healthy')
    expect(result.anomalyPenalty).toBe(0)
  })

  it('deducts anomaly penalty from total', () => {
    // 5 anomalies × 2 = 10 penalty → 100 - 10 = 90
    const result = buildHealthScore(perfectBreakdown, 5)
    expect(result.total).toBe(90)
    expect(result.activeAnomalies).toBe(5)
    expect(result.anomalyPenalty).toBe(10)
  })

  it('clamps total to 0 (does not go negative)', () => {
    const zeroBreakdown = [
      { flywheel: 'seo'    as const, score: 0, noData: false },
      { flywheel: 'geo'    as const, score: 0, noData: false },
      { flywheel: 'ads'    as const, score: 0, noData: false },
      { flywheel: 'social' as const, score: 0, noData: false },
    ]
    // 0 - 20 penalty = -20 → clamped to 0
    const result = buildHealthScore(zeroBreakdown, 20)
    expect(result.total).toBe(0)
    expect(result.band).toBe('critical')
  })

  it('rounds total to integer', () => {
    const fractionalBreakdown = [
      { flywheel: 'seo'    as const, score: 12.5, noData: true },
      { flywheel: 'geo'    as const, score: 12.5, noData: true },
      { flywheel: 'ads'    as const, score: 12.5, noData: true },
      { flywheel: 'social' as const, score: 12.5, noData: true },
    ]
    const result = buildHealthScore(fractionalBreakdown, 0) // 50.0 total
    expect(Number.isInteger(result.total)).toBe(true)
    expect(result.total).toBe(50)
  })

  it('includes breakdown in result', () => {
    const result = buildHealthScore(perfectBreakdown, 0)
    expect(result.breakdown).toHaveLength(4)
    expect(result.breakdown[0].flywheel).toBe('seo')
  })
})

// ── HEALTH_METRICS config ─────────────────────────────────────────────────────

describe('HEALTH_METRICS', () => {
  it('covers all 4 flywheels', () => {
    expect(Object.keys(HEALTH_METRICS)).toEqual(
      expect.arrayContaining(['seo', 'geo', 'ads', 'social'])
    )
  })

  it('each flywheel has at least one metric', () => {
    for (const [, metrics] of Object.entries(HEALTH_METRICS)) {
      expect(metrics.length).toBeGreaterThan(0)
    }
  })

  it('avg_position is lowerIsBetter', () => {
    const seoMetrics = HEALTH_METRICS.seo
    const avgPos = seoMetrics.find(m => m.key === 'seo.gsc.avg_position')
    expect(avgPos?.lowerIsBetter).toBe(true)
  })

  it('roas is not lowerIsBetter', () => {
    const adsMetrics = HEALTH_METRICS.ads
    const roas = adsMetrics.find(m => m.key === 'ads.account.roas')
    expect(roas?.lowerIsBetter).toBe(false)
  })
})
