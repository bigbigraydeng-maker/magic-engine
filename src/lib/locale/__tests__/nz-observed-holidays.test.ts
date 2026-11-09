import { describe, expect, it } from 'vitest'

import {
  nzDayStatus,
  nzPublicHolidays,
  observedHolidaysForYear,
} from '../nz-public-holidays'

/** True when the observed holiday map for `year` contains `iso`. */
function has(year: number, iso: string): boolean {
  return observedHolidaysForYear(year).has(iso)
}

/** Sorted list of the observed holiday date keys for `year`. */
function names(year: number): string[] {
  return [...observedHolidaysForYear(year).keys()].sort()
}

/** 0 = Sunday ... 6 = Saturday for an ISO date. */
function utcDayOfWeek(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

describe('observedHolidaysForYear weekend collision rules', () => {
  it('moves Waitangi Day and Anzac Day off the weekend in 2021', () => {
    // Waitangi Day 2021 falls on Saturday 6 Feb -> observed Monday 8 Feb.
    expect(has(2021, '2021-02-08')).toBe(true)
    expect(has(2021, '2021-02-06')).toBe(false)
    // Anzac Day 2021 falls on Sunday 25 Apr -> observed Monday 26 Apr.
    expect(has(2021, '2021-04-26')).toBe(true)
    expect(has(2021, '2021-04-25')).toBe(false)
  })

  it('moves Christmas and Boxing Day off the weekend in 2021', () => {
    // Christmas Sat 25 Dec -> Mon 27 Dec; Boxing Day Sun 26 Dec -> Tue 28 Dec.
    expect(has(2021, '2021-12-27')).toBe(true)
    expect(has(2021, '2021-12-28')).toBe(true)
    expect(has(2021, '2021-12-25')).toBe(false)
    expect(has(2021, '2021-12-26')).toBe(false)
  })

  it('moves New Year and the day after off the weekend in 2022', () => {
    // New Year Sat 1 Jan -> Mon 3 Jan; Day after New Year Sun 2 Jan -> Tue 4 Jan.
    expect(has(2022, '2022-01-03')).toBe(true)
    expect(has(2022, '2022-01-04')).toBe(true)
    expect(has(2022, '2022-01-01')).toBe(false)
    expect(has(2022, '2022-01-02')).toBe(false)
  })

  it('handles the Christmas/Boxing Day collision in 2022', () => {
    // Christmas Sun 25 Dec -> Tue 27 Dec; Boxing Day Mon 26 Dec stays.
    expect(has(2022, '2022-12-26')).toBe(true)
    expect(has(2022, '2022-12-27')).toBe(true)
    expect(has(2022, '2022-12-25')).toBe(false)
  })

  it('computes the rule-based holidays for 2022', () => {
    expect(has(2022, '2022-10-24')).toBe(true) // Labour Day
    expect(has(2022, '2022-06-06')).toBe(true) // King's Birthday
    expect(has(2022, '2022-04-15')).toBe(true) // Good Friday
    expect(has(2022, '2022-04-18')).toBe(true) // Easter Monday
  })

  it('pushes the day after New Year in 2023', () => {
    // New Year Sun 1 Jan -> Mon 2 Jan; Day after New Year Mon 2 Jan -> Tue 3 Jan.
    expect(has(2023, '2023-01-02')).toBe(true)
    expect(has(2023, '2023-01-03')).toBe(true)
    expect(has(2023, '2023-01-01')).toBe(false)
  })

  it('moves Boxing Day off the weekend in 2020', () => {
    // Christmas Fri 25 Dec stays; Boxing Day Sat 26 Dec -> Mon 28 Dec.
    expect(has(2020, '2020-12-25')).toBe(true)
    expect(has(2020, '2020-12-28')).toBe(true)
    expect(has(2020, '2020-12-26')).toBe(false)
  })

  it('moves New Year and the day after off the weekend in 2028', () => {
    // New Year Sat 1 Jan -> Mon 3 Jan; Day after New Year Sun 2 Jan -> Tue 4 Jan.
    expect(has(2028, '2028-01-03')).toBe(true)
    expect(has(2028, '2028-01-04')).toBe(true)
    expect(has(2028, '2028-01-01')).toBe(false)
    expect(has(2028, '2028-01-02')).toBe(false)
  })
})

describe('observedHolidaysForYear invariants', () => {
  it('never observes a holiday on a weekend for 2016..2035', () => {
    for (let year = 2016; year <= 2035; year += 1) {
      for (const iso of names(year)) {
        const dow = utcDayOfWeek(iso)
        expect(dow).toBeGreaterThanOrEqual(1)
        expect(dow).toBeLessThanOrEqual(5)
      }
    }
  })

  it('never maps two holidays to the same observed date for 2016..2035', () => {
    for (let year = 2016; year <= 2035; year += 1) {
      const keys = names(year)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

describe('nzPublicHolidays table coverage', () => {
  it('covers only the reviewed years 2026 and 2027', () => {
    expect(nzPublicHolidays(2026)).not.toBeNull()
    expect(nzPublicHolidays(2027)).not.toBeNull()
    expect(nzPublicHolidays(2022)).toBeNull()
    expect(nzPublicHolidays(2028)).toBeNull()
  })
})

describe('nzDayStatus outside the table', () => {
  it('reports a weekday outside the table as table_missing', () => {
    // 2028-01-03 is a Monday but 2028 is not in the reviewed table.
    expect(nzDayStatus('2028-01-03')).toBe('table_missing')
    // 2022-12-27 is a Tuesday but 2022 is not in the reviewed table.
    expect(nzDayStatus('2022-12-27')).toBe('table_missing')
  })
})
