import { describe, expect, it } from 'vitest'

import {
  addDaysIso,
  diffDaysIso,
  isIsoDate,
  isoDayOfWeek,
  nzDayStatus,
  nzPublicHolidays,
} from '../nz-public-holidays'

/** Sorted ISO dates of every holiday in the given year. */
function holidayDates(year: number): string[] {
  const holidays = nzPublicHolidays(year)
  if (!holidays) throw new Error('table_missing')
  return [...holidays.keys()].sort()
}

describe('nzPublicHolidays', () => {
  it('lists exactly the 11 national holidays of 2026', () => {
    expect(holidayDates(2026)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-02-06',
      '2026-04-03',
      '2026-04-06',
      '2026-04-27',
      '2026-06-01',
      '2026-07-10',
      '2026-10-26',
      '2026-12-25',
      '2026-12-28',
    ])
  })

  it('names the 2026 holidays', () => {
    const holidays = nzPublicHolidays(2026)
    expect(holidays?.get('2026-01-01')).toBe("New Year's Day")
    expect(holidays?.get('2026-01-02')).toBe('Day after New Year\u2019s Day')
    expect(holidays?.get('2026-02-06')).toBe('Waitangi Day')
    expect(holidays?.get('2026-04-03')).toBe('Good Friday')
    expect(holidays?.get('2026-04-06')).toBe('Easter Monday')
    expect(holidays?.get('2026-04-27')).toBe('Anzac Day')
    expect(holidays?.get('2026-06-01')).toBe("King's Birthday")
    expect(holidays?.get('2026-07-10')).toBe('Matariki')
    expect(holidays?.get('2026-10-26')).toBe('Labour Day')
    expect(holidays?.get('2026-12-25')).toBe('Christmas Day')
    expect(holidays?.get('2026-12-28')).toBe('Boxing Day')
  })

  it('returns null for a year outside the table', () => {
    expect(nzPublicHolidays(2028)).toBeNull()
  })
})

describe('nzDayStatus', () => {
  it('rolls a Saturday Boxing Day to Monday 28 Dec 2026', () => {
    expect(isoDayOfWeek('2026-12-26')).toBe(6)
    expect(nzDayStatus('2026-12-26')).toBe('weekend')
    expect(nzDayStatus('2026-12-28')).toBe('holiday')
  })

  it('rolls a Saturday Anzac Day to Monday 27 Apr 2026', () => {
    expect(isoDayOfWeek('2026-04-25')).toBe(6)
    expect(nzDayStatus('2026-04-25')).toBe('weekend')
    expect(nzDayStatus('2026-04-27')).toBe('holiday')
  })

  it('treats 2026-06-26 as a normal working day', () => {
    expect(nzDayStatus('2026-06-26')).toBe('working')
  })

  it('reports a weekday in 2028 as table_missing', () => {
    expect(isoDayOfWeek('2028-06-01')).toBe(4)
    expect(nzDayStatus('2028-06-01')).toBe('table_missing')
  })

  it('still recognises a weekend in 2028', () => {
    expect(isoDayOfWeek('2028-06-03')).toBe(6)
    expect(nzDayStatus('2028-06-03')).toBe('weekend')
  })

  it('throws on an invalid ISO date', () => {
    expect(() => nzDayStatus('2027-1-1')).toThrow('invalid_iso_date')
    expect(() => nzDayStatus('2027-02-29')).toThrow('invalid_iso_date')
  })
})

describe('2027 holidays', () => {
  it('rolls Christmas and Boxing Day off the weekend', () => {
    expect(isoDayOfWeek('2027-12-25')).toBe(6)
    expect(nzDayStatus('2027-12-27')).toBe('holiday')
    expect(isoDayOfWeek('2027-12-26')).toBe(0)
    expect(nzDayStatus('2027-12-28')).toBe('holiday')
  })

  it('rolls New Year and the day after off the weekend', () => {
    expect(nzDayStatus('2027-01-01')).toBe('holiday')
    expect(isoDayOfWeek('2027-01-02')).toBe(6)
    expect(nzDayStatus('2027-01-04')).toBe('holiday')
  })

  it('rolls Waitangi Day and Anzac Day off the weekend', () => {
    expect(isoDayOfWeek('2027-02-06')).toBe(6)
    expect(nzDayStatus('2027-02-08')).toBe('holiday')
    expect(isoDayOfWeek('2027-04-25')).toBe(0)
    expect(nzDayStatus('2027-04-26')).toBe('holiday')
  })

  it('places Easter, King\u2019s Birthday, Matariki and Labour Day', () => {
    expect(nzDayStatus('2027-03-26')).toBe('holiday')
    expect(nzDayStatus('2027-03-29')).toBe('holiday')
    expect(nzDayStatus('2027-06-07')).toBe('holiday')
    expect(nzDayStatus('2027-06-25')).toBe('holiday')
    expect(nzDayStatus('2027-10-25')).toBe('holiday')
  })
})

describe('date helpers', () => {
  it('adds and subtracts days across month and year boundaries', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('measures whole days between two dates', () => {
    expect(diffDaysIso('2026-01-01', '2026-01-02')).toBe(1)
    expect(diffDaysIso('2026-01-02', '2026-01-01')).toBe(-1)
    expect(diffDaysIso('2026-01-01', '2026-01-01')).toBe(0)
  })

  it('reports the day of week', () => {
    expect(isoDayOfWeek('2026-01-01')).toBe(4)
    expect(isoDayOfWeek('2026-01-04')).toBe(0)
  })

  it('accepts a real leap day and rejects impossible dates', () => {
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2027-02-29')).toBe(false)
    expect(isIsoDate('2027-1-1')).toBe(false)
    expect(isIsoDate('2027-13-01')).toBe(false)
  })

  it('throws when adding days to an invalid date', () => {
    expect(() => addDaysIso('2027-1-1', 1)).toThrow('invalid_iso_date')
  })
})
