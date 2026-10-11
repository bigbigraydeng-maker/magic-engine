import { describe, expect, it, beforeEach } from 'vitest'
import {
  addBookingMember,
  contactBelongsToClient,
  getBookingWithMilestones,
  listActiveBookingsForNudge,
  listBookingMembers,
  listBookingsForContact,
  listContactsForNudge,
  listMilestonesForBookings,
  loadCatalogFacts,
  removeBookingMember,
  toBookingRow,
  toMilestoneRow,
} from '../booking-store-reads'
import { createFakeDb } from './booking-fake-db'
import type { RecordedQuery } from './booking-fake-db'
import {
  BOOKING_A1,
  BOOKING_A2,
  BOOKING_B1,
  CLIENT_A,
  CLIENT_B,
  CONTACT_A1,
  CONTACT_A2,
  CONTACT_B1,
  DEP_A1,
  DEP_B1,
  TOUR_A1,
  TOUR_B1,
  UPDATED_AT,
  bookingPair,
  bookingRow,
  contactRow,
  departureRow,
  milestoneRow,
  tourRow,
} from './booking-fixtures'

const { db, state, reset } = createFakeDb()

beforeEach(() => {
  reset()
})

function seed(table: string, rows: Array<Record<string, unknown>>): void {
  state.tables[table] = rows
}

function selectsOn(table: string): RecordedQuery[] {
  return state.queries.filter((q) => q.table === table && q.op === 'select')
}

function hasEq(query: RecordedQuery, col: string, val: unknown): boolean {
  return query.eqs.some(([c, v]) => c === col && v === val)
}

// --- 1. row mappers -----------------------------------------------------------

describe('row mappers', () => {
  it('maps booking snake_case to camelCase without leaking extra columns', () => {
    const booking = toBookingRow(bookingRow())
    expect(booking).not.toBeNull()
    if (booking === null) return
    expect(booking.id).toBe(BOOKING_A1)
    expect(booking.contactId).toBe(CONTACT_A1)
    expect(booking.tourId).toBe(TOUR_A1)
    expect(booking.departureId).toBe(DEP_A1)
    expect(booking.departureDepartOn).toBe('2027-03-12')
    expect(booking.bookedOn).toBe('2026-10-12')
    expect(booking.status).toBe('active')
    expect(booking.isCruise).toBe(false)
    expect(booking.updatedAt).toBe(UPDATED_AT)
    expect(Object.prototype.hasOwnProperty.call(booking, 'clientId')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(booking, 'createdBy')).toBe(false)
  })

  it('returns null for malformed booking rows', () => {
    expect(toBookingRow(null)).toBeNull()
    expect(toBookingRow('nope')).toBeNull()
    expect(toBookingRow(bookingRow({ id: undefined }))).toBeNull()
    expect(toBookingRow(bookingRow({ status: 'weird' }))).toBeNull()
    expect(toBookingRow(bookingRow({ updated_at: undefined }))).toBeNull()
  })

  it('maps milestone rows and validates kind/state/paid_source', () => {
    const milestone = toMilestoneRow(milestoneRow())
    expect(milestone).not.toBeNull()
    if (milestone === null) return
    expect(milestone.kind).toBe('deposit')
    expect(milestone.state).toBe('unpaid')
    expect(milestone.paidSource).toBeNull()

    expect(toMilestoneRow(milestoneRow({ kind: 'other' }))).toBeNull()
    expect(toMilestoneRow(milestoneRow({ state: 'half' }))).toBeNull()
    expect(toMilestoneRow(milestoneRow({ booking_id: undefined }))).toBeNull()

    const email = toMilestoneRow(milestoneRow({ paid_source: 'email' }))
    expect(email?.paidSource).toBe('email')
    const bank = toMilestoneRow(milestoneRow({ paid_source: 'bank' }))
    expect(bank?.paidSource).toBeNull()
  })
})

// --- 2. column discipline -----------------------------------------------------

