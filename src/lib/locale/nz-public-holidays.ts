// Used for working-day maths in bookings. src/lib/locale/calendar.ts is the marketing
// calendar and keeps raw dates; do not merge them without checking marketing callers.
/**
 * New Zealand NATIONAL public holidays, as a working-day table.
 *
 * Scope: national public holidays only. Regional anniversary days
 * (Auckland, Wellington, Canterbury, ...) are deliberately NOT included,
 * because they depend on where the person is, and this table is used to
 * decide whether a payment due date lands on a working day.
 *
 * The table only covers the years listed in NZ_HOLIDAY_TABLE_YEARS. A
 * weekday in a year outside the table is reported as 'table_missing' and
 * NEVER silently treated as a working day: a missing year would otherwise
 * make due dates look earlier than they really are.
 *
 * Matariki is the only holiday that cannot be computed from a rule, so its
 * official dates are listed explicitly and MUST be extended each year from
 * the official Matariki schedule.
 *
 * Pure: no I/O, no clock reads, no global mutable state.
 */

/** Years this table knows about. Extend when a new year is published. */
export const NZ_HOLIDAY_TABLE_YEARS: readonly number[] = [2026, 2027]

/** What a given calendar day is, for working-day purposes. */
export type NzDayStatus = 'working' | 'weekend' | 'holiday' | 'table_missing'

/**
 * Official Matariki dates, published by the New Zealand government.
 * Only the years in NZ_HOLIDAY_TABLE_YEARS are listed.
 */
const MATARIKI_DATES: ReadonlyMap<number, string> = new Map([
  [2026, '2026-07-10'],
  [2027, '2027-06-25'],
])

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Strict YYYY-MM-DD that is also a real calendar date. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function assertIsoDate(value: string): void {
  if (!isIsoDate(value)) throw new Error('invalid_iso_date')
}

function toUtcMs(iso: string): number {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  return Date.UTC(year, month - 1, day)
}

function fromUtcMs(ms: number): string {
  const date = new Date(ms)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** UTC date arithmetic; negative days are allowed. */
export function addDaysIso(iso: string, days: number): string {
  assertIsoDate(iso)
  return fromUtcMs(toUtcMs(iso) + days * MS_PER_DAY)
}

/** Whole days from `fromIso` to `toIso` (toIso - fromIso). */
export function diffDaysIso(fromIso: string, toIso: string): number {
  assertIsoDate(fromIso)
  assertIsoDate(toIso)
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / MS_PER_DAY)
}

/** 0 = Sunday ... 6 = Saturday. */
export function isoDayOfWeek(iso: string): number {
  assertIsoDate(iso)
  return new Date(toUtcMs(iso)).getUTCDay()
}

function isoFor(year: number, month: number, day: number): string {
  return fromUtcMs(Date.UTC(year, month - 1, day))
}

/** First given weekday (0 = Sunday) on or after the given date. */
function firstWeekdayOnOrAfter(iso: string, weekday: number): string {
  const shift = (weekday - isoDayOfWeek(iso) + 7) % 7
  return addDaysIso(iso, shift)
}

/** Monday on or after the given date. */
function mondayOnOrAfter(iso: string): string {
  return firstWeekdayOnOrAfter(iso, 1)
}

/**
 * Observed date for a fixed-date holiday that is moved when it falls on a
 * weekend: Saturday -> Monday, Sunday -> Monday (or Tuesday when sundayShift is 2).
 */
function observedFixedDate(iso: string, sundayShift: 1 | 2 = 1): string {
  const dow = isoDayOfWeek(iso)
  if (dow === 6) return addDaysIso(iso, 2)
  if (dow === 0) return addDaysIso(iso, sundayShift)
  return iso
}

/** Easter Sunday, anonymous Gregorian (Meeus/Jones/Butcher) algorithm. */
function easterSundayIso(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return isoFor(year, month, day)
}

