import { describe, expect, it } from 'vitest'
import {
  evaluateCircuitBreaker,
  CIRCUIT_BREAKER_MULTIPLIER,
  CIRCUIT_BREAKER_MIN_NONZERO_DAYS,
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
    if (result.tripped === true) {
      expect(result.todayCents).toBe(20000)
      expect(result.multiplier).toBeGreaterThan(CIRCUIT_BREAKER_MULTIPLIER)
      expect(result.reason).toContain('倍')
    }
  })

  it('returns undeterminable with < 5 non-zero days (spec §6.3 #1)', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 99999,
      recentDailySpend: makeHistory([1000, 1000, 1000, 1000]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe('undeterminable')
    if (result.tripped === 'undeterminable') {
      expect(result.reason).toContain('不足')
    }
  })

  it('returns undeterminable when all days are zero', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 5000,
      recentDailySpend: makeHistory([0, 0, 0, 0, 0, 0, 0]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe('undeterminable')
  })

  it('counts only non-zero days for threshold', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 3100,
      recentDailySpend: makeHistory([1000, 0, 1000, 0, 1000, 0, 1000]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe('undeterminable')
  })

  it('correctly handles median with exactly 5 non-zero days', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 3100,
      recentDailySpend: makeHistory([1000, 1000, 1000, 1000, 1000]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe(true)
    if (result.tripped === true) {
      expect(result.medianCents).toBe(1000)
    }
  })

  it('correctly handles even-length non-zero median', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 4600,
      recentDailySpend: makeHistory([1000, 2000, 1000, 2000, 1500, 1500]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe(true)
    if (result.tripped === true) {
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

  it('ignores zero-spend days in median calculation', () => {
    const input: CircuitBreakerInput = {
      clientId: 'test',
      todayTotalSpendCents: 16000,
      recentDailySpend: makeHistory([5000, 0, 5000, 5000, 5000, 0, 5000]),
    }
    const result = evaluateCircuitBreaker(input)
    expect(result.tripped).toBe(true)
    if (result.tripped === true) {
      expect(result.medianCents).toBe(5000)
    }
  })
})
