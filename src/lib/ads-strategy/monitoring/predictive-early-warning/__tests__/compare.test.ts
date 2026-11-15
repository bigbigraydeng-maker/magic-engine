import { describe, expect, it } from 'vitest'
import {
  averageBaselineCpr,
  evaluateEntityEarlyWarning,
  isOverThreshold,
} from '../compare'
import { DEFAULT_MIN_SPEND_MAJOR } from '../switch'

const BASELINE = [
  { spendMajor: 50, resultCount: 5 },
  { spendMajor: 40, resultCount: 4 },
  { spendMajor: 30, resultCount: 3 },
]

describe('predictive early warning compare', () => {
  it('averages only days with results', () => {
    const r = averageBaselineCpr([
      { spendMajor: 40, resultCount: 4 },
      { spendMajor: 20, resultCount: 0 },
      { spendMajor: 30, resultCount: 3 },
    ])
    expect(r).toEqual({ avg: 10, usedDays: 2 })
  })

  it('threshold: zero-results over floor, and >20% vs baseline', () => {
    expect(isOverThreshold(null, 10, true)).toBe(true)
    expect(isOverThreshold(12, 10, false)).toBe(false)
    expect(isOverThreshold(12.01, 10, false)).toBe(true)
  })

  it('evaluate: floor, zero results, baseline, idempotency', () => {
    expect(
      evaluateEntityEarlyWarning({
        entityId: 'as_1',
        level: 'adset',
        metric: 'leads',
        today: { spendMajor: 19.99, resultCount: 0 },
        baselineDays: BASELINE,
        minSpendMajor: DEFAULT_MIN_SPEND_MAJOR,
        accountDay: '2026-11-15',
        priorAlertCprMajor: null,
      }),
    ).toEqual({ alert: false, skip: 'below_spend_floor' })

    const zero = evaluateEntityEarlyWarning({
      entityId: 'as_1',
      level: 'adset',
      metric: 'leads',
      today: { spendMajor: 25, resultCount: 0 },
      baselineDays: BASELINE,
      minSpendMajor: DEFAULT_MIN_SPEND_MAJOR,
      accountDay: '2026-11-15',
      priorAlertCprMajor: null,
    })
    expect(zero).toMatchObject({ alert: true, zeroResults: true })

    expect(
      evaluateEntityEarlyWarning({
        entityId: 'as_4',
        level: 'adset',
        metric: 'leads',
        today: { spendMajor: 50, resultCount: 2 },
        baselineDays: [{ spendMajor: 20, resultCount: 4 }],
        minSpendMajor: DEFAULT_MIN_SPEND_MAJOR,
        accountDay: '2026-11-15',
        priorAlertCprMajor: 24,
      }),
    ).toEqual({ alert: false, skip: 'already_alerted_stable' })
  })
})