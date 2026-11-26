import { describe, expect, it } from 'vitest'
import { nzOffset, parseDollarsToCents, toPaidAt, todayString } from '../shared'

describe('date and money helpers', () => {
  it('uses the real New Zealand offset for summer and winter dates', () => {
    expect(nzOffset('2026-01-15')).toBe('+13:00')
    expect(nzOffset('2026-07-15')).toBe('+12:00')
    expect(toPaidAt('2026-07-15')).toBe('2026-07-15T12:00:00+12:00')
  })

  it('records "today" as now, never in the future', () => {
    const paid = Date.parse(toPaidAt(todayString()))
    expect(paid).toBeLessThanOrEqual(Date.now())
    expect(Date.now() - paid).toBeLessThan(5_000)
  })

  it('converts dollars to cents and rejects zero or junk', () => {
    expect(parseDollarsToCents('799')).toBe(79_900)
    expect(parseDollarsToCents('0.1')).toBe(10)
    expect(parseDollarsToCents('0')).toBeNull()
    expect(parseDollarsToCents('abc')).toBeNull()
  })
})
