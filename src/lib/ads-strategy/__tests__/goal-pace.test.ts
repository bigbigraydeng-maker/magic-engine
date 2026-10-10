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
