import { describe, expect, it } from 'vitest'
import { summariseOverview } from '../booking-overview'
import type { OverviewGroup, OverviewSummary } from '../booking-overview-types'
import {
  selectOverviewListPage,
  toOverviewListRows,
} from '../booking-overview-list'
import type { OverviewListQuery } from '../booking-overview-types'
import {
  TODAY,
  bid,
  depId,
  entriesOf,
  factsOf,
} from './booking-overview-fixtures'

const FACTS = factsOf([
  { id: depId(1), departOn: '2027-03-19' },
  { id: depId(2), departOn: '2026-09-20' },
])

function group(s: OverviewSummary, key: string): OverviewGroup {
  const found = s.groups.find((g) => g.key === key)
  if (found === undefined) throw new Error(`no group with key ${key}`)
  return found
}

function q(over: Partial<OverviewListQuery>): OverviewListQuery {
  return { status: 'all', page: 1, ...over }
}

describe('party size counting', () => {
  it('sums party sizes of active bookings on the same departure', () => {
    const s = summariseOverview(
      entriesOf(
        [
          { n: 1, departureId: depId(1), partySize: 4 },
          { n: 2, departureId: depId(1), partySize: 2 },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.partySize).toBe(6)
    expect(g.partySizeMissing).toBe(0)
    expect(s.totals.partySize).toBe(6)
  })

  it('counts a null party size as missing, not as zero', () => {
    const s = summariseOverview(
      entriesOf(
        [
          { n: 1, departureId: depId(1), partySize: 4 },
          { n: 2, departureId: depId(1), partySize: null },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.partySize).toBe(4)
    expect(g.partySizeMissing).toBe(1)
  })

  it('reports zero party size and every order missing when all are null', () => {
    const s = summariseOverview(
      entriesOf(
        [
          { n: 1, departureId: depId(1), partySize: null },
          { n: 2, departureId: depId(1), partySize: null },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.partySize).toBe(0)
    expect(g.partySizeMissing).toBe(g.orders)
  })

  it('excludes cancelled bookings from both party size and missing', () => {
    const s = summariseOverview(
      entriesOf(
        [
          { n: 1, departureId: depId(1), status: 'cancelled', partySize: 9 },
          { n: 2, departureId: depId(1), partySize: 3 },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.partySize).toBe(3)
    expect(g.partySizeMissing).toBe(0)
  })

  it('totals equal the sum over the groups', () => {
    const s = summariseOverview(
      entriesOf(
        [
          { n: 1, departureId: depId(1), partySize: 4 },
          { n: 2, departureId: depId(1), partySize: null },
          { n: 3, departureId: depId(2), partySize: 2 },
          { n: 4, departureId: depId(2), partySize: 5 },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const sumPartySize = s.groups.reduce((acc, g) => acc + g.partySize, 0)
    const sumMissing = s.groups.reduce((acc, g) => acc + g.partySizeMissing, 0)
    expect(s.totals.partySize).toBe(sumPartySize)
    expect(s.totals.partySizeMissing).toBe(sumMissing)
  })
})

describe('party size on list rows', () => {
  it('carries the booking party size, keeps null as null and drops cancelled', () => {
    const entries = entriesOf(
      [
        { n: 1, departureId: depId(1), partySize: 4 },
        { n: 2, departureId: depId(1), partySize: null },
        { n: 3, departureId: depId(1), status: 'cancelled', partySize: 9 },
      ],
      FACTS,
    )

    const active = selectOverviewListPage(entries, q({ status: 'all' }), TODAY)
    const activeRows = toOverviewListRows(active.entries, new Map())
    const r1 = activeRows.find((r) => r.bookingId === bid(1))
    if (r1 === undefined) throw new Error('missing row for booking 1')
    expect(r1.partySize).toBe(4)

    const r2 = activeRows.find((r) => r.bookingId === bid(2))
    if (r2 === undefined) throw new Error('missing row for booking 2')
    expect(r2.partySize).toBeNull()

    const cancelled = selectOverviewListPage(
      entries,
      q({ status: 'cancelled' }),
      TODAY,
    )
    const cancelledRows = toOverviewListRows(cancelled.entries, new Map())
    const r3 = cancelledRows.find((r) => r.bookingId === bid(3))
    if (r3 === undefined) throw new Error('missing row for booking 3')
    expect(r3.partySize).toBeNull()
  })

  it('carries no money', () => {
    const entries = entriesOf(
      [
        { n: 1, departureId: depId(1), partySize: 4 },
        { n: 2, departureId: depId(1), partySize: null },
      ],
      FACTS,
    )
    const s = summariseOverview(entries, TODAY, false)
    expect(JSON.stringify(s)).not.toMatch(/amount|price|money|revenue/i)

    const page = selectOverviewListPage(entries, q({ status: 'all' }), TODAY)
    const rows = toOverviewListRows(page.entries, new Map())
    expect(JSON.stringify(rows)).not.toMatch(/amount|price|money|revenue/i)
  })

  it('keeps the people of a hidden (departed and fully settled) group out of the totals', () => {
    const paid = { state: 'paid' as const }
    const s = summariseOverview(
      entriesOf(
        [
          { n: 1, departureId: depId(1), partySize: 5 },
          { n: 2, departureId: depId(2), partySize: 9, deposit: paid, balance: paid },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(s.hiddenGroupCount).toBe(1)
    expect(s.totals.partySize).toBe(5)
  })
})
