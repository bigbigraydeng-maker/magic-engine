import { describe, expect, it } from 'vitest'
import { formatCount, formatSeats, formatSendDate, formatShortDate } from '../format'

describe('formatSendDate', () => {
  it('formats dates with the correct weekday', () => {
    expect(formatSendDate('2026-12-02')).toBe('12月2日（周三）')
    expect(formatSendDate('2027-01-06')).toBe('1月6日（周三）')
    expect(formatSendDate('2027-02-03')).toBe('2月3日（周三）')
    expect(formatSendDate('2026-11-29')).toBe('11月29日（周日）')
    expect(formatSendDate('2026-11-30')).toBe('11月30日（周一）')
  })

  it('does not add leading zeros to month or day', () => {
    expect(formatSendDate('2027-03-04').startsWith('3月4日')).toBe(true)
  })

  it('returns invalid input unchanged', () => {
    for (const input of ['2026-02-30', '2026-13-01', '', 'abc', '2026-12-2']) {
      expect(formatSendDate(input)).toBe(input)
    }
  })
})

describe('formatShortDate', () => {
  it('formats a valid date without the weekday', () => {
    expect(formatShortDate('2026-12-02')).toBe('12月2日')
  })

  it('returns invalid input unchanged', () => {
    for (const input of ['2026-02-30', '2026-13-01', '', 'abc', '2026-12-2']) {
      expect(formatShortDate(input)).toBe(input)
    }
  })
})

describe('formatCount', () => {
  it('formats null with an em dash', () => {
    expect(formatCount(null)).toBe('—')
  })

  it('formats numbers without leading zeros', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(21)).toBe('21')
  })
})

describe('formatSeats', () => {
  it('formats null with an em dash', () => {
    expect(formatSeats(null)).toBe('—')
  })

  it('formats a seat count', () => {
    expect(formatSeats(4)).toBe('4')
  })
})
