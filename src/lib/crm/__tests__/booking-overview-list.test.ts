import { describe, expect, it } from 'vitest'
import {
  lastNudgedOn,
  selectOverviewListPage,
  toOverviewListRows,
} from '../booking-overview-list'
import type { OverviewEntry, OverviewListQuery } from '../booking-overview-types'
import { TOUR_A1 } from './booking-fixtures'
import {
  TODAY,
  bid,
  cid,
  depId,
  entriesOf,
  factsOf,
  itemOf,
  tourId,
} from './booking-overview-fixtures'
import type { BookingSpec } from './booking-overview-fixtures'

const FACTS = factsOf(
  [
    { id: depId(1), departOn: '2027-03-19' },
    { id: depId(2), departOn: '2026-09-20' },
    { id: depId(3), departOn: '2026-11-02' },
  ],
  [TOUR_A1, tourId(2)],
)

const SPECS: BookingSpec[] = [
  {
    n: 1,
    departureId: depId(1),
    deposit: { state: 'paid' },
    balance: { due: '2027-01-01' },
  },
  {
    n: 2,
    departureId: depId(1),
    deposit: { state: 'paid' },
    balance: { state: 'paid' },
  },
  {
    n: 3,
    departureId: depId(2),
    deposit: { due: '2026-10-01' },
    balance: { due: '2026-11-01' },
  },
  {
    n: 4,
    departureId: depId(3),
    status: 'cancelled',
    deposit: { due: '2026-10-01' },
    balance: { due: '2026-10-01' },
  },
  {
    n: 5,
    departureId: null,
    snapshot: null,
    bookedOn: '2026-10-01',
    deposit: {},
    balance: {},
  },
  {
    n: 6,
    departureId: depId(3),
    tourId: tourId(2),
    deposit: { state: 'paid' },
    balance: { state: 'paid' },
  },
  {
    n: 7,
    departureId: depId(1),
    deposit: { quiet: true, due: '2026-10-01' },
    balance: { state: 'paid' },
  },
]

const ENTRIES = entriesOf(SPECS, FACTS)

function q(over: Partial<OverviewListQuery>): OverviewListQuery {
  return { status: 'all', page: 1, ...over }
}

function ids(entries: OverviewEntry[]): string[] {
  return entries.map((e) => e.item.booking.id)
}

describe('selectOverviewListPage', () => {
  it('status all covers every ACTIVE booking and never a cancelled one (S6)', () => {
    const page = selectOverviewListPage(ENTRIES, q({ status: 'all' }), TODAY)
    expect(page.total).toBe(6)
    expect(page.entries).toHaveLength(6)
    expect(ids(page.entries)).not.toContain(bid(4))
  })

  it('status filters split the bookings', () => {
    const unsettled = selectOverviewListPage(
      ENTRIES,
      q({ status: 'unsettled' }),
      TODAY,
    )
    expect(ids(unsettled.entries).sort()).toEqual(
      [bid(1), bid(3), bid(5)].sort(),
    )

    const settled = selectOverviewListPage(ENTRIES, q({ status: 'settled' }), TODAY)
    expect(ids(settled.entries).sort()).toEqual([bid(2), bid(6)].sort())

    const cancelled = selectOverviewListPage(
      ENTRIES,
      q({ status: 'cancelled' }),
      TODAY,
    )
    expect(ids(cancelled.entries)).toEqual([bid(4)])

    // n7 is offline-handled only: it appears under 'all' but in neither of the others.
    expect(ids(unsettled.entries)).not.toContain(bid(7))
    expect(ids(settled.entries)).not.toContain(bid(7))
    expect(ids(cancelled.entries)).not.toContain(bid(7))
  })

  it('departureId filter matches on departure_id', () => {
    const byDep = selectOverviewListPage(
      ENTRIES,
      q({ departureId: depId(1) }),
      TODAY,
    )
    expect(ids(byDep.entries).sort()).toEqual([bid(1), bid(2), bid(7)].sort())

    const noDep = selectOverviewListPage(ENTRIES, q({ departureId: null }), TODAY)
    expect(ids(noDep.entries)).toEqual([bid(5)])

    const anyDep = selectOverviewListPage(
      ENTRIES,
      q({ departureId: undefined }),
      TODAY,
    )
    expect(anyDep.total).toBe(6)
  })

  it('tourId filter keeps only that tour', () => {
    const byTour = selectOverviewListPage(ENTRIES, q({ tourId: tourId(2) }), TODAY)
    expect(ids(byTour.entries)).toEqual([bid(6)])
  })

  it('orders nearest-first: upcoming ascending, then past descending, then undated', () => {
    const page = selectOverviewListPage(ENTRIES, q({ status: 'all' }), TODAY)
    expect(ids(page.entries)).toEqual([
      bid(6),
      bid(1),
      bid(2),
      bid(7),
      bid(3),
      bid(5),
    ])
  })

  it('paginates and clamps the page number', () => {
    const many: BookingSpec[] = []
    for (let n = 100; n <= 219; n += 1) {
      many.push({
        n,
        departureId: depId(1),
        deposit: { state: 'paid' },
        balance: { due: '2027-01-01' },
      })
    }
    const entries = entriesOf(many, FACTS)

    const p1 = selectOverviewListPage(entries, q({ page: 1 }), TODAY)
    expect(p1.entries).toHaveLength(50)
    expect(p1.pageCount).toBe(3)
    expect(p1.total).toBe(120)
    expect(p1.page).toBe(1)

    const p3 = selectOverviewListPage(entries, q({ page: 3 }), TODAY)
    expect(p3.entries).toHaveLength(20)
    expect(p3.page).toBe(3)

    expect(selectOverviewListPage(entries, q({ page: 9 }), TODAY).page).toBe(3)
    expect(selectOverviewListPage(entries, q({ page: 0 }), TODAY).page).toBe(1)
    expect(selectOverviewListPage(entries, q({ page: 1.5 }), TODAY).page).toBe(1)

    const empty = selectOverviewListPage([], q({ page: 1 }), TODAY)
    expect(empty.pageCount).toBe(1)
    expect(empty.page).toBe(1)
    expect(empty.total).toBe(0)
    expect(empty.entries).toHaveLength(0)
  })
})

