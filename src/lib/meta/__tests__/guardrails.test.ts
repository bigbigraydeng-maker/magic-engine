/**
 * Tests for meta/guardrails.ts — P18.A
 */

import { describe, it, expect } from 'vitest'
import {
  checkBudgetWithinSafeRange,
  MAX_BUDGET_ADJUSTMENT_RATIO,
} from '../guardrails'

describe('checkBudgetWithinSafeRange', () => {
  it('allows a small change within ±20%', () => {
    // current $50.00 → new $55.00 (+10%)
    expect(checkBudgetWithinSafeRange(5000, 5500).ok).toBe(true)
  })

  it('allows no change', () => {
    expect(checkBudgetWithinSafeRange(5000, 5000).ok).toBe(true)
  })

  it('allows exactly +20%', () => {
    // ceil(5000 * 1.2) = 6000
    expect(checkBudgetWithinSafeRange(5000, 6000).ok).toBe(true)
  })

  it('allows exactly -20%', () => {
    // floor(5000 * 0.8) = 4000
    expect(checkBudgetWithinSafeRange(5000, 4000).ok).toBe(true)
  })

  it('rejects above +20%', () => {
    expect(checkBudgetWithinSafeRange(5000, 6001).ok).toBe(false)
  })

  it('rejects below -20%', () => {
    expect(checkBudgetWithinSafeRange(5000, 3999).ok).toBe(false)
  })

  it('rejects doubling the budget', () => {
    expect(checkBudgetWithinSafeRange(5000, 10000).ok).toBe(false)
  })

  it('returns the allowed band in cents', () => {
    const res = checkBudgetWithinSafeRange(5000, 5500)
    expect(res.allowedMinCents).toBe(4000)
    expect(res.allowedMaxCents).toBe(6000)
  })

  it('rounds the band outward so boundary values pass', () => {
    // current 3333: floor(2666.4)=2666, ceil(3999.6)=4000
    const res = checkBudgetWithinSafeRange(3333, 3333)
    expect(res.allowedMinCents).toBe(2666)
    expect(res.allowedMaxCents).toBe(4000)
    expect(checkBudgetWithinSafeRange(3333, 2666).ok).toBe(true)
    expect(checkBudgetWithinSafeRange(3333, 2665).ok).toBe(false)
    expect(checkBudgetWithinSafeRange(3333, 4000).ok).toBe(true)
    expect(checkBudgetWithinSafeRange(3333, 4001).ok).toBe(false)
  })

  it('forces manual review when current budget is zero', () => {
    const res = checkBudgetWithinSafeRange(0, 100)
    expect(res.ok).toBe(false)
  })

  it('forces manual review when current budget is negative', () => {
    expect(checkBudgetWithinSafeRange(-100, 50).ok).toBe(false)
  })

  it('exposes the ±20% ratio constant', () => {
    expect(MAX_BUDGET_ADJUSTMENT_RATIO).toBe(0.2)
  })
})
