/**
 * Tests for src/lib/google-ads/guardrails.ts — P18.B
 */

import { describe, it, expect } from 'vitest'
import {
  checkBudgetWithinSafeRange,
  microsToDisplay,
  MAX_BUDGET_ADJUSTMENT_RATIO,
} from '../guardrails'

describe('checkBudgetWithinSafeRange — Google Ads', () => {
  it('constant MAX_BUDGET_ADJUSTMENT_RATIO is 0.2', () => {
    expect(MAX_BUDGET_ADJUSTMENT_RATIO).toBe(0.2)
  })

  // ── Within range ─────────────────────────────────────────────────────────

  it('ok=true when new budget equals current (no change)', () => {
    expect(checkBudgetWithinSafeRange(5_000_000, 5_000_000).ok).toBe(true)
  })

  it('ok=true for exactly +20% increase', () => {
    const result = checkBudgetWithinSafeRange(5_000_000, 6_000_000)
    expect(result.ok).toBe(true)
  })

  it('ok=true for exactly -20% decrease', () => {
    const result = checkBudgetWithinSafeRange(5_000_000, 4_000_000)
    expect(result.ok).toBe(true)
  })

  it('ok=true for small increase within range', () => {
    const result = checkBudgetWithinSafeRange(10_000_000, 11_000_000)
    expect(result.ok).toBe(true)
  })

  // ── Outside range ────────────────────────────────────────────────────────

  it('ok=false when new budget is more than +20% above current', () => {
    const result = checkBudgetWithinSafeRange(5_000_000, 6_000_001)
    expect(result.ok).toBe(false)
  })

  it('ok=false when new budget is more than -20% below current', () => {
    const result = checkBudgetWithinSafeRange(5_000_000, 3_999_999)
    expect(result.ok).toBe(false)
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('ok=false when currentMicros is 0 (no budget set)', () => {
    expect(checkBudgetWithinSafeRange(0, 1_000_000).ok).toBe(false)
  })

  it('ok=false when currentMicros is negative', () => {
    expect(checkBudgetWithinSafeRange(-1_000_000, 500_000).ok).toBe(false)
  })

  it('ok=false when newMicros is 0', () => {
    expect(checkBudgetWithinSafeRange(5_000_000, 0).ok).toBe(false)
  })

  // ── Allowed range values ──────────────────────────────────────────────────

  it('returns correct allowedMinMicros and allowedMaxMicros', () => {
    const result = checkBudgetWithinSafeRange(5_000_000, 5_000_000)
    expect(result.allowedMinMicros).toBe(Math.floor(5_000_000 * 0.8))
    expect(result.allowedMaxMicros).toBe(Math.ceil(5_000_000 * 1.2))
  })
})

describe('microsToDisplay', () => {
  it('converts 5000000 micros to "$5.00"', () => {
    expect(microsToDisplay(5_000_000)).toBe('$5.00')
  })

  it('converts 1000000 micros to "$1.00"', () => {
    expect(microsToDisplay(1_000_000)).toBe('$1.00')
  })

  it('converts 500000 micros to "$0.50"', () => {
    expect(microsToDisplay(500_000)).toBe('$0.50')
  })

  it('converts 0 to "$0.00"', () => {
    expect(microsToDisplay(0)).toBe('$0.00')
  })
})
