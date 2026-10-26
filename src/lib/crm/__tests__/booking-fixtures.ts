/**
 * Shared constants and row builders for the CRM booking tracker tests.
 *
 * This is NOT a test file (vitest only runs *.test.ts). Rows are snake_case
 * to mirror the database shape returned by Supabase.
 */

import type { TravelBookingRule } from '../industry/travel-booking-rule'
import type { Row } from './booking-fake-db'

export const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const CONTACT_A1 = 'c1a1a1a1-0000-4000-8000-000000000001'
export const CONTACT_A2 = 'c1a1a1a1-0000-4000-8000-000000000002'
export const CONTACT_B1 = 'c1b1b1b1-0000-4000-8000-000000000001'
export const TOUR_A1 = '10000000-0000-4000-8000-0000000000a1'
export const TOUR_B1 = '10000000-0000-4000-8000-0000000000b1'
export const DEP_A1 = '20000000-0000-4000-8000-0000000000a1'
export const DEP_B1 = '20000000-0000-4000-8000-0000000000b1'
export const BOOKING_A1 = '30000000-0000-4000-8000-0000000000a1'
export const BOOKING_A2 = '30000000-0000-4000-8000-0000000000a2'
export const BOOKING_B1 = '30000000-0000-4000-8000-0000000000b1'
export const UPDATED_AT = '2026-10-01T00:00:00.000000+00:00'

/** Test-only numbers; shared runtime code never contains them. */
export const TEST_RULE: TravelBookingRule = {
  depositDueWorkingDays: 3,
  balanceLeadDays: { standard: 90, longOrCruise: 120 },
  longTourMinDays: 16,
  holidayRegion: 'NZ',
  balanceRollForward: false,
}

export const ENABLED_LEADS_CONFIG: Record<string, unknown> = {
  booking_schedule: {
    enabled: true,
    deposit_due_working_days: 3,
    balance_lead_days: { standard: 90, long_or_cruise: 120 },
    long_tour_min_days: 16,
    holiday_region: 'NZ',
    balance_roll_forward: false,
  },
}

export const DISABLED_LEADS_CONFIG: Record<string, unknown> = {
  booking_schedule: { enabled: false },
}

export function bookingRow(over?: Record<string, unknown>): Row {
  return {
    id: BOOKING_A1,
    client_id: CLIENT_A,
    contact_id: CONTACT_A1,
    tour_id: TOUR_A1,
    departure_id: DEP_A1,
    departure_depart_on: '2027-03-12',
    booked_on: '2026-10-12',
    party_size: null,
    is_cruise: false,
    status: 'active',
    cancel_note: null,
    note: null,
    created_by: 'staff@a.test',
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
    ...over,
  }
}

export function milestoneRow(over?: Record<string, unknown>): Row {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    booking_id: BOOKING_A1,
    client_id: CLIENT_A,
    kind: 'deposit',
    state: 'unpaid',
    paid_on: null,
    paid_source: null,
    paid_evidence_ref: null,
    due_override_on: null,
    due_override_depart_on: null,
    remind_after: null,
    nudged_on: null,
    quiet: false,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
    ...over,
  }
}

export function tourRow(over?: Record<string, unknown>): Row {
  return {
    id: TOUR_A1,
    client_id: CLIENT_A,
    name: 'New Zealand South and North Island',
    duration_text: '15 Days 14 Nights',
    ...over,
  }
}

export function departureRow(over?: Record<string, unknown>): Row {
  return {
    id: DEP_A1,
    tour_id: TOUR_A1,
    client_id: CLIENT_A,
    depart_on: '2027-03-12',
    return_on: '2027-03-26',
    status: 'open',
    ...over,
  }
}

export function contactRow(over?: Record<string, unknown>): Row {
  return {
    id: CONTACT_A1,
    client_id: CLIENT_A,
    display_name: 'Li Wei',
    do_not_contact: false,
    ...over,
  }
}

export function bookingPair(
  bookingId: string,
  clientId: string,
  over?: {
    booking?: Record<string, unknown>
    deposit?: Record<string, unknown>
    balance?: Record<string, unknown>
  },
): Row[] {
  const booking = bookingRow({ id: bookingId, client_id: clientId, ...over?.booking })
  const deposit = milestoneRow({
    id: `${bookingId.slice(0, 24)}d00000000000`,
    booking_id: bookingId,
    client_id: clientId,
    kind: 'deposit',
    ...over?.deposit,
  })
  const balance = milestoneRow({
    id: `${bookingId.slice(0, 24)}e00000000000`,
    booking_id: bookingId,
    client_id: clientId,
    kind: 'balance',
    ...over?.balance,
  })
  return [booking, deposit, balance]
}

/**
 * The catalog tables the booking reads touch, re-exported from the catalog folder
 * (which owns those names) so no CRM file spells them out.
 */
export {
  BOOKING_FACT_TOURS_TABLE as TOURS_TABLE,
  BOOKING_FACT_DEPARTURES_TABLE as DEPARTURES_TABLE,
} from '@/lib/tour-catalog/__tests__/booking-fact-tables'
