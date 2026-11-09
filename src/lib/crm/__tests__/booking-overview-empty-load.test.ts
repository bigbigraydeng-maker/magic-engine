import { beforeEach, describe, expect, it } from 'vitest'
import { loadBookingOverview } from '../booking-overview-load'
import { createFakeDb } from './booking-fake-db'
import { CLIENT_A, TEST_RULE, TOUR_A1 } from './booking-fixtures'
import { TODAY, bid, depId, rowsOf, tourId } from './booking-overview-fixtures'
import type { BookingSpec } from './booking-overview-fixtures'

const { db, state, reset } = createFakeDb()
beforeEach(() => reset())

const TOUR_OFF = tourId(2)

const BOOKED_DEP = depId(1)
const OPEN_DEP = depId(2)
const SOLD_OUT_DEP = depId(3)
const BEYOND_DEP = depId(4)
const INACTIVE_DEP = depId(5)

function seedCatalog(): void {
  state.tables.tour_catalog_tours = [
    { id: TOUR_A1, client_id: CLIENT_A, name: 'Tour A', duration_text: null, is_active: true },
    { id: TOUR_OFF, client_id: CLIENT_A, name: 'Tour Off', duration_text: null, is_active: false },
  ]
  state.tables.tour_catalog_departures = [
    { id: BOOKED_DEP, client_id: CLIENT_A, tour_id: TOUR_A1, depart_on: '2027-03-12', return_on: null, status: 'open' },
    { id: OPEN_DEP, client_id: CLIENT_A, tour_id: TOUR_A1, depart_on: '2027-03-26', return_on: null, status: 'open' },
    { id: SOLD_OUT_DEP, client_id: CLIENT_A, tour_id: TOUR_A1, depart_on: '2027-03-27', return_on: null, status: 'sold_out' },
    { id: BEYOND_DEP, client_id: CLIENT_A, tour_id: TOUR_A1, depart_on: '2028-06-01', return_on: null, status: 'open' },
    { id: INACTIVE_DEP, client_id: CLIENT_A, tour_id: TOUR_OFF, depart_on: '2027-03-28', return_on: null, status: 'open' },
  ]
}

function seedSpecs(specs: BookingSpec[]): void {
  const rows = specs.flatMap((s) => rowsOf(s, CLIENT_A))
  state.tables.crm_bookings = rows.filter((r) => !('kind' in r))
  state.tables.crm_booking_milestones = rows.filter((r) => 'kind' in r)
  state.tables.contacts = []
}

function req() {
  return { status: 'all' as const, page: 1, includePastPaid: false }
}

const BOOKED_SPEC: BookingSpec = { n: 1, departureId: BOOKED_DEP, snapshot: '2027-03-12' }

describe('empty departures still surface as groups', () => {
  it('includes the booked departure and the open empty departure, excludes sold_out / beyond horizon / inactive tour', async () => {
    seedCatalog()
    seedSpecs([BOOKED_SPEC])
    const payload = await loadBookingOverview(db, CLIENT_A, TEST_RULE, TODAY, req())
    const keys = payload.summary.groups.map((g) => g.key)
    expect(keys).toContain(BOOKED_DEP)
    expect(keys).toContain(OPEN_DEP)
    expect(keys).not.toContain(SOLD_OUT_DEP)
    expect(keys).not.toContain(BEYOND_DEP)
    expect(keys).not.toContain(INACTIVE_DEP)
    const empty = payload.summary.groups.find((g) => g.key === OPEN_DEP)
    expect(empty).toBeDefined()
    expect(empty?.orders).toBe(0)
  })

  it('orders groups by departOn ascending', async () => {
    seedCatalog()
    seedSpecs([BOOKED_SPEC])
    const payload = await loadBookingOverview(db, CLIENT_A, TEST_RULE, TODAY, req())
    const dates = payload.summary.groups.map((g) => g.departOn)
    const sorted = dates.slice().sort()
    expect(dates).toEqual(sorted)
  })

  it('rejects when the catalog tour table read fails', async () => {
    seedCatalog()
    // no bookings: the only reader of the catalog is the new options read
    state.failTables.add('tour_catalog_tours')
    await expect(loadBookingOverview(db, CLIENT_A, TEST_RULE, TODAY, req())).rejects.toThrow()
  })

  it('hasBookings stays true and the list total counts only the real booking', async () => {
    seedCatalog()
    seedSpecs([BOOKED_SPEC])
    const payload = await loadBookingOverview(db, CLIENT_A, TEST_RULE, TODAY, req())
    expect(payload.hasBookings).toBe(true)
    expect(payload.list.total).toBe(1)
    expect(payload.list.rows.map((r) => r.bookingId)).toEqual([bid(1)])
  })

  it('never exposes money-shaped fields in the serialised summary', async () => {
    seedCatalog()
    seedSpecs([BOOKED_SPEC])
    const payload = await loadBookingOverview(db, CLIENT_A, TEST_RULE, TODAY, req())
    expect(JSON.stringify(payload.summary)).not.toMatch(/amount|price|money|revenue/i)
  })
})
