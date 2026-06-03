/**
 * Phase 32 — Verdict computation tests
 *
 * Focus: direction-aware progress (increase / decrease) is mathematically correct
 * for the four real-world scenarios (revenue growth / signups / clearance / churn).
 */

import { describe, it, expect } from 'vitest'
import { computeGoalVerdict } from '../verdict'

describe('computeGoalVerdict — direction-agnostic core math', () => {
  it('returns inconclusive when current_value is null', () => {
    const result = computeGoalVerdict({
      baseline_value: 100,
      target_value: 200,
      current_value: null,
    })
    expect(result.verdict).toBe('inconclusive')
    expect(result.progress_pct).toBeNull()
  })

  it('returns inconclusive when baseline equals target', () => {
    const result = computeGoalVerdict({
      baseline_value: 100,
      target_value: 100,
      current_value: 100,
    })
    expect(result.verdict).toBe('inconclusive')
  })
})

describe('computeGoalVerdict — baseline=0 edge cases (P32-B4 product launch)', () => {
  it('CTS 团报名 0 → 30, current 25 = 83% confirmed', () => {
    const result = computeGoalVerdict({
      baseline_value: 0,
      target_value: 30,
      current_value: 25,
    })
    expect(result.verdict).toBe('confirmed')
    expect(result.progress_pct).toBeCloseTo(83.3, 1)
  })

  it('CTS 团报名 0 → 30, current 15 = 50% partial', () => {
    const result = computeGoalVerdict({
      baseline_value: 0,
      target_value: 30,
      current_value: 15,
    })
    expect(result.verdict).toBe('partial')
    expect(result.progress_pct).toBe(50)
  })

  it('CTS 团报名 0 → 30, current 0 = 0% reversed', () => {
    const result = computeGoalVerdict({
      baseline_value: 0,
      target_value: 30,
      current_value: 0,
    })
    expect(result.verdict).toBe('reversed')
    expect(result.progress_pct).toBe(0)
  })
})

describe('computeGoalVerdict — increase direction (default)', () => {
  it('confirms when progress ≥ 80%', () => {
    // CTS sales: 80k → 120k, current 116k = 90% progress
    const result = computeGoalVerdict({
      baseline_value: 80000,
      target_value: 120000,
      current_value: 116000,
    })
    expect(result.verdict).toBe('confirmed')
    expect(result.progress_pct).toBe(90)
  })

  it('partials when 50% ≤ progress < 80%', () => {
    // baseline=0, target=30 signups, current=20 = 67% progress
    const result = computeGoalVerdict({
      baseline_value: 0,
      target_value: 30,
      current_value: 20,
    })
    expect(result.verdict).toBe('partial')
    expect(result.progress_pct).toBeCloseTo(66.7, 1)
  })

  it('reverses when 0 < progress < 50%', () => {
    // 80k → 120k, current only 90k = 25% progress
    const result = computeGoalVerdict({
      baseline_value: 80000,
      target_value: 120000,
      current_value: 90000,
    })
    expect(result.verdict).toBe('reversed')
    expect(result.progress_pct).toBe(25)
  })

  it('reverses when progress is 0 or negative (regression)', () => {
    const result = computeGoalVerdict({
      baseline_value: 80000,
      target_value: 120000,
      current_value: 75000,  // moved backwards
    })
    expect(result.verdict).toBe('reversed')
  })
})

describe('computeGoalVerdict — decrease direction (P32 clearance/churn)', () => {
  it('confirms when inventory cleared ≥ 80%', () => {
    // Oztop Walnut: baseline=500, target=0, current=50 → 90% cleared
    const result = computeGoalVerdict({
      baseline_value: 500,
      target_value: 0,
      current_value: 50,
      target_direction: 'decrease',
    })
    expect(result.verdict).toBe('confirmed')
    expect(result.progress_pct).toBe(90)
  })

  it('confirms when fully cleared (current = target)', () => {
    const result = computeGoalVerdict({
      baseline_value: 500,
      target_value: 0,
      current_value: 0,
      target_direction: 'decrease',
    })
    expect(result.verdict).toBe('confirmed')
    expect(result.progress_pct).toBe(100)
  })

  it('partials when half cleared', () => {
    // baseline=500, target=0, current=250 = 50% cleared
    const result = computeGoalVerdict({
      baseline_value: 500,
      target_value: 0,
      current_value: 250,
      target_direction: 'decrease',
    })
    expect(result.verdict).toBe('partial')
    expect(result.progress_pct).toBe(50)
  })

  it('reverses when little cleared (< 50%)', () => {
    // baseline=500, target=0, current=400 = 20% cleared
    const result = computeGoalVerdict({
      baseline_value: 500,
      target_value: 0,
      current_value: 400,
      target_direction: 'decrease',
    })
    expect(result.verdict).toBe('reversed')
    expect(result.progress_pct).toBe(20)
  })

  it('reverses when nothing cleared (current = baseline)', () => {
    const result = computeGoalVerdict({
      baseline_value: 500,
      target_value: 0,
      current_value: 500,
      target_direction: 'decrease',
    })
    expect(result.verdict).toBe('reversed')
    expect(result.progress_pct).toBe(0)
  })

  it('handles cart abandonment reduction (target != 0)', () => {
    // abandonment 70% → 50% (target), current = 55% = 75% progress
    const result = computeGoalVerdict({
      baseline_value: 70,
      target_value: 50,
      current_value: 55,
      target_direction: 'decrease',
    })
    expect(result.verdict).toBe('partial')
    expect(result.progress_pct).toBe(75)
  })

  it('summary line indicates decrease direction', () => {
    const result = computeGoalVerdict({
      baseline_value: 500,
      target_value: 0,
      current_value: 100,
      target_direction: 'decrease',
    })
    expect(result.summary_line).toContain('(decrease)')
  })
})
