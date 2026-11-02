import { describe, expect, it } from 'vitest'
import {
  isGoalProgressPending,
  perDayNeededToHitTarget,
  remainingGoalDays,
} from '../goal-progress-display'

describe('isGoalProgressPending', () => {
  it('leads_count is not pending', () => {
    expect(isGoalProgressPending('leads_count')).toBe(false)
  })

  it('signups_count shows 还没设目标 state', () => {
    expect(isGoalProgressPending('signups_count')).toBe(true)
  })

  it('organic_traffic is pending on ads health bar', () => {
    expect(isGoalProgressPending('organic_traffic')).toBe(true)
  })
})

describe('perDayNeededToHitTarget', () => {
  it('distributes remaining gap over remaining days', () => {
    expect(perDayNeededToHitTarget(300, 101, 8, 37)).toBe(Math.ceil((300 - 101) / (37 - 8)))
  })

  it('null done → null', () => {
    expect(perDayNeededToHitTarget(100, null, 5, 30)).toBeNull()
  })

  it('last day of period → null', () => {
    expect(remainingGoalDays(37, 37)).toBe(0)
    expect(perDayNeededToHitTarget(300, 101, 37, 37)).toBeNull()
  })
})
