import { describe, it, expect } from 'vitest'
import { computeGoalPace, type GoalPaceInput } from '../goal-pace'

function base(): GoalPaceInput {
  return {
    targetValue: 200,
    baselineValue: 0,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    today: '2026-09-15',
    actualToDate: 100,
    dailyCapCents: 15000,
    medianCostPerResultCents7d: 1000,
  }
}

describe('computeGoalPace', () => {
  it('on_track: exactly on the linear pace', () => {
    const r = computeGoalPace(base())
    expect(r.expectedToDate).toBe(100)
    expect(r.gapPct).toBe(0)
    expect(r.projectedEnd).toBe(200)
    expect(r.verdict).toBe('on_track')
  })

  it('behind: 30% under the linear pace', () => {
    const r = computeGoalPace({ ...base(), actualToDate: 70 })
    expect(r.gapPct).toBe(-30)
    expect(r.verdict).toBe('behind')
  })

  it('unreachable_within_caps: cap cannot buy the remaining results', () => {
    const r = computeGoalPace({
      ...base(),
      actualToDate: 20,
      dailyCapCents: 1000,
      medianCostPerResultCents7d: 1000,
    })
    expect(r.verdict).toBe('unreachable_within_caps')
    expect(r.reason).toContain('35')
  })

  it('unknown when attribution data is not ready (null actual)', () => {
    const r = computeGoalPace({ ...base(), actualToDate: null })
    expect(r.expectedToDate).toBeNull()
    expect(r.actualToDate).toBeNull()
    expect(r.gapPct).toBeNull()
    expect(r.projectedEnd).toBeNull()
    expect(r.verdict).toBe('unknown')
    expect(r.reason).toContain('归属数据不足')
  })

  it('unknown before the period starts', () => {
    const r = computeGoalPace({ ...base(), today: '2026-08-20' })
    expect(r.verdict).toBe('unknown')
    expect(r.reason).toBe('目标期未开始')
  })

  it('unknown on the first day (too little signal)', () => {
    const r = computeGoalPace({ ...base(), today: '2026-09-01' })
    expect(r.verdict).toBe('unknown')
    expect(r.reason).toContain('第 1 天')
  })

  it('clamps today to periodEnd after the period ends', () => {
    const r = computeGoalPace({ ...base(), today: '2026-10-10', actualToDate: 200 })
    expect(r.expectedToDate).toBe(200)
    expect(r.projectedEnd).toBe(200)
    expect(r.verdict).toBe('on_track')
  })

  it('medianCost 0 must not divide (no NaN, falls through to pace)', () => {
    const r = computeGoalPace({
      ...base(),
      actualToDate: 70,
      medianCostPerResultCents7d: 0,
    })
    expect(r.verdict).toBe('behind')
    expect(r.gapPct).toBe(-30)
    expect(Number.isNaN(r.gapPct as number)).toBe(false)
  })

  it('unknown on an invalid date string', () => {
    const r = computeGoalPace({ ...base(), periodStart: 'not-a-date' })
    expect(r.verdict).toBe('unknown')
    expect(r.reason).toBe('目标期日期无效')
  })

  it('expected <= 0 yields a null gapPct but stays on_track', () => {
    const r = computeGoalPace({
      ...base(),
      targetValue: 0,
      baselineValue: 0,
      actualToDate: 5,
    })
    expect(r.gapPct).toBeNull()
    expect(r.verdict).toBe('on_track')
  })
})

describe('computeGoalPace — 日报数据截止日 / 两个上限数', () => {
  it('dataThrough 比今天早一天 → 速度按有数据的天数算', () => {
    const r = computeGoalPace({ ...base(), today: '2026-09-15', dataThrough: '2026-09-14' })
    // 第 14 天：expected = 200 * 14/30
    expect(r.expectedToDate).toBeCloseTo(93.33, 1)
    expect(r.dataThrough).toBe('2026-09-14')
  })

  it('dataThrough 早于目标期开始 → 未判', () => {
    const r = computeGoalPace({ ...base(), dataThrough: '2026-08-31' })
    expect(r.verdict).toBe('unknown')
  })

  it('不给 dataThrough → 不带新字段', () => {
    const r = computeGoalPace({ ...base(), dailyCapCents: null })
    expect(r.dataThrough).toBeUndefined()
    expect(r.reachableAtCap).toBeUndefined()
  })

  it('到不了时同时给「按上限」和「按实际花费」两个数', () => {
    const r = computeGoalPace({
      ...base(), actualToDate: 0, targetValue: 300, periodStart: '2026-10-25', periodEnd: '2026-11-30',
      today: '2026-10-27', dataThrough: '2026-10-26', dailyCapCents: 15000,
      medianCostPerResultCents7d: 9000, actualDailySpendCents: 27000,
    })
    expect(r.verdict).toBe('unreachable_within_caps')
    expect(r.reachableAtCap).toBe(35)
    expect(r.reachableAtActualSpend).toBe(105)
    expect(r.reason).toContain('按日预算上限')
    expect(r.reason).toContain('实际花费')
  })
})
