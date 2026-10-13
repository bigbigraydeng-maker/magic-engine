import { beforeEach, describe, expect, it } from 'vitest'
import { summariseOverview } from '../booking-overview'
import { selectOverviewListPage } from '../booking-overview-list'
import { loadBookingOverview } from '../booking-overview-load'
import { parseOverviewQuery } from '../booking-overview-query'
import { listBookingsForOverview, listMilestonesForClient } from '../booking-overview-reads'
import { OVERVIEW_HARD_CAP } from '../booking-overview-types'
import type { OverviewStatusFilter } from '../booking-overview-types'
import { createFakeDb } from './booking-fake-db'
import type { Row } from './booking-fake-db'
import { CLIENT_A, TEST_RULE, bookingRow, milestoneRow } from './booking-fixtures'
import { TODAY, bid, depId, entriesOf, factsOf, rowsOf } from './booking-overview-fixtures'
import type { BookingSpec } from './booking-overview-fixtures'

const { db, state, reset } = createFakeDb()
beforeEach(() => reset())

const FACTS = factsOf([
  { id: depId(1), departOn: '2027-03-19' },
  { id: depId(2), departOn: '2026-09-20' },
  { id: depId(3), departOn: '2026-11-02' },
  { id: depId(4), departOn: '2026-08-01' },
])
const PAID = { state: 'paid' as const }
const q = (over: { status?: OverviewStatusFilter; page?: number; departureId?: string | null }) => ({
  status: 'all' as const,
  page: 1,
  ...over,
})

function seedSpecs(specs: BookingSpec[]): void {
  const rows = specs.flatMap((s) => rowsOf(s, CLIENT_A))
  state.tables.crm_bookings = rows.filter((r) => !('kind' in r))
  state.tables.crm_booking_milestones = rows.filter((r) => 'kind' in r)
  state.tables.contacts = []
}

describe('S1 unreadable rows fail the whole read', () => {
  it('a booking row the mapper rejects throws (no row content in the message)', async () => {
    state.tables.crm_bookings = [bookingRow({ id: bid(1), client_id: CLIENT_A, status: 'weird-secret' })]
    const err = await listBookingsForOverview(db, CLIENT_A).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('unmappable booking row')
  })

  it('a milestone row the mapper rejects throws', async () => {
    state.tables.crm_booking_milestones = [milestoneRow({ booking_id: bid(1), client_id: CLIENT_A, kind: 'bogus' })]
    await expect(listMilestonesForClient(db, CLIENT_A)).rejects.toThrow('unmappable milestone row')
  })

  it.each([
    ['one milestone only', { n: 1, balance: null }],
    ['no milestones', { n: 1, deposit: null, balance: null }],
  ])('the loader refuses a booking with %s', async (_label, spec) => {
    seedSpecs([spec as BookingSpec])
    await expect(loadBookingOverview(db, CLIENT_A, TEST_RULE, TODAY, req())).rejects.toThrow('incomplete milestone set')
  })

  it('the loader refuses a booking with three milestone rows', async () => {
    seedSpecs([{ n: 1 }])
    state.tables.crm_booking_milestones.push(milestoneRow({ id: '40000000-0000-4000-8000-0000000000ff', booking_id: bid(1), client_id: CLIENT_A, kind: 'balance' }))
    await expect(loadBookingOverview(db, CLIENT_A, TEST_RULE, TODAY, req())).rejects.toThrow('incomplete milestone set')
  })

  it('the loader refuses two deposits and no balance', async () => {
    seedSpecs([{ n: 1 }])
    state.tables.crm_booking_milestones = state.tables.crm_booking_milestones.map((r) => ({ ...r, kind: 'deposit' }))
    await expect(loadBookingOverview(db, CLIENT_A, TEST_RULE, TODAY, req())).rejects.toThrow('incomplete milestone set')
  })
})

function req() {
  return { status: 'all' as const, page: 1, includePastPaid: false }
}

describe('S2 the paid-without-booking figure uses the loaded bookings', () => {
  it('reads crm_bookings exactly once in a full load', async () => {
    seedSpecs([{ n: 1, departureId: null, snapshot: null }])
    await loadBookingOverview(db, CLIENT_A, TEST_RULE, TODAY, req())
    expect(state.queries.filter((x) => x.table === 'crm_bookings')).toHaveLength(1)
  })
})