/**
 * New Year's Day and the day after, with the collision rule: when 1 Jan is
 * Saturday, 1 Jan is observed Monday 3 Jan and 2 Jan (Sunday) is observed
 * Tuesday 4 Jan; when 1 Jan is Sunday, 1 Jan is observed Monday 2 Jan and
 * 2 Jan (Monday) is pushed to Tuesday 3 Jan.
 */
function newYearPair(year: number): Array<[string, string]> {
  const jan1 = isoFor(year, 1, 1)
  const jan2 = isoFor(year, 1, 2)
  const jan1Observed = observedFixedDate(jan1)
  let jan2Observed = observedFixedDate(jan2, 2)
  if (jan2Observed === jan1Observed) {
    jan2Observed = addDaysIso(jan2Observed, 1)
  }
  return [
    [jan1Observed, "New Year's Day"],
    [jan2Observed, 'Day after New Year\u2019s Day'],
  ]
}

/**
 * Christmas Day and Boxing Day, with the collision rule: Christmas Sat ->
 * Mon 27, Boxing Day Sun -> Tue 28; Christmas Sun -> Tue 27, Boxing Day
 * Mon 26 stays; Christmas Fri -> Boxing Day Sat -> Mon 28.
 */
function christmasPair(year: number): Array<[string, string]> {
  const christmas = isoFor(year, 12, 25)
  const boxing = isoFor(year, 12, 26)
  const christmasObserved = observedFixedDate(christmas, 2)
  // No collision branch needed: the Sunday shift of 2 already separates the two days.
  const boxingObserved = observedFixedDate(boxing, 2)
  return [
    [christmasObserved, 'Christmas Day'],
    [boxingObserved, 'Boxing Day'],
  ]
}

function buildHolidays(year: number): ReadonlyMap<string, string> {
  const entries: Array<[string, string]> = []
  entries.push(...newYearPair(year))
  entries.push([observedFixedDate(isoFor(year, 2, 6)), 'Waitangi Day'])
  const easter = easterSundayIso(year)
  entries.push([addDaysIso(easter, -2), 'Good Friday'])
  entries.push([addDaysIso(easter, 1), 'Easter Monday'])
  entries.push([observedFixedDate(isoFor(year, 4, 25)), 'Anzac Day'])
  entries.push([firstWeekdayOnOrAfter(isoFor(year, 6, 1), 1), "King's Birthday"])
  entries.push([addDaysIso(firstWeekdayOnOrAfter(isoFor(year, 10, 1), 1), 21), 'Labour Day'])
  const matariki = MATARIKI_DATES.get(year)
  if (matariki) entries.push([matariki, 'Matariki'])
  entries.push(...christmasPair(year))
  return new Map(entries)
}

/**
 * Observed national holidays for ANY year, computed by the same rules. This is
 * NOT the table the due-date code trusts: Matariki is only present for years in
 * the official-date map, and years outside NZ_HOLIDAY_TABLE_YEARS are not
 * reviewed. Exported so the weekend collision rules can be tested on years
 * where they actually trigger (e.g. 2021, 2022, 2023, 2028).
 */
export function observedHolidaysForYear(year: number): ReadonlyMap<string, string> {
  return buildHolidays(year)
}

/**
 * ISO date -> holiday name for the given year, or null when the year is not
 * covered by NZ_HOLIDAY_TABLE_YEARS.
 */
export function nzPublicHolidays(year: number): ReadonlyMap<string, string> | null {
  if (!NZ_HOLIDAY_TABLE_YEARS.includes(year)) return null
  return buildHolidays(year)
}

/**
 * Working-day status of a calendar day. Weekends are recognised in any year
 * without the table; a weekday outside the table is 'table_missing' and is
 * never silently reported as 'working'.
 */
export function nzDayStatus(iso: string): NzDayStatus {
  assertIsoDate(iso)
  const dow = isoDayOfWeek(iso)
  if (dow === 0 || dow === 6) return 'weekend'
  const year = Number(iso.slice(0, 4))
  const holidays = nzPublicHolidays(year)
  if (!holidays) return 'table_missing'
  return holidays.has(iso) ? 'holiday' : 'working'
}