describe('column discipline', () => {
  it('never selects * or tenant/audit columns and never returns them', async () => {
    seed('crm_bookings', [
      ...bookingPair(BOOKING_A1, CLIENT_A),
      ...bookingPair(BOOKING_A2, CLIENT_A),
    ])
    seed('contacts', [contactRow()])

    const withMilestones = await getBookingWithMilestones(db, CLIENT_A, BOOKING_A1)
    const forContact = await listBookingsForContact(db, CLIENT_A, CONTACT_A1)
    const forNudge = await listActiveBookingsForNudge(db, CLIENT_A, 10)
    const milestones = await listMilestonesForBookings(db, CLIENT_A, [BOOKING_A1])

    for (const table of ['crm_bookings', 'crm_booking_milestones']) {
      for (const query of selectsOn(table)) {
        expect(query.columns).not.toBeNull()
        const columns = query.columns ?? ''
        expect(columns).not.toContain('*')
        expect(columns).not.toContain('client_id')
        expect(columns).not.toContain('created_by')
      }
    }

    const serialized = JSON.stringify([withMilestones, forContact, forNudge, milestones])
    expect(serialized).not.toContain('client_id')
    expect(serialized).not.toContain('created_by')
    expect(serialized).not.toContain('paid_evidence_ref')
  })
})

// --- 3. tenant scoping --------------------------------------------------------

describe('tenant scoping', () => {
  function seedBothTenants(): void {
    seed('crm_bookings', [
      ...bookingPair(BOOKING_A1, CLIENT_A),
      ...bookingPair(BOOKING_B1, CLIENT_B),
    ])
    seed('contacts', [
      contactRow({ id: CONTACT_A1, client_id: CLIENT_A }),
      contactRow({ id: CONTACT_B1, client_id: CLIENT_B }),
    ])
    seed('tour_catalog_tours', [
      tourRow({ id: TOUR_A1, client_id: CLIENT_A }),
      tourRow({ id: TOUR_B1, client_id: CLIENT_B }),
    ])
    seed('tour_catalog_departures', [
      departureRow({ id: DEP_A1, client_id: CLIENT_A }),
      departureRow({ id: DEP_B1, client_id: CLIENT_B }),
    ])
    seed('crm_booking_members', [
      { client_id: CLIENT_A, email: 'a@x.test', granted_by: 'admin@me.test', created_at: UPDATED_AT },
      { client_id: CLIENT_B, email: 'b@x.test', granted_by: 'admin@me.test', created_at: UPDATED_AT },
    ])
  }

  it('filters every read by client_id and never crosses tenants', async () => {
    seedBothTenants()

    await contactBelongsToClient(db, CLIENT_A, CONTACT_A1)
    await listBookingsForContact(db, CLIENT_A, CONTACT_A1)
    await getBookingWithMilestones(db, CLIENT_A, BOOKING_A1)
    await loadCatalogFacts(db, CLIENT_A, [TOUR_A1], [DEP_A1])
    await listActiveBookingsForNudge(db, CLIENT_A, 10)
    await listMilestonesForBookings(db, CLIENT_A, [BOOKING_A1])
    await listContactsForNudge(db, CLIENT_A, [CONTACT_A1])
    await listBookingMembers(db, CLIENT_A)

    expect(state.queries.length).toBeGreaterThan(0)
    for (const query of state.queries) {
      expect(hasEq(query, 'client_id', CLIENT_A)).toBe(true)
    }

    expect(await contactBelongsToClient(db, CLIENT_A, CONTACT_B1)).toBe(false)
    expect(await contactBelongsToClient(db, CLIENT_A, CONTACT_A1)).toBe(true)
    expect(await getBookingWithMilestones(db, CLIENT_A, BOOKING_B1)).toBeNull()
    expect(await listBookingsForContact(db, CLIENT_A, CONTACT_B1)).toEqual([])
    expect(await listMilestonesForBookings(db, CLIENT_A, [BOOKING_B1])).toEqual([])

    const facts = await loadCatalogFacts(db, CLIENT_A, [TOUR_B1], [DEP_B1])
    expect(facts.tours.size).toBe(0)
    expect(facts.departures.size).toBe(0)

    const contacts = await listContactsForNudge(db, CLIENT_A, [CONTACT_B1])
    expect(contacts.size).toBe(0)
  })
})

// --- 4. listBookingsForContact ------------------------------------------------

describe('listBookingsForContact', () => {
  it('returns newest first and sorts milestones deposit first', async () => {
    const older = bookingPair(BOOKING_A1, CLIENT_A, {
      booking: { created_at: '2026-01-01T00:00:00.000000+00:00' },
    })
    const newer = bookingPair(BOOKING_A2, CLIENT_A, {
      booking: { created_at: '2026-06-01T00:00:00.000000+00:00' },
    })
    // Store balance before deposit to prove sorting is applied.
    const [olderBooking, olderDeposit, olderBalance] = older
    const [newerBooking, newerDeposit, newerBalance] = newer
    seed('crm_bookings', [olderBooking, newerBooking])
    seed('crm_booking_milestones', [
      olderBalance,
      olderDeposit,
      newerBalance,
      newerDeposit,
    ])

    const result = await listBookingsForContact(db, CLIENT_A, CONTACT_A1)
    expect(result.map((r) => r.booking.id)).toEqual([BOOKING_A2, BOOKING_A1])
    for (const entry of result) {
      expect(entry.milestones.map((m) => m.kind)).toEqual(['deposit', 'balance'])
    }
  })
})