describe('S3 hiddenOrders', () => {
  it('2 past fully-paid + 1 future open: totals cover the visible group only', () => {
    const paid = { deposit: PAID, balance: PAID }
    const s = summariseOverview(
      entriesOf(
        [
          { n: 1, departureId: depId(2), ...paid },
          { n: 2, departureId: depId(2), ...paid },
          { n: 3, departureId: depId(1), deposit: PAID, balance: { due: '2027-01-01' } },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(s.totals.orders).toBe(1)
    expect(s.hiddenOrders).toBe(2)
    expect(s.hiddenGroupCount).toBe(1)
    expect(s.hiddenOfflineOnlyGroups).toBe(0)
  })
})

describe('S4 hide rule uses open items', () => {
  it('a past group with an open overdue item stays visible; an offline-only one is hidden and counted', () => {
    const s = summariseOverview(
      entriesOf(
        [
          { n: 1, departureId: depId(2), deposit: PAID, balance: { due: '2026-09-01' } },
          { n: 2, departureId: depId(4), deposit: PAID, balance: { quiet: true, due: '2026-07-01' } },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(s.groups.map((g) => g.key)).toEqual([depId(2)])
    expect(s.hiddenOfflineOnlyGroups).toBe(1)
    expect(s.hiddenOrders).toBe(1)
  })
})

describe('S5 offline status filter is a partition of active orders', () => {
  const specs: BookingSpec[] = [
    { n: 1, deposit: PAID, balance: { due: '2027-01-01' } }, // open
    { n: 2, deposit: { due: '2026-10-01' }, balance: { due: '2027-01-01' } }, // open
    { n: 3, deposit: PAID, balance: PAID }, // settled
    { n: 4, deposit: { state: 'paid', quiet: true }, balance: PAID }, // settled (paid + quiet flag)
    { n: 5, deposit: PAID, balance: { quiet: true, due: '2027-01-01' } }, // offline
    { n: 6, deposit: { quiet: true, due: '2026-10-01' }, balance: { quiet: true, due: '2027-01-01' } }, // offline
    { n: 7, deposit: { quiet: true, due: '2026-10-01' }, balance: { due: '2027-01-01' } }, // open (one open item)
    { n: 8, status: 'cancelled', deposit: { quiet: true }, balance: { quiet: true } }, // cancelled: in no bucket
  ]
  const idsOf = (status: OverviewStatusFilter): string[] =>
    selectOverviewListPage(entriesOf(specs, FACTS), q({ status }), TODAY).entries.map((e) => e.view.id).sort()

  it('unsettled / settled / offline are disjoint and together equal all active orders', () => {
    const u = idsOf('unsettled')
    const s = idsOf('settled')
    const o = idsOf('offline')
    expect(u).toEqual([bid(1), bid(2), bid(7)])
    expect(s).toEqual([bid(3), bid(4)])
    expect(o).toEqual([bid(5), bid(6)])
    expect([...u, ...s, ...o].sort()).toEqual(idsOf('all'))
    expect(new Set([...u, ...s, ...o]).size).toBe(7)
  })

  it('the query parser whitelists offline and still rejects unknown values', () => {
    const ok = parseOverviewQuery(new URLSearchParams('status=offline'))
    expect(ok.ok && ok.request.status).toBe('offline')
    expect(parseOverviewQuery(new URLSearchParams('status=quiet'))).toEqual({ ok: false, error: 'invalid_status' })
  })
})

describe('S6 all excludes cancelled', () => {
  it('2 active + 1 cancelled on one departure: group 2, list all 2, list cancelled 1', () => {
    const entries = entriesOf(
      [
        { n: 1, departureId: depId(1), deposit: PAID, balance: { due: '2027-01-01' } },
        { n: 2, departureId: depId(1), deposit: PAID, balance: { due: '2027-01-01' } },
        { n: 3, departureId: depId(1), status: 'cancelled' },
      ],
      FACTS,
    )
    const group = summariseOverview(entries, TODAY, false).groups[0]
    expect(group.orders).toBe(2)
    expect(selectOverviewListPage(entries, q({ departureId: depId(1) }), TODAY).total).toBe(2)
    expect(selectOverviewListPage(entries, q({ departureId: depId(1), status: 'cancelled' }), TODAY).total).toBe(1)
  })
})

describe('S7 milestone reader ceiling', () => {
  it('reaching the cap throws instead of returning half the milestones', async () => {
    const rows: Row[] = []
    for (let i = 0; i < OVERVIEW_HARD_CAP; i += 1) {
      rows.push(milestoneRow({ id: `40000000-0000-4000-8000-${String(i).padStart(12, '0')}`, booking_id: bid(1), client_id: CLIENT_A }))
    }
    state.tables.crm_booking_milestones = rows
    await expect(listMilestonesForClient(db, CLIENT_A)).rejects.toThrow()
  })
})

describe('S8 list ordering and tie-break', () => {
  it('nearest FUTURE departure first, then past departures newest first, then undated (code band logic)', () => {
    const entries = entriesOf(
      [
        { n: 1, departureId: depId(1) }, // 2027-03-19 future, far
        { n: 2, departureId: depId(3) }, // 2026-11-02 future, near
        { n: 3, departureId: depId(4) }, // 2026-08-01 past, older
        { n: 4, departureId: depId(2) }, // 2026-09-20 past, newer
        { n: 5, departureId: null, snapshot: null },
      ],
      FACTS,
    )
    const order = selectOverviewListPage(entries, q({}), TODAY).entries.map((e) => e.view.id)
    expect(order).toEqual([bid(2), bid(1), bid(4), bid(3), bid(5)])
  })

  it('120 identical orders paginate over 3 pages with no duplicate and no missing id', () => {
    const specs: BookingSpec[] = []
    for (let n = 120; n >= 1; n -= 1) specs.push({ n, departureId: depId(1) }) // input in REVERSE id order
    const entries = entriesOf(specs, FACTS)
    const seen: string[] = []
    for (const page of [1, 2, 3]) {
      seen.push(...selectOverviewListPage(entries, q({ page }), TODAY).entries.map((e) => e.view.id))
    }
    expect(seen).toHaveLength(120)
    expect(new Set(seen).size).toBe(120)
    expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => bid(i + 1)))
  })
})

describe('S9 ambiguous dates', () => {
  it('different stored dates with the live departure missing: flagged, never departed, stays visible', () => {
    const s = summariseOverview(
      entriesOf(
        [
          { n: 1, departureId: depId(8), snapshot: '2026-08-01', deposit: PAID, balance: { due: '2027-01-01' } },
          { n: 2, departureId: depId(8), snapshot: '2026-08-05', deposit: PAID, balance: { due: '2027-01-01' } },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = s.groups[0]
    expect(g.dateAmbiguous).toBe(true)
    expect(g.departed).toBe(false)
    expect(g.departOn).toBe('2026-08-01')
  })

  it('agreeing dates are not ambiguous', () => {
    const s = summariseOverview(
      entriesOf([{ n: 1, departureId: depId(1) }, { n: 2, departureId: depId(1) }], FACTS),
      TODAY,
      false,
    )
    expect(s.groups[0].dateAmbiguous).toBe(false)
  })
})
