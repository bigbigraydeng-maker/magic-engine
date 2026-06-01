/**
 * TikTok Ads guardrails unit tests — P18.C
 */

import { describe, it, expect } from 'vitest'
import { checkBudgetWithinSafeRange, budgetToDisplay, MAX_BUDGET_ADJUSTMENT_RATIO } from '../guardrails'

describe('checkBudgetWithinSafeRange', () => {
  it('passes when newBudget equals currentBudget (no change)', () => {
    const result = checkBudgetWithinSafeRange(100, 100)
    expect(result.ok).toBe(true)
  })

  it('passes when newBudget is exactly +20% of currentBudget', () => {
    const result = checkBudgetWithinSafeRange(100, 120)
    expect(result.ok).toBe(true)
  })

  it('passes when newBudget is exactly -20% of currentBudget', () => {
    const result = checkBudgetWithinSafeRange(100, 80)
    expect(result.ok).toBe(true)
  })

  it('fails when newBudget is +21% of currentBudget', () => {
    const result = checkBudgetWithinSafeRange(100, 121)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('±20%')
    expect(result.reason).toContain('Talk to Us')
  })

  it('fails when newBudget is -21% of currentBudget', () => {
    const result = checkBudgetWithinSafeRange(100, 79)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('±20%')
  })

  it('returns minBudget and maxBudget even on failure', () => {
    const result = checkBudgetWithinSafeRange(100, 200)
    expect(result.ok).toBe(false)
    expect(result.minBudget).toBeCloseTo(80)
    expect(result.maxBudget).toBeCloseTo(120)
  })

  it('returns minBudget and maxBudget on success', () => {
    const result = checkBudgetWithinSafeRange(50, 55)
    expect(result.ok).toBe(true)
    expect(result.minBudget).toBeCloseTo(40)
    expect(result.maxBudget).toBeCloseTo(60)
  })

  it('fails when currentBudget is zero', () => {
    const result = checkBudgetWithinSafeRange(0, 50)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('zero or negative')
  })

  it('fails when currentBudget is negative', () => {
    const result = checkBudgetWithinSafeRange(-100, 50)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('zero or negative')
  })

  it('fails when newBudget is zero', () => {
    const result = checkBudgetWithinSafeRange(100, 0)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('positive')
  })

  it('fails when newBudget is negative', () => {
    const result = checkBudgetWithinSafeRange(100, -50)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('positive')
  })

  it('MAX_BUDGET_ADJUSTMENT_RATIO is 0.2', () => {
    expect(MAX_BUDGET_ADJUSTMENT_RATIO).toBe(0.2)
  })
})

describe('budgetToDisplay', () => {
  it('formats whole dollar amounts', () => {
    expect(budgetToDisplay(50)).toBe('$50.00')
  })

  it('formats fractional dollar amounts', () => {
    expect(budgetToDisplay(12.5)).toBe('$12.50')
  })

  it('formats zero', () => {
    expect(budgetToDisplay(0)).toBe('$0.00')
  })
})
