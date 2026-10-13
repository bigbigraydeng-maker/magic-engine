import { describe, expect, it, beforeEach } from 'vitest'
import {
  listBookingsForOverview,
  listMilestonesForClient,
  listContactNamesForClient,
  listPaidStageContactsWithoutBooking,
  PAID_STAGES,
} from '../booking-overview-reads'
import { OVERVIEW_HARD_CAP, PAID_WITHOUT_BOOKING_ROW_CAP } from '../booking-overview-types'
import { createFakeDb } from './booking-fake-db'
import type { RecordedQuery, Row } from './booking-fake-db'
import { CLIENT_A, CLIENT_B, bookingRow, contactRow } from './booking-fixtures'
import { bid, cid, rowsOf } from './booking-overview-fixtures'
import type { BookingSpec } from './booking-overview-fixtures'

const { db, state, reset } = createFakeDb()

beforeEach(() => {
  reset()
})

/** The paid-stage reader takes the bookings the page already loaded (one source of truth). */
async function paidWithoutBooking(): Promise<Awaited<ReturnType<typeof listPaidStageContactsWithoutBooking>>> {
  return listPaidStageContactsWithoutBooking(db, CLIENT_A, await listBookingsForOverview(db, CLIENT_A))
}

function seed(table: string, rows: Row[]): void {
  state.tables[table] = rows
}

/** Split rowsOf() output into booking rows and milestone rows and seed both tables. */
function seedSpecs(specs: BookingSpec[], clientId: string = CLIENT_A): void {
  const bookings: Row[] = []
  const milestones: Row[] = []
  for (const spec of specs) {
    const rows = rowsOf(spec, clientId)
    for (const row of rows) {
      if ('kind' in row) {
        milestones.push(row)
      } else {
        bookings.push(row)
      }
    }
  }
  seed('crm_bookings', bookings)
  seed('crm_booking_milestones', milestones)
}

function selectsOn(table: string): RecordedQuery[] {
  return state.queries.filter((q) => q.table === table && q.op === 'select')
}

function hasEq(query: RecordedQuery, col: string, val: unknown): boolean {
  return query.eqs.some(([c, v]) => c === col && v === val)
}

// --- listBookingsForOverview --------------------------------------------------

describe('listBookingsForOverview', () => {
  it('returns active AND cancelled bookings of the client only', async () => {
    seed('crm_bookings', [
      bookingRow({ id: bid(1), client_id: CLIENT_A, status: 'active' }),
      bookingRow({ id: bid(2), client_id: CLIENT_A, status: 'cancelled' }),
      bookingRow({ id: bid(3), client_id: CLIENT_B, status: 'active' }),
    ])

    const result = await listBookingsForOverview(db, CLIENT_A)
    expect(result.map((b) => b.id)).toEqual([bid(1), bid(2)])

    const queries = selectsOn('crm_bookings')
    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) {
      expect(hasEq(query, 'client_id', CLIENT_A)).toBe(true)
    }
  })

  it('pages past 1000 rows and returns all 2500', async () => {
    const rows: Row[] = []
    for (let i = 1; i <= 2500; i += 1) {
      rows.push(bookingRow({ id: bid(i), client_id: CLIENT_A }))
    }
    seed('crm_bookings', rows)

    const result = await listBookingsForOverview(db, CLIENT_A)
    expect(result).toHaveLength(2500)
    expect(selectsOn('crm_bookings').length).toBeGreaterThan(1)
  })

  it('throws when the hard cap is breached', async () => {
    const rows: Row[] = []
    for (let i = 1; i <= OVERVIEW_HARD_CAP; i += 1) {
      rows.push(bookingRow({ id: bid(i), client_id: CLIENT_A }))
    }
    seed('crm_bookings', rows)

    await expect(listBookingsForOverview(db, CLIENT_A)).rejects.toThrow()
  })

  it('rejects when the table errors', async () => {
    seed('crm_bookings', [bookingRow({ id: bid(1), client_id: CLIENT_A })])
    state.failTables.add('crm_bookings')

    await expect(listBookingsForOverview(db, CLIENT_A)).rejects.toThrow(Error)
  })
})

// --- listMilestonesForClient --------------------------------------------------

