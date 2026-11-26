import { describe, expect, it } from 'vitest'
import { DistributorTimeError, monthKey, toMs } from '../index'

describe('time helpers', () => {
  it('assigns months by New Zealand local time', () => {
    // 2026-03-31 11:30 UTC = 2026-04-01 00:30 NZDT
    expect(monthKey('2026-03-31T11:30:00Z', 'Pacific/Auckland')).toBe('2026-04')
    expect(monthKey('2026-03-31T10:30:00Z', 'Pacific/Auckland')).toBe('2026-03')
  })

  it('rejects timestamps without an explicit offset', () => {
    expect(() => toMs('2026-03-01T00:00:00')).toThrow(DistributorTimeError)
    expect(() => toMs('not a date Z')).toThrow(DistributorTimeError)
    expect(toMs('2026-03-01T00:00:00+13:00')).toBe(Date.parse('2026-02-28T11:00:00Z'))
  })
})
