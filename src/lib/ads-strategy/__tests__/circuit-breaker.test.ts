import { describe, expect, it } from 'vitest'
import {
  evaluateCircuitBreaker,
  CIRCUIT_BREAKER_MULTIPLIER,
  type CircuitBreakerInput,
  type DailySpendEntry,
} from '../circuit-breaker'

function makeHistory(cents: number[], startDate = '2026-09-18'): DailySpendEntry[] {
  return cents.map((c, i) => ({
    date: `2026-09-${18 + i}`,
    totalSpendCents: c,
  }))
}

describe('evaluateCircuitBreaker', () => {
  it('does not trip when today is within 3x median', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 10000,
      recentDailySpend: makeHistory([5000, 5000, 5000, 4000, 4000, 5000, 6000]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe(false)
  })

  it('trips when today exceeds 3x median', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 20000,
      recentDailySpend: makeHistory([5000, 5000, 5000, 4000, 4000, 5000, 6000]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe(true)
    if (result.tripped) {
      expect(result.todayCents).toBe(20000)
      expect(result.multiplier).toBeGreaterThan(CIRCUIT_BREAKER_MULTIPLIER)
      expect(result.reason).toContain('倍')
    }
  })

  it('does not trip with insufficient history (< 3 days)', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 99999,
      recentDailySpend: makeHistory([1000, 1000]),
    }
    expect(evaluateCircuitBreaker(input).tripped).toBe(false)
  })

  it('does not trip when median is zero', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 5000,
      recentDailySpend: makeHistory([0, 0, 0, 0, 0, 0, 0]),
    }
    expect(evaluateCircuitBreaker(input).tripped).toBe(false)
  })

  it('correctly handles odd-length median', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 3100,
      recentDailySpend: makeHistory([1000, 1000, 1000]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe(true)
    if (result.tripped) {
      expect(result.medianCents).toBe(1000)
    }
  })

  it('correctly handles even-length median', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 4600,
      recentDailySpend: makeHistory([1000, 2000, 1000, 2000]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe(true)
    if (result.tripped) {
      expect(result.medianCents).toBe(1500)
    }
  })

  it('exactly at 3x does not trip (must exceed)', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 15000,
      recentDailySpend: makeHistory([5000, 5000, 5000, 5000, 5000]),
    }
    expect(evaluateCircuitBreaker(input).tripped).toBe(false)
  })
})