describe('listMilestonesForClient', () => {
  it('returns paid, unpaid and quiet milestones with no state or quiet filter', async () => {
    seedSpecs([
      { n: 1, deposit: { state: 'paid' }, balance: { state: 'unpaid' } },
      { n: 2, deposit: { state: 'unpaid' }, balance: { state: 'unpaid', quiet: true } },
      { n: 3, deposit: { state: 'unpaid' }, balance: { state: 'unpaid' } },
    ])
    const otherRows = rowsOf({ n: 4 }, CLIENT_B)
    const otherMilestones = otherRows.filter((row) => 'kind' in row)
    seed('crm_booking_milestones', [
      ...(state.tables['crm_booking_milestones'] ?? []),
      ...otherMilestones,
    ])

    const result = await listMilestonesForClient(db, CLIENT_A)
    expect(result).toHaveLength(6)
    expect(result.some((m) => m.state === 'paid')).toBe(true)
    expect(result.some((m) => m.quiet === true)).toBe(true)
    expect(result.every((m) => m.bookingId !== bid(4))).toBe(true)

    const queries = selectsOn('crm_booking_milestones')
    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) {
      expect(query.eqs).toEqual([['client_id', CLIENT_A]])
    }
  })

  it('rejects when the table errors', async () => {
    seedSpecs([{ n: 1 }])
    state.failTables.add('crm_booking_milestones')

    await expect(listMilestonesForClient(db, CLIENT_A)).rejects.toThrow(Error)
  })
})

// --- listContactNamesForClient ------------------------------------------------

describe('listContactNamesForClient', () => {
  it('reads only id and display_name from contacts', async () => {
    seed('contacts', [
      contactRow({ id: cid(1), client_id: CLIENT_A, display_name: 'Ana' }),
      contactRow({ id: cid(2), client_id: CLIENT_A, display_name: 'Bo' }),
      contactRow({ id: cid(3), client_id: CLIENT_B, display_name: 'Cy' }),
    ])

    const map = await listContactNamesForClient(db, CLIENT_A, [cid(1), cid(2), cid(3)])
    expect(map.get(cid(1))).toBe('Ana')
    expect(map.get(cid(2))).toBe('Bo')
    expect(map.has(cid(3))).toBe(false)

    const queries = selectsOn('contacts')
    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) {
      expect(query.columns).toBe('id, display_name')
      expect(hasEq(query, 'client_id', CLIENT_A)).toBe(true)
    }
    expect(state.queries.some((q) => q.table === 'contact_touchpoints')).toBe(false)
  })

  it('batches by 100', async () => {
    const ids: string[] = []
    for (let i = 1; i <= 250; i += 1) {
      ids.push(cid(i))
    }
    const withDupes = [...ids, cid(1), cid(2)]
    seed('contacts', [])

    await listContactNamesForClient(db, CLIENT_A, withDupes)

    const queries = selectsOn('contacts')
    expect(queries).toHaveLength(3)
    let total = 0
    for (const query of queries) {
      const inFilter = query.ins.find(([col]) => col === 'id')
      expect(inFilter).toBeDefined()
      const values = inFilter?.[1] ?? []
      expect(values.length).toBeLessThanOrEqual(100)
      total += values.length
    }
    expect(total).toBe(250)
  })

  it('returns an empty map and issues no queries for empty ids', async () => {
    const map = await listContactNamesForClient(db, CLIENT_A, [])
    expect(map.size).toBe(0)
    expect(state.queries).toHaveLength(0)
  })
})

// --- listPaidStageContactsWithoutBooking --------------------------------------

