import { describe, expect, it } from 'vitest'
import {
  STAGE_THRESHOLDS,
  computeStage,
  type StageSignals,
} from '../stage'

const base: StageSignals = {
  platform: 'facebook',
  hasPublishAuth: true,
  factCount: 20,
  verifiedAssetCount: 15,
  consecutiveOnTimeWeeks: 4,
  receiptsPerFormatMax: 0,
  consecutivePeriodsAtThreshold: 0,
  circuitBreakerTripped: false,
  complaintSpike: false,
}

const sig = (o: Partial<StageSignals>): StageSignals => ({ ...base, ...o })

const matureSignals: StageSignals = sig({
  consecutiveOnTimeWeeks: 12,
  receiptsPerFormatMax: 10,
  consecutivePeriodsAtThreshold: 2,
})

describe('computeStage', () => {
  it('returns growing for signals that exactly meet every starting-exit threshold', () => {
    const result = computeStage(base)
    expect(result.stage).toBe('growing')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('returns starting when publish auth is not connected', () => {
    const result = computeStage(sig({ hasPublishAuth: false }))
    expect(result.stage).toBe('starting')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('returns starting at factCount 19 and growing at factCount 20', () => {
    const below = computeStage(sig({ factCount: 19 }))
    expect(below.stage).toBe('starting')
    expect(below.reasons.join(' ')).toContain('19')

    const at = computeStage(sig({ factCount: 20 }))
    expect(at.stage).toBe('growing')
  })

  it('returns starting at verifiedAssetCount 14 and growing at verifiedAssetCount 15', () => {
    const below = computeStage(sig({ verifiedAssetCount: 14 }))
    expect(below.stage).toBe('starting')
    expect(below.reasons.join(' ')).toContain('14')

    const at = computeStage(sig({ verifiedAssetCount: 15 }))
    expect(at.stage).toBe('growing')
  })

  it('returns starting at consecutiveOnTimeWeeks 3 and growing at consecutiveOnTimeWeeks 4', () => {
    const below = computeStage(sig({ consecutiveOnTimeWeeks: 3 }))
    expect(below.stage).toBe('starting')
    expect(below.reasons.join(' ')).toContain('3')

    const at = computeStage(sig({ consecutiveOnTimeWeeks: 4 }))
    expect(at.stage).toBe('growing')
  })

  it('treats a brand new client without publish auth as starting, not paused', () => {
    const result = computeStage(
      sig({ hasPublishAuth: false, publishAuthLost: undefined }),
    )
    expect(result.stage).toBe('starting')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('returns mature when all three mature thresholds are met', () => {
    const result = computeStage(matureSignals)
    expect(result.stage).toBe('mature')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('returns growing when consecutiveOnTimeWeeks is 11 (one below mature)', () => {
    const result = computeStage(
      sig({
        consecutiveOnTimeWeeks: 11,
        receiptsPerFormatMax: 10,
        consecutivePeriodsAtThreshold: 2,
      }),
    )
    expect(result.stage).toBe('growing')
  })

  it('returns growing when receiptsPerFormatMax is 9 (one below mature)', () => {
    const result = computeStage(
      sig({
        consecutiveOnTimeWeeks: 12,
        receiptsPerFormatMax: 9,
        consecutivePeriodsAtThreshold: 2,
      }),
    )
    expect(result.stage).toBe('growing')
  })

  it('returns growing when consecutivePeriodsAtThreshold is 1 (one below mature)', () => {
    const result = computeStage(
      sig({
        consecutiveOnTimeWeeks: 12,
        receiptsPerFormatMax: 10,
        consecutivePeriodsAtThreshold: 1,
      }),
    )
    expect(result.stage).toBe('growing')
  })

  it('returns growing when content is abundant but receiptsPerFormatMax is 9', () => {
    const result = computeStage(
      sig({
        factCount: 100,
        verifiedAssetCount: 100,
        consecutiveOnTimeWeeks: 20,
        receiptsPerFormatMax: 9,
        consecutivePeriodsAtThreshold: 5,
      }),
    )
    expect(result.stage).toBe('growing')
  })

  it('returns growing when receipts and periods are abundant but weeks is 11', () => {
    const result = computeStage(
      sig({
        factCount: 100,
        verifiedAssetCount: 100,
        consecutiveOnTimeWeeks: 11,
        receiptsPerFormatMax: 50,
        consecutivePeriodsAtThreshold: 5,
      }),
    )
    expect(result.stage).toBe('growing')
  })

  it('returns paused when the circuit breaker is tripped even with mature signals', () => {
    const result = computeStage(sig({ ...matureSignals, circuitBreakerTripped: true }))
    expect(result.stage).toBe('paused')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('returns paused when a complaint spike is detected even with mature signals', () => {
    const result = computeStage(sig({ ...matureSignals, complaintSpike: true }))
    expect(result.stage).toBe('paused')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('returns paused when publish auth was lost even with mature signals', () => {
    const result = computeStage(
      sig({ ...matureSignals, hasPublishAuth: true, publishAuthLost: true }),
    )
    expect(result.stage).toBe('paused')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('returns paused (not starting) when the breaker is tripped on a brand new client', () => {
    const result = computeStage(
      sig({ hasPublishAuth: false, factCount: 0, circuitBreakerTripped: true }),
    )
    expect(result.stage).toBe('paused')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('reports one paused reason per triggered condition', () => {
    const result = computeStage(
      sig({ ...matureSignals, circuitBreakerTripped: true, complaintSpike: true }),
    )
    expect(result.stage).toBe('paused')
    expect(result.reasons).toHaveLength(2)
  })

  it('treats NaN factCount as 0 and returns starting', () => {
    const result = computeStage(sig({ factCount: Number.NaN }))
    expect(result.stage).toBe('starting')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('exposes the documented stage thresholds', () => {
    expect(STAGE_THRESHOLDS).toEqual({
      minFactCount: 20,
      minVerifiedAssetCount: 15,
      minOnTimeWeeksToLeaveStarting: 4,
      matureOnTimeWeeks: 12,
      minReceiptsPerFormat: 10,
      matureConsecutivePeriods: 2,
    })
  })
})
