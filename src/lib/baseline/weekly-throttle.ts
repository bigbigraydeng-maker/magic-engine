/**
 * Weekly baseline throttle, compared on New Zealand calendar dates.
 *
 * A timestamp delta of 7 × 24h blocks a run that is one minute earlier than
 * last week's clock time (06:01 then 06:00 seven days later). Calendar days
 * in Pacific/Auckland treat those as a full week.
 */

export const NZ_TIMEZONE = 'Pacific/Auckland'
export const MIN_NZ_CALENDAR_DAYS_BETWEEN_RUNS = 7

/** YYYY-MM-DD in Pacific/Auckland. `en-CA` is the locale that emits that order. */
export function nzCalendarDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** Whole NZ calendar days from `earlier` to `later`. Negative if `later` is first. */
export function nzCalendarDaysBetween(earlier: Date, later: Date): number {
  const [ay, am, ad] = nzCalendarDay(earlier).split('-').map(Number)
  const [by, bm, bd] = nzCalendarDay(later).split('-').map(Number)
  const utcA = Date.UTC(ay, am - 1, ad)
  const utcB = Date.UTC(by, bm - 1, bd)
  return Math.round((utcB - utcA) / 86_400_000)
}

export function shouldSkipWeeklyBaseline(lastStartedAt: Date, now: Date): boolean {
  return nzCalendarDaysBetween(lastStartedAt, now) < MIN_NZ_CALENDAR_DAYS_BETWEEN_RUNS
}
