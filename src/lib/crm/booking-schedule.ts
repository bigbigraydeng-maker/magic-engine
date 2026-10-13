/**
 * L1 generic layer: milestone due-date computation for a booking.
 *
 * Pure: no I/O, no clock reads, no global mutable state. The rule shape comes
 * from the industry layer; the numbers come from client configuration. This
 * file knows neither clients nor industries.
 *
 * Due dates are computed on read, never stored, so there is no cache to
 * expire and no daily refresh job.
 */

import type { TravelBookingRule } from './industry/travel-booking-rule'
import {
  addDaysIso,
  diffDaysIso,
  isIsoDate,
  nzDayStatus,
} from '../locale/nz-public-holidays'

/** Everything the computation needs about one booking. */
export interface BookingDueInput {
  /** Booking date, YYYY-MM-DD, NZ date. */
  bookedOn: string
  /** Live catalog departure date; null = not decided yet. */
  departOn: string | null
  /** Live catalog return date, when the catalog has one. */
  returnOn: string | null
  /** Free text such as '16 Days 15 Nights'. */
  durationText: string | null
  /** Staff ticked "this is a cruise" in the "more" section. */
  isCruise: boolean
}

/** Where the tour length came from. */
export type TourDaysSource = 'return_on' | 'duration_text' | 'unknown'

/** The computed due dates for one booking. */
export interface DueDates {
  /** 'full_payment': the balance date is merged into the deposit date. */
  mode: 'split' | 'full_payment'
  depositDueOn: string
  /** Equals depositDueOn when mode is 'full_payment'. */
  balanceDueOn: string
  /** The balance lead actually used, in calendar days. */
  leadDays: number
  tier: 'standard' | 'long_or_cruise'
  tourDays: number | null
  tourDaysSource: TourDaysSource
  /** return_on length and duration_text length both known and different. */
  durationMismatch: boolean
  /** True when the balance date was moved off a weekend/holiday. */
  rolledForward: boolean
}

/** Outcome of the computation. */
export type DueDatesResult =
  | { state: 'ok'; dates: DueDates }
  | {
      state: 'holiday_table_missing'
      missingYears: number[]
      provisional: DueDates
    }
  | { state: 'no_departure' }
  | { state: 'invalid_input'; field: string }

/**
 * A standalone 1-3 digit number token (not part of a longer digit run)
 * directly followed by a day unit: days?/d/天/日.
 * The lookbehind and lookahead stop '2026 days' from matching '26 days'.
 */
const DURATION_PATTERN =
  /(?<!\d)(\d{1,3})(?!\d)\s*(?:days?|d(?![a-z])|天|日)/gi

/** Inclusive upper bound for a plausible tour length in days. */
const MAX_TOUR_DAYS = 120

/**
 * First plausible day count in the text, or null when there is none.
 * '16 Days 15 Nights' -> 16, '15D/14N' -> 15, '10 day' -> 10, '3天' -> 3,
 * 'Tour 2026 - 16 days' -> 16,
 * '14 nights' / '' / null / 'TBC' / '0 days' / '2026 days' / '200 days'
 * -> null.
 */
export function parseDurationDays(text: string | null): number | null {
  if (text === null) return null
  for (const match of text.matchAll(DURATION_PATTERN)) {
    const days = Number(match[1])
    if (Number.isInteger(days) && days >= 1 && days <= MAX_TOUR_DAYS) {
      return days
    }
  }
  return null
}

/** Mutable accumulator for the years the holiday table does not cover. */
interface MissingYears {
  years: Set<number>
}

function recordMissingYear(missing: MissingYears, iso: string): void {
  missing.years.add(Number(iso.slice(0, 4)))
}

/**
 * Working-day status, treating a weekday in an uncovered year as working but
 * recording that year so the caller can report a missing table.
 */
function statusFor(
  iso: string,
  missing: MissingYears,
): 'working' | 'weekend' | 'holiday' {
  const status = nzDayStatus(iso)
  if (status === 'table_missing') {
    recordMissingYear(missing, iso)
    return 'working'
  }
  return status
}

/** The Nth working day strictly after `fromIso`; the start day never counts. */
function nthWorkingDayAfter(
  fromIso: string,
  count: number,
  missing: MissingYears,
): string {
  let cursor = fromIso
  let remaining = count
  while (remaining > 0) {
    cursor = addDaysIso(cursor, 1)
    if (statusFor(cursor, missing) === 'working') remaining -= 1
  }
  return cursor
}

/** Tour length from the return date, inclusive of both ends. */
function tourDaysFromReturn(departOn: string, returnOn: string): number {
  return diffDaysIso(departOn, returnOn) + 1
}

interface TourLength {
  tourDays: number | null
  tourDaysSource: TourDaysSource
  durationMismatch: boolean
}

/** Resolve the tour length, preferring the return date over free text. */
function resolveTourLength(
  departOn: string,
  returnOn: string | null,
  durationText: string | null,
): TourLength {
  const fromText = parseDurationDays(durationText)
  if (returnOn !== null) {
    const fromReturn = tourDaysFromReturn(departOn, returnOn)
    return {
      tourDays: fromReturn,
      tourDaysSource: 'return_on',
      durationMismatch: fromText !== null && fromText !== fromReturn,
    }
  }
  if (fromText !== null) {
    return {
      tourDays: fromText,
      tourDaysSource: 'duration_text',
      durationMismatch: false,
    }
  }
  return { tourDays: null, tourDaysSource: 'unknown', durationMismatch: false }
}

interface TierChoice {
  tier: 'standard' | 'long_or_cruise'
  leadDays: number
}

/** Cruise or a long enough tour uses the long lead; unknown length is standard. */
function chooseTier(
  rule: TravelBookingRule,
  tourDays: number | null,
  isCruise: boolean,
): TierChoice {
  const isLong =
    isCruise || (tourDays !== null && tourDays >= rule.longTourMinDays)
  if (isLong) {
    return {
      tier: 'long_or_cruise',
      leadDays: rule.balanceLeadDays.longOrCruise,
    }
  }
  return { tier: 'standard', leadDays: rule.balanceLeadDays.standard }
}

/**
 * Move the balance date forward off weekends/holidays, one day at a time,
 * but never past the day before departure. `rolledForward` is true only
 * when the returned date differs from the input date.
 */
function rollForwardCapped(
  balanceDueOn: string,
  departOn: string,
  missing: MissingYears,
): { balanceDueOn: string; rolledForward: boolean } {
  const latest = addDaysIso(departOn, -1)
  let cursor = balanceDueOn
  while (statusFor(cursor, missing) !== 'working' && cursor < latest) {
    cursor = addDaysIso(cursor, 1)
  }
  return { balanceDueOn: cursor, rolledForward: cursor !== balanceDueOn }
}

/** Clamp an ISO date to at most `upper`. */
function clampAtMost(iso: string, upper: string): string {
  return iso > upper ? upper : iso
}

/** Clamp an ISO date to at least `lower`. */
function clampAtLeast(iso: string, lower: string): string {
  return iso < lower ? lower : iso
}

interface ValidatedInput {
  bookedOn: string
  departOn: string
  returnOn: string | null
}

/** Validate the dates; returns the offending field name when invalid. */
function validateInput(
  input: BookingDueInput,
): ValidatedInput | { field: string } {
  if (!isIsoDate(input.bookedOn)) return { field: 'bookedOn' }
  if (input.departOn !== null && !isIsoDate(input.departOn)) {
    return { field: 'departOn' }
  }
  if (input.returnOn !== null && !isIsoDate(input.returnOn)) {
    return { field: 'returnOn' }
  }
  if (input.departOn === null) return { field: 'departOn' }
  if (
    input.returnOn !== null &&
    diffDaysIso(input.departOn, input.returnOn) < 0
  ) {
    return { field: 'returnOn' }
  }
  return {
    bookedOn: input.bookedOn,
    departOn: input.departOn,
    returnOn: input.returnOn,
  }
}