describe('toOverviewListRows', () => {
  it('builds rows with names, cells and cancel notes', () => {
    const page = selectOverviewListPage(
      ENTRIES,
      q({ departureId: depId(1) }),
      TODAY,
    )
    const names = new Map<string, string | null>([[cid(1), 'Wang M.']])
    const rows = toOverviewListRows(page.entries, names)

    const r1 = rows.find((r) => r.bookingId === bid(1))
    if (r1 === undefined) throw new Error('missing row for booking 1')
    expect(r1.contactName).toBe('Wang M.')
    expect(r1.deposit?.state).toBe('paid')
    expect(r1.balance?.state).toBe('unpaid')
    expect(r1.balance?.dueOn).toBe('2027-01-01')

    const cancelledPage = selectOverviewListPage(
      ENTRIES,
      q({ status: 'cancelled' }),
      TODAY,
    )
    const cancelledRows = toOverviewListRows(cancelledPage.entries, names)
    const r4 = cancelledRows.find((r) => r.bookingId === bid(4))
    if (r4 === undefined) throw new Error('missing row for booking 4')
    expect(r4.contactName).toBeNull()
    expect(r4.status).toBe('cancelled')
    // D4: a cancelled order owes nothing, so no cells that could read as money still due.
    expect(r4.deposit).toBeNull()
    expect(r4.balance).toBeNull()
    expect(r4.note).toBe('changed plans')
  })

  it('carries no money', () => {
    const page = selectOverviewListPage(ENTRIES, q({ status: 'all' }), TODAY)
    const rows = toOverviewListRows(page.entries, new Map())
    expect(JSON.stringify(rows)).not.toMatch(/amount|price|money|revenue/i)
    const first = rows[0]
    if (first === undefined) throw new Error('missing first row')
    expect(Object.keys(first).sort()).toEqual(
      [
        'bookingId',
        'contactId',
        'contactName',
        'tourId',
        'tourName',
        'departureId',
        'departOn',
        'status',
        'deposit',
        'balance',
        'partySize',
        'lastNudgedOn',
        'warnings',
        'note',
      ].sort(),
    )
  })
})

describe('lastNudgedOn', () => {
  it('returns the latest nudge over the milestones', () => {
    const item = itemOf({
      n: 1,
      departureId: depId(1),
      deposit: { nudgedOn: '2026-10-01' },
      balance: { nudgedOn: '2026-10-05' },
    })
    expect(lastNudgedOn(item)).toBe('2026-10-05')
  })

  it('returns null when nothing was nudged', () => {
    const item = itemOf({ n: 2, departureId: depId(1) })
    expect(lastNudgedOn(item)).toBeNull()
  })

  it('the row carries the same lastNudgedOn', () => {
    const entries = entriesOf(
      [
        {
          n: 1,
          departureId: depId(1),
          deposit: { nudgedOn: '2026-10-01' },
          balance: { nudgedOn: '2026-10-05' },
        },
      ],
      FACTS,
    )
    const rows = toOverviewListRows(entries, new Map())
    const row = rows[0]
    if (row === undefined) throw new Error('missing row')
    expect(row.lastNudgedOn).toBe('2026-10-05')
  })
})
