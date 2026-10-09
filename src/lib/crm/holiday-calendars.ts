/**
 * Public-holiday calendars, kept as plain data so the business-day logic in
 * `nz-business-days.ts` stays free of any date table.
 *
 * Source: employment.govt.nz public holidays page, read 2026-10-05. Observed
 * (Mondayised) dates that fall on a Saturday/Sunday are listed as the Monday
 * they are taken on. Weekend dates are harmless to list: the business-day check
 * already skips weekends. Re-check once a year and extend the list.
 *
 * Regional anniversary days (e.g. Auckland Anniversary) are deliberately NOT in
 * the national list: they belong to a client/region configuration, not to the
 * shared default.
 */

/** ISO dates (YYYY-MM-DD), New Zealand national public holidays, 2026-2027. */
export const NZ_NATIONAL_HOLIDAYS: readonly string[] = [
  // 2026
  '2026-01-01',
  '2026-01-02',
  '2026-02-06',
  '2026-04-03',
  '2026-04-06',
  '2026-04-27', // Anzac Day (Sat 25 Apr) observed Monday
  '2026-06-01',
  '2026-07-10', // Matariki
  '2026-10-26', // Labour Day
  '2026-12-25',
  '2026-12-28', // Boxing Day (Sat 26 Dec) observed Monday
  // 2027
  '2027-01-01',
  '2027-01-04', // Day after New Year's Day observed Monday
  '2027-02-08', // Waitangi Day (Sat 6 Feb) observed Monday
  '2027-03-26',
  '2027-03-29',
  '2027-04-26', // Anzac Day (Sun 25 Apr) observed Monday
  '2027-06-07',
  '2027-06-25', // Matariki
  '2027-10-25', // Labour Day
  '2027-12-27', // Christmas Day (Sat 25 Dec) observed Monday
  '2027-12-28', // Boxing Day (Sun 26 Dec) observed Tuesday
]

/** IANA time zone the New Zealand business-day count is evaluated in. */
export const NZ_TIME_ZONE = 'Pacific/Auckland'
