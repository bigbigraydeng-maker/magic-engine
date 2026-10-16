/**
 * Shared helpers for the CRM booking tracker route tests.
 *
 * This is NOT a test file (vitest only runs *.test.ts). It wires the auth
 * environment, builds requests, and seeds a standard two-client world into
 * the table-shaped fake database.
 */

import { NextRequest } from 'next/server'
import type { FakeState, Row } from '@/lib/crm/__tests__/booking-fake-db'
import {
  CLIENT_A,
  CLIENT_B,
  CONTACT_A1,
  CONTACT_A2,
  CONTACT_B1,
  TOUR_A1,
  TOUR_B1,
  DEP_A1,
  DEP_B1,
  BOOKING_A1,
  BOOKING_B1,
  ENABLED_LEADS_CONFIG,
  bookingPair,
  contactRow,
  departureRow,
  tourRow,
  DEPARTURES_TABLE,
  TOURS_TABLE,
} from '@/lib/crm/__tests__/booking-fixtures'

export const ADMIN_EMAIL = 'admin@me.test'

/** Install the auth-related environment variables the gate reads. */
export function setupAuthEnv(): void {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  process.env.DEMO_ADMINS = `demo@me.test:${CLIENT_A}`
  process.env.CLIENT_VIEWERS = `envviewer@a.test:${CLIENT_A}`
  delete process.env.ADMIN_EMAIL_DOMAIN
}

/** Build a NextRequest against the bookings route with an optional JSON body. */
export function request(method: string, body?: unknown, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/clients/x/crm/bookings${query}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: typeof body === 'string' ? body : JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
  })
}

/** Build the route params object, merging any extra dynamic segments. */
export function params<T extends Record<string, string> = Record<never, never>>(
  clientId: string,
  extra?: T,
): { params: Promise<{ id: string } & T> } {
  return { params: Promise.resolve({ id: clientId, ...(extra ?? ({} as T)) }) }
}

/** Parse a response body as a plain record. */
export async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

/** Replace the fake database tables with a standard two-client world. */
export function seedStandardWorld(state: FakeState): void {
  const aPair = bookingPair(BOOKING_A1, CLIENT_A, { booking: { contact_id: CONTACT_A1 } })
  const bPair = bookingPair(BOOKING_B1, CLIENT_B, {
    booking: { contact_id: CONTACT_B1, tour_id: TOUR_B1, departure_id: DEP_B1 },
  })

  const bookings: Row[] = [aPair[0], bPair[0]]
  const milestones: Row[] = [aPair[1], aPair[2], bPair[1], bPair[2]]

  state.tables = {
    clients: [
      { id: CLIENT_A, leads_config: ENABLED_LEADS_CONFIG },
      { id: CLIENT_B, leads_config: ENABLED_LEADS_CONFIG },
    ],
    client_portal_users: [],
    crm_booking_members: [],
    contacts: [
      contactRow({ id: CONTACT_A1, client_id: CLIENT_A, display_name: 'Li Wei' }),
      contactRow({ id: CONTACT_A2, client_id: CLIENT_A, display_name: 'Ana' }),
      contactRow({ id: CONTACT_B1, client_id: CLIENT_B, display_name: 'Bob' }),
    ],
    [TOURS_TABLE]: [
      tourRow({ id: TOUR_A1, client_id: CLIENT_A }),
      tourRow({ id: TOUR_B1, client_id: CLIENT_B }),
    ],
    [DEPARTURES_TABLE]: [
      departureRow({ id: DEP_A1, tour_id: TOUR_A1, client_id: CLIENT_A }),
      departureRow({ id: DEP_B1, tour_id: TOUR_B1, client_id: CLIENT_B }),
    ],
    crm_bookings: bookings,
    crm_booking_milestones: milestones,
  }
}