// --- 5. loadCatalogFacts ------------------------------------------------------

describe('loadCatalogFacts', () => {
  it('chunks 250 ids into 3 queries of at most 100 values', async () => {
    const ids: string[] = []
    for (let i = 0; i < 250; i += 1) {
      ids.push(`10000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    }
    seed('tour_catalog_tours', [tourRow({ id: ids[0], client_id: CLIENT_A })])

    await loadCatalogFacts(db, CLIENT_A, ids, [])

    const queries = selectsOn('tour_catalog_tours')
    expect(queries).toHaveLength(3)
    for (const query of queries) {
      const inFilter = query.ins.find(([col]) => col === 'id')
      expect(inFilter).toBeDefined()
      expect((inFilter?.[1] ?? []).length).toBeLessThanOrEqual(100)
    }
  })

  it('issues no queries for empty id lists and de-duplicates ids', async () => {
    await loadCatalogFacts(db, CLIENT_A, [], [])
    expect(state.queries).toHaveLength(0)

    seed('tour_catalog_tours', [tourRow({ id: TOUR_A1, client_id: CLIENT_A })])
    seed('tour_catalog_departures', [departureRow({ id: DEP_A1, client_id: CLIENT_A })])
    const facts = await loadCatalogFacts(db, CLIENT_A, [TOUR_A1, TOUR_A1], [DEP_A1, DEP_A1])

    const tourQuery = selectsOn('tour_catalog_tours')[0]
    expect(tourQuery.ins[0][1]).toEqual([TOUR_A1])
    expect(facts.tours.get(TOUR_A1)).toEqual({
      id: TOUR_A1,
      name: 'New Zealand South and North Island',
      durationText: '15 Days 14 Nights',
    })
    expect(facts.departures.get(DEP_A1)).toEqual({
      id: DEP_A1,
      tourId: TOUR_A1,
      departOn: '2027-03-12',
      returnOn: '2027-03-26',
      status: 'open',
    })
  })
})

// --- 6. listActiveBookingsForNudge --------------------------------------------

describe('listActiveBookingsForNudge', () => {
  function seedActiveAndCancelled(): void {
    const rows: Array<Record<string, unknown>> = []
    for (let i = 0; i < 5; i += 1) {
      const id = `30000000-0000-4000-8000-00000000000${i}`
      rows.push(bookingRow({ id, client_id: CLIENT_A, status: 'active', booked_on: `2026-0${i + 1}-01` }))
    }
    rows.push(bookingRow({ id: BOOKING_B1, client_id: CLIENT_A, status: 'cancelled' }))
    seed('crm_bookings', rows)
  }

  it('caps results and reports truncation', async () => {
    seedActiveAndCancelled()
    const result = await listActiveBookingsForNudge(db, CLIENT_A, 3)
    expect(result.bookings).toHaveLength(3)
    expect(result.truncated).toBe(true)

    const query = selectsOn('crm_bookings')[0]
    expect(query.limit).toBe(4)
    expect(hasEq(query, 'status', 'active')).toBe(true)
  })

  it('returns all active bookings when under the cap', async () => {
    seedActiveAndCancelled()
    const result = await listActiveBookingsForNudge(db, CLIENT_A, 10)
    expect(result.bookings).toHaveLength(5)
    expect(result.truncated).toBe(false)
  })
})

// --- 7. listContactsForNudge --------------------------------------------------

describe('listContactsForNudge', () => {
  it('maps name and doNotContact', async () => {
    seed('contacts', [
      contactRow({ id: CONTACT_A1, client_id: CLIENT_A, display_name: 'Li Wei', do_not_contact: null }),
      contactRow({ id: CONTACT_A2, client_id: CLIENT_A, display_name: 'Ana', do_not_contact: true }),
    ])
    const map = await listContactsForNudge(db, CLIENT_A, [CONTACT_A1, CONTACT_A2])
    expect(map.get(CONTACT_A1)).toEqual({ name: 'Li Wei', doNotContact: false })
    expect(map.get(CONTACT_A2)).toEqual({ name: 'Ana', doNotContact: true })
  })
})

// --- 8. members ---------------------------------------------------------------

describe('booking members', () => {
  it('adds idempotently and lists lower-cased emails oldest first', async () => {
    seed('crm_booking_members', [
      { client_id: CLIENT_A, email: 'a@x.test', granted_by: 'admin@me.test', created_at: '2026-01-01T00:00:00.000000+00:00' },
      { client_id: CLIENT_A, email: 'z@x.test', granted_by: 'admin@me.test', created_at: '2026-02-01T00:00:00.000000+00:00' },
      { client_id: CLIENT_B, email: 'b@x.test', granted_by: 'admin@me.test', created_at: '2026-01-01T00:00:00.000000+00:00' },
    ])

    await addBookingMember(db, CLIENT_A, 'a@x.test', 'admin@me.test')
    await addBookingMember(db, CLIENT_A, 'a@x.test', 'admin@me.test')
    await addBookingMember(db, CLIENT_A, 'new@x.test', 'admin@me.test')

    const clientARows = (state.tables['crm_booking_members'] ?? []).filter(
      (row) => row.client_id === CLIENT_A,
    )
    const aRows = clientARows.filter((row) => row.email === 'a@x.test')
    expect(aRows).toHaveLength(1)
    const newRows = clientARows.filter((row) => row.email === 'new@x.test')
    expect(newRows).toHaveLength(1)
    expect(newRows[0].granted_by).toBe('admin@me.test')

    const members = await listBookingMembers(db, CLIENT_A)
    expect(members.map((m) => m.email).slice(0, 2)).toEqual(['a@x.test', 'z@x.test'])
    expect(members.every((m) => m.email !== 'b@x.test')).toBe(true)
    for (const member of members) {
      expect(typeof member.grantedBy).toBe('string')
      expect(typeof member.createdAt).toBe('string')
    }
  })

  it('lower-cases stored mixed-case emails', async () => {
    seed('crm_booking_members', [
      { client_id: CLIENT_A, email: 'Mixed@X.test', granted_by: 'admin@me.test', created_at: UPDATED_AT },
    ])

    const members = await listBookingMembers(db, CLIENT_A)
    expect(members.map((m) => m.email)).toEqual(['mixed@x.test'])
  })

  it('removes only the matching tenant row', async () => {
    seed('crm_booking_members', [
      { client_id: CLIENT_A, email: 'a@x.test', granted_by: 'admin@me.test', created_at: UPDATED_AT },
      { client_id: CLIENT_B, email: 'a@x.test', granted_by: 'admin@me.test', created_at: UPDATED_AT },
    ])

    await removeBookingMember(db, CLIENT_A, 'a@x.test')

    const remaining = state.tables['crm_booking_members'] ?? []
    expect(remaining).toHaveLength(1)
    expect(remaining[0].client_id).toBe(CLIENT_B)
  })
})

// --- 9. failure surfaces ------------------------------------------------------

describe('failure surfaces', () => {
  it('rejects when the main table fails', async () => {
    seed('crm_bookings', bookingPair(BOOKING_A1, CLIENT_A))
    seed('contacts', [contactRow()])
    seed('crm_booking_milestones', [milestoneRow()])
    seed('tour_catalog_tours', [tourRow()])
    seed('crm_booking_members', [
      { client_id: CLIENT_A, email: 'a@x.test', granted_by: 'admin@me.test', created_at: UPDATED_AT },
    ])

    state.failTables.add('crm_bookings')
    await expect(listBookingsForContact(db, CLIENT_A, CONTACT_A1)).rejects.toThrow(Error)

    state.failTables.clear()
    state.failTables.add('contacts')
    await expect(contactBelongsToClient(db, CLIENT_A, CONTACT_A1)).rejects.toThrow(Error)

    state.failTables.clear()
    state.failTables.add('crm_booking_milestones')
    await expect(listMilestonesForBookings(db, CLIENT_A, [BOOKING_A1])).rejects.toThrow(Error)

    state.failTables.clear()
    state.failTables.add('tour_catalog_tours')
    await expect(loadCatalogFacts(db, CLIENT_A, [TOUR_A1], [])).rejects.toThrow(Error)

    state.failTables.clear()
    state.failTables.add('crm_booking_members')
    await expect(listBookingMembers(db, CLIENT_A)).rejects.toThrow(Error)
    await expect(addBookingMember(db, CLIENT_A, 'a@x.test', 'admin@me.test')).rejects.toThrow(Error)
    await expect(removeBookingMember(db, CLIENT_A, 'a@x.test')).rejects.toThrow(Error)
  })
})
