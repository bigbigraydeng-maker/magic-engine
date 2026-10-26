/**
 * L2 industry layer: the SHAPE of a travel booking rule.
 *
 * This file deliberately holds no numbers and no client names. The actual
 * values (deposit windows, balance lead times, holiday calendars) live in the
 * client configuration, so a single rule shape can serve every travel client
 * without a code change.
 */

/** Holiday calendar a rule resolves its working days against. */
export type HolidayRegion = 'NZ'

/** Shape of a travel booking rule as stored in client configuration. */
export interface TravelBookingRule {
  /** Working days after booking before the deposit is due. */
  depositDueWorkingDays: number
  /** Days before departure the balance is due, by trip kind. */
  balanceLeadDays: { standard: number; longOrCruise: number }
  /** Trip length (in days) at or above which `longOrCruise` applies. */
  longTourMinDays: number
  /** Which holiday calendar to use when counting working days. */
  holidayRegion: HolidayRegion
  /** Whether a balance date landing on a holiday rolls forward. */
  balanceRollForward: boolean
}

/**
 * The snake_case JSON keys the client configuration uses for this rule.
 *
 * Kept as a single source so readers and writers of the config agree on the
 * wire format without duplicating string literals.
 */
export const TRAVEL_RULE_FIELD_KEYS: readonly string[] = [
  'enabled',
  'deposit_due_working_days',
  'balance_lead_days',
  'long_tour_min_days',
  'holiday_region',
  'balance_roll_forward',
]
