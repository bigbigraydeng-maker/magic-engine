import { describe, expect, it } from 'vitest'
import {
  averageBaselineCpr,
  costPerResultMajor,
  evaluateEntityEarlyWarning,
  isOverThreshold,
  shouldReAlert,
} from '../compare'
import { DEFAULT_MIN_SPEND_MAJOR } from '../switch'

describe('costPerResultMajor', () => {
  it('returns null for zero results', () => {
    expect(costPerResultMajor(50, 0)).toBeNull()
  })
})

describe('averageBaselineCpr', () => {
  it('ignores days with zero results and averages the rest', () => {
    const r = averageBaselineCpr([
      { spendMajor: 40, resultCount: 4 },
      { spendMajor: 20, resultCount: 0 },
      { spendMajor: 30, resultCount: 3 },
    ])
    expect(r.usedDays).toBe(2)
    expect(r.avg).toBe(10)
  })

  it('returns null when no usable days', () => {
    expect(averageBaselineCpr([{ spendMajor: 10, resultCount: 0 }]).avg).toBeNull()
  })
})

describe('isOverThreshold', () => {
  it('flags zero results once spend floor met', () => {
    expect(isOverThreshold(null, 10, true)).toBe(true)
  })

  it('requires strictly more than 20% above baseline', () => {
    expect(isOverThreshold(12, 10, false)).toBe(false)
    expect(isOverThreshold(12.01, 10, false)).toBe(true)
  })
})

describe('shouldReAlert', () => {
  it('blocks duplicate unless materially worse', () => {
    expect(shouldReAlert(15, 14.5, false)).toBe(false)
    expect(shouldReAlert(16, 14.5, false)).toBe(true)
  })
})

describe('evaluateEntityEarlyWarning', () => {
  const baseline = [
    { spendMajor: 50, resultCount: 5 },
    { spendMajor: 40, resultCount: 4 },
    { spendMajor: 30, resultCount: 3 },
  ]

  it('waits until min spend floor', () => {
    const v = evaluateEntityEarlyWarning({
      entityId: 'as_1',
      level: 'adset',
      metric: 'leads',
      today: { spendMajor: 19.99, resultCount: 0 },
      baselineDays: baseline,
      minSpendMajor: DEFAULT_MIN_SPEND_MAJOR,
      accountDay: '2026-11-15',
      priorAlertCprMajor: null,
    })
    expect(v).toEqual({ alert: false, skip: 'below_spend_floor' })
  })

  it('alerts on zero results after floor for lead metric', () => {
    const v = evaluateEntityEarlyWarning({
      entityId: 'as_1',
      level: 'adset',
      metric: 'leads',
      today: { spendMajor: 25, resultCount: 0 },
      baselineDays: baseline,
      minSpendMajor: DEFAULT_MIN_SPEND_MAJOR,
      accountDay: '2026-11-15',
      priorAlertCprMajor: null,
    })
    expect(v.alert).toBe(true)
    if (v.alert) expect(v.zeroResults).toBe(true)
  })

  it('uses messaging metric the same way', () => {
    const v = evaluateEntityEarlyWarning({
      entityId: 'as_2',
      level: 'adset',
      metric: 'messaging',
      today: { spendMajor: 30, resultCount: 1 },
      baselineDays: [{ spendMajor: 20, resultCount: 2 }],
      minSpendMajor: DEFAULT_MIN_SPEND_MAJOR,
      accountDay: '2026-11-15',
      priorAlertCprMajor: null,
    })
    expect(v.alert).toBe(true)
    if (v.alert) expect(v.todayCprMajor).toBe(30)
  })

  it('skips when 7-day baseline missing', () => {
    const v = evaluateEntityEarlyWarning({
      entityId: 'as_3',
      level: 'adset',
      metric: 'leads',
      today: { spendMajor: 40, resultCount: 1 },
      baselineDays: [{ spendMajor: 10, resultCount: 0 }],
      minSpendMajor: DEFAULT_MIN_SPEND_MAJOR,
      accountDay: '2026-11-15',
      priorAlertCprMajor: null,
    })
    expect(v).toEqual({ alert: false, skip: 'no_baseline' })
  })

  it('respects idempotent same-day re-alert gate', () => {
    const v = evaluateEntityEarlyWarning({
      entityId: 'as_4',
      level: 'adset',
      metric: 'leads',
      today: { spendMajor: 50, resultCount: 2 },
      baselineDays: [{ spendMajor: 20, resultCount: 4 }],
      minSpendMajor: DEFAULT_MIN_SPEND_MAJOR,
      accountDay: '2026-11-15',
      priorAlertCprMajor: 24,
    })
    expect(v).toEqual({ alert: false, skip: 'already_alerted_stable' })
  })
})