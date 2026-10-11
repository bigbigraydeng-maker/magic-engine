/**
 * Read the travel booking schedule rule out of a client's `leads_config` JSON.
 *
 * The rule shape lives in `industry/travel-booking-rule.ts`; this file only
 * validates the wire format and maps it to the camelCase shape. Every number
 * comes from the config, so there are no defaults here.
 *
 * Validation FAILS CLOSED: anything we cannot fully understand is reported as
 * `invalid` (with every problem we found) rather than silently defaulted. A
 * booking schedule that quietly falls back to made-up numbers would send real
 * deposit and balance dates to real customers.
 */

import type { HolidayRegion, TravelBookingRule } from './industry/travel-booking-rule'
import { TRAVEL_RULE_FIELD_KEYS } from './industry/travel-booking-rule'

/** Outcome of reading the booking schedule config. */
export type BookingConfigResult =
  | { state: 'ready'; rule: TravelBookingRule }
  | { state: 'disabled' }
  | { state: 'missing' }
  | { state: 'invalid'; problems: string[] }

/** The only holiday region we support today. */
const SUPPORTED_HOLIDAY_REGION: HolidayRegion = 'NZ'

/** Inclusive integer bounds for each numeric field. */
const DEPOSIT_DUE_WORKING_DAYS_MIN = 1
const DEPOSIT_DUE_WORKING_DAYS_MAX = 30
const BALANCE_LEAD_DAYS_MIN = 1
const BALANCE_LEAD_DAYS_MAX = 365
const LONG_TOUR_MIN_DAYS_MIN = 1
const LONG_TOUR_MIN_DAYS_MAX = 120

/** Is this a plain object (not null, not an array)? */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Is this an integer within the inclusive bounds? */
function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/** Collect problems for keys we do not recognise. */
function collectUnknownKeyProblems(raw: Record<string, unknown>, problems: string[]): void {
  for (const key of Object.keys(raw)) {
    if (!TRAVEL_RULE_FIELD_KEYS.includes(key)) {
      problems.push(`unknown_key:${key}`)
    }
  }
}

/** Validate `balance_lead_days` and push any problems found. */
function validateBalanceLeadDays(value: unknown, problems: string[]): void {
  if (!isPlainObject(value)) {
    problems.push('balance_lead_days')
    return
  }
  const keys = Object.keys(value)
  for (const key of keys) {
    if (key !== 'standard' && key !== 'long_or_cruise') {
      problems.push(`unknown_key:balance_lead_days.${key}`)
    }
  }
  if (!('standard' in value)) problems.push('balance_lead_days.standard')
  if (!('long_or_cruise' in value)) problems.push('balance_lead_days.long_or_cruise')
  const standard = value.standard
  const longOrCruise = value.long_or_cruise
  if (!isIntegerInRange(standard, BALANCE_LEAD_DAYS_MIN, BALANCE_LEAD_DAYS_MAX)) {
    problems.push('balance_lead_days.standard')
  }
  if (!isIntegerInRange(longOrCruise, BALANCE_LEAD_DAYS_MIN, BALANCE_LEAD_DAYS_MAX)) {
    problems.push('balance_lead_days.long_or_cruise')
  }
  if (
    isIntegerInRange(standard, BALANCE_LEAD_DAYS_MIN, BALANCE_LEAD_DAYS_MAX) &&
    isIntegerInRange(longOrCruise, BALANCE_LEAD_DAYS_MIN, BALANCE_LEAD_DAYS_MAX) &&
    longOrCruise < standard
  ) {
    problems.push('balance_lead_days.long_or_cruise')
  }
}

/** Validate every field of an enabled rule and push any problems found. */
function validateEnabledRule(raw: Record<string, unknown>, problems: string[]): void {
  if (!isIntegerInRange(raw.deposit_due_working_days, DEPOSIT_DUE_WORKING_DAYS_MIN, DEPOSIT_DUE_WORKING_DAYS_MAX)) {
    problems.push('deposit_due_working_days')
  }
  validateBalanceLeadDays(raw.balance_lead_days, problems)
  if (!isIntegerInRange(raw.long_tour_min_days, LONG_TOUR_MIN_DAYS_MIN, LONG_TOUR_MIN_DAYS_MAX)) {
    problems.push('long_tour_min_days')
  }
  if (raw.holiday_region !== SUPPORTED_HOLIDAY_REGION) {
    problems.push('holiday_region')
  }
  if (typeof raw.balance_roll_forward !== 'boolean') {
    problems.push('balance_roll_forward')
  }
}

/** Map a fully validated raw object to the camelCase rule shape. */
function toRule(raw: Record<string, unknown>): TravelBookingRule {
  const balanceLeadDays = raw.balance_lead_days as Record<string, unknown>
  return {
    depositDueWorkingDays: raw.deposit_due_working_days as number,
    balanceLeadDays: {
      standard: balanceLeadDays.standard as number,
      longOrCruise: balanceLeadDays.long_or_cruise as number,
    },
    longTourMinDays: raw.long_tour_min_days as number,
    holidayRegion: raw.holiday_region as HolidayRegion,
    balanceRollForward: raw.balance_roll_forward as boolean,
  }
}

/**
 * Read `leadsConfig.booking_schedule` and validate it strictly.
 *
 * Never throws: any shape we cannot fully understand comes back as `invalid`
 * with every problem we found, so the caller can surface them all at once.
 */
export function readBookingScheduleConfig(leadsConfig: unknown): BookingConfigResult {
  if (!isPlainObject(leadsConfig)) return { state: 'missing' }
  const raw = leadsConfig.booking_schedule
  if (raw === undefined || raw === null) return { state: 'missing' }
  if (!isPlainObject(raw)) return { state: 'invalid', problems: ['booking_schedule'] }

  if (typeof raw.enabled !== 'boolean') {
    return { state: 'invalid', problems: ['enabled'] }
  }
  if (raw.enabled === false) return { state: 'disabled' }

  const problems: string[] = []
  collectUnknownKeyProblems(raw, problems)
  validateEnabledRule(raw, problems)
  if (problems.length > 0) return { state: 'invalid', problems }

  return { state: 'ready', rule: toRule(raw) }
}