describe('listPaidStageContactsWithoutBooking', () => {
  it('counts the three paid stages (the 16-vs-29 trap)', async () => {
    const contacts: Row[] = []
    let n = 1
    for (let i = 0; i < 16; i += 1) {
      contacts.push(contactRow({ id: cid(n), client_id: CLIENT_A, display_name: `A${n}`, stage: 'deposit_paid' }))
      n += 1
    }
    for (let i = 0; i < 5; i += 1) {
      contacts.push(contactRow({ id: cid(n), client_id: CLIENT_A, display_name: `B${n}`, stage: 'paid_full' }))
      n += 1
    }
    for (let i = 0; i < 8; i += 1) {
      contacts.push(contactRow({ id: cid(n), client_id: CLIENT_A, display_name: `C${n}`, stage: 'traveling_soon' }))
      n += 1
    }
    for (let i = 0; i < 3; i += 1) {
      contacts.push(contactRow({ id: cid(n), client_id: CLIENT_A, display_name: `D${n}`, stage: 'contacted' }))
      n += 1
    }
    contacts.push(contactRow({ id: cid(n), client_id: CLIENT_B, display_name: 'Other', stage: 'paid_full' }))
    seed('contacts', contacts)
    seed('crm_bookings', [])

    const result = await paidWithoutBooking()
    expect(result.total).toBe(29)
    expect(result.rows).toHaveLength(29)
    const stages = new Set(result.rows.map((r) => r.stage))
    expect(stages).toEqual(new Set(PAID_STAGES))
  })

  it('excludes contacts with any booking, including a cancelled one', async () => {
    seed('contacts', [
      contactRow({ id: cid(1), client_id: CLIENT_A, display_name: 'A', stage: 'deposit_paid' }),
      contactRow({ id: cid(2), client_id: CLIENT_A, display_name: 'B', stage: 'paid_full' }),
      contactRow({ id: cid(3), client_id: CLIENT_A, display_name: 'C', stage: 'traveling_soon' }),
      contactRow({ id: cid(4), client_id: CLIENT_A, display_name: 'D', stage: 'deposit_paid' }),
    ])
    const activeRows = rowsOf({ n: 1, contactN: 1, status: 'active' }, CLIENT_A)
    const cancelledRows = rowsOf({ n: 2, contactN: 2, status: 'cancelled' }, CLIENT_A)
    seed('crm_bookings', [
      ...activeRows.filter((row) => !('kind' in row)),
      ...cancelledRows.filter((row) => !('kind' in row)),
    ])

    const result = await paidWithoutBooking()
    expect(result.total).toBe(2)
    expect(result.rows.map((r) => r.id)).toEqual([cid(3), cid(4)])
    for (const row of result.rows) {
      expect(Object.keys(row).sort()).toEqual(['id', 'name', 'stage'])
    }
  })

  it('reports a real total above the row cap', async () => {
    const contacts: Row[] = []
    for (let i = 1; i <= 250; i += 1) {
      contacts.push(contactRow({ id: cid(i), client_id: CLIENT_A, display_name: `N${i}`, stage: 'deposit_paid' }))
    }
    seed('contacts', contacts)
    seed('crm_bookings', [])

    const result = await paidWithoutBooking()
    expect(result.total).toBe(250)
    expect(result.rows).toHaveLength(PAID_WITHOUT_BOOKING_ROW_CAP)
  })

  it('does not count a booking owned by another client', async () => {
    seed('contacts', [
      contactRow({ id: cid(1), client_id: CLIENT_A, display_name: 'A', stage: 'deposit_paid' }),
    ])
    seed('crm_bookings', [
      bookingRow({ id: bid(1), client_id: CLIENT_B, contact_id: cid(1) }),
    ])

    const result = await paidWithoutBooking()
    expect(result.total).toBe(1)
    expect(result.rows.map((r) => r.id)).toEqual([cid(1)])
  })
})

// --- no touchpoints -----------------------------------------------------------

describe('overview readers never touch contact_touchpoints', () => {
  it('issues no query against contact_touchpoints', async () => {
    seedSpecs([{ n: 1, deposit: { state: 'paid' }, balance: { state: 'unpaid' } }])
    seed('contacts', [
      contactRow({ id: cid(1), client_id: CLIENT_A, display_name: 'Ana', stage: 'deposit_paid' }),
    ])
    seed('contact_touchpoints', [
      { client_id: CLIENT_A, contact_id: cid(1), occurred_at: '2026-01-01T00:00:00.000000+00:00', metadata: {} },
    ])

    await listBookingsForOverview(db, CLIENT_A)
    await listMilestonesForClient(db, CLIENT_A)
    await listContactNamesForClient(db, CLIENT_A, [cid(1)])
    await paidWithoutBooking()

    expect(state.queries.some((q) => q.table === 'contact_touchpoints')).toBe(false)
  })
})