/** Build the dates once the deposit date and the tier are known. */
function assembleDates(
  rule: TravelBookingRule,
  valid: ValidatedInput,
  depositDueOn: string,
  tier: TierChoice,
  length: TourLength,
  missing: MissingYears,
): DueDates {
  const rawBalance = addDaysIso(valid.departOn, -tier.leadDays)
  const rolled = rule.balanceRollForward
    ? rollForwardCapped(rawBalance, valid.departOn, missing)
    : { balanceDueOn: rawBalance, rolledForward: false }
  const balanceDueOn = rolled.balanceDueOn
  const tooClose =
    balanceDueOn <= depositDueOn || balanceDueOn <= valid.bookedOn
  if (tooClose) {
    const latest = addDaysIso(valid.departOn, -1)
    const due = clampAtLeast(clampAtMost(depositDueOn, latest), valid.bookedOn)
    return {
      mode: 'full_payment',
      depositDueOn: due,
      balanceDueOn: due,
      leadDays: tier.leadDays,
      tier: tier.tier,
      tourDays: length.tourDays,
      tourDaysSource: length.tourDaysSource,
      durationMismatch: length.durationMismatch,
      rolledForward: false,
    }
  }
  return {
    mode: 'split',
    depositDueOn,
    balanceDueOn,
    leadDays: tier.leadDays,
    tier: tier.tier,
    tourDays: length.tourDays,
    tourDaysSource: length.tourDaysSource,
    durationMismatch: length.durationMismatch,
    rolledForward: rolled.rolledForward,
  }
}

/**
 * Compute the deposit and balance due dates for one booking.
 *
 * The deposit is the Nth working day after the booking day (the booking day
 * itself never counts). The balance is the departure date minus the tier lead
 * in calendar days (rolled forward off weekends/holidays when configured,
 * never past the day before departure). When the (rolled) balance falls on or
 * before the deposit date or the booking day, the two dates merge into a single
 * "pay in full" date: the deposit date, clamped to the day before departure
 * and to no earlier than the booking day.
 */
export function computeMilestoneDueDates(
  rule: TravelBookingRule,
  input: BookingDueInput,
): DueDatesResult {
  const validated = validateInput(input)
  if ('field' in validated) {
    if (validated.field === 'departOn' && input.departOn === null) {
      return { state: 'no_departure' }
    }
    return { state: 'invalid_input', field: validated.field }
  }
  const missing: MissingYears = { years: new Set() }
  const depositDueOn = nthWorkingDayAfter(
    validated.bookedOn,
    rule.depositDueWorkingDays,
    missing,
  )
  const length = resolveTourLength(
    validated.departOn,
    validated.returnOn,
    input.durationText,
  )
  const tier = chooseTier(rule, length.tourDays, input.isCruise)
  const dates = assembleDates(
    rule,
    validated,
    depositDueOn,
    tier,
    length,
    missing,
  )
  if (missing.years.size === 0) return { state: 'ok', dates }
  return {
    state: 'holiday_table_missing',
    missingYears: [...missing.years].sort((a, b) => a - b),
    provisional: dates,
  }
}

/** Outcome of the deposit-only computation (no departure needed). */
export type DepositOnlyResult =
  | { state: 'ok'; depositDueOn: string }
  | { state: 'holiday_table_missing'; depositDueOn: string; missingYears: number[] }
  | { state: 'invalid_input' }

/**
 * Compute just the deposit due date from the booking date and the rule.
 *
 * The deposit is the Nth working day after the booking day (the booking day
 * itself never counts). It depends only on the booking date and the rule,
 * never on a departure — so it is available even when no departure is set.
 */
export function computeDepositDueOnly(
  rule: TravelBookingRule,
  bookedOn: string,
): DepositOnlyResult {
  if (!isIsoDate(bookedOn)) return { state: 'invalid_input' }
  const missing: MissingYears = { years: new Set() }
  const depositDueOn = nthWorkingDayAfter(
    bookedOn,
    rule.depositDueWorkingDays,
    missing,
  )
  if (missing.years.size === 0) return { state: 'ok', depositDueOn }
  return {
    state: 'holiday_table_missing',
    depositDueOn,
    missingYears: [...missing.years].sort((a, b) => a - b),
  }
}
