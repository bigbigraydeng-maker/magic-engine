import { NZ_TIME_ZONE } from './holiday-calendars'

/**
 * Calendar date (YYYY-MM-DD) of `instant` in the given IANA time zone.
 * `en-CA` formats as YYYY-MM-DD directly.
 */
export function nzLocalDate(instant: Date, timeZone: string = NZ_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/**
 * True when `isoDate` is neither a Saturday/Sunday nor a listed holiday.
 * Weekday is derived from the ISO date via UTC to avoid host-timezone drift.
 */
export function isBusinessDay(isoDate: string, holidays: ReadonlySet<string>): boolean {
  const day = new Date(isoDate + 'T00:00:00Z').getUTCDay()
  if (day === 0 || day === 6) return false
  return !holidays.has(isoDate)
}

/** Pure calendar arithmetic on an ISO date, evaluated in UTC. */
export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** First business day strictly after `isoDate`. */
export function nextBusinessDay(isoDate: string, holidays: ReadonlySet<string>): string {
  let candidate = addDaysIso(isoDate, 1)
  while (!isBusinessDay(candidate, holidays)) {
    candidate = addDaysIso(candidate, 1)
  }
  return candidate
}

/**
 * Offset in milliseconds between the given time zone's wall clock and UTC at
 * `instant`. Positive east of UTC (e.g. +12h / +13h for Pacific/Auckland).
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type)
    return part ? Number(part.value) : 0
  }

  const wallClockUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return wallClockUtc - instant.getTime()
}

/**
 * UTC instant at which `isoDate` 00:00:00 begins in `timeZone`, DST-safe.
 * Uses a first guess, then re-checks the offset at the resulting instant.
 */
export function zonedMidnightUtc(isoDate: string, timeZone: string = NZ_TIME_ZONE): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  const firstOffset = zoneOffsetMs(new Date(guess), timeZone)
  const result = guess - firstOffset
  const secondOffset = zoneOffsetMs(new Date(result), timeZone)
  if (secondOffset !== firstOffset) {
    return new Date(guess - secondOffset)
  }
  return new Date(result)
}

/**
 * Due instant for the "reply within 1 business day" promise: the end of the
 * first business day strictly after the local submission date.
 */
export function leadPromiseDueAt(
  submittedAt: Date,
  holidays: ReadonlySet<string>,
  timeZone: string = NZ_TIME_ZONE,
): Date {
  const submittedLocalDate = nzLocalDate(submittedAt, timeZone)
  const dueBusinessDay = nextBusinessDay(submittedLocalDate, holidays)
  return zonedMidnightUtc(addDaysIso(dueBusinessDay, 1), timeZone)
}

/** True when `now` is at or past the promise due instant. */
export function isPastPromiseDue(
  submittedAt: Date,
  now: Date,
  holidays: ReadonlySet<string>,
  timeZone: string = NZ_TIME_ZONE,
): boolean {
  return now.getTime() >= leadPromiseDueAt(submittedAt, holidays, timeZone).getTime()
}
