import { describe, expect, it } from 'vitest'
import { summariseOverview } from '../booking-overview'
import type { OverviewGroup, OverviewSummary } from '../booking-overview-types'
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
  { id: depId(5), departOn: '2027-03-19', returnOn: '2027-03-01' },
])

function group(s: OverviewSummary, key: string): OverviewGroup {
  const found = s.groups.find((g) => g.key === key)
  if (found === undefined) throw new Error(`no group with key ${key}`)
  return found
}

describe('counting rules', () => {
  it('cancelled orders are excluded from every column and counted separately', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 2,
            departureId: depId(1),
            status: 'cancelled',
            deposit: { due: '2026-10-01' },
            balance: { due: '2026-10-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.orders).toBe(1)
    expect(g.unsettled).toBe(1)
    expect(g.unsettledOverdue).toBe(0)
    expect(g.offlineHandled).toBe(0)
    expect(s.notes.cancelledOrders).toBe(1)
    expect(s.totals.orders).toBe(1)
  })

  it('deposit paid and balance paid are counted separately', () => {
    const entries = entriesOf(
      [
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
          departureId: depId(1),
          deposit: { due: '2027-01-01' },
          balance: { due: '2027-01-02' },
        },
      ],
      FACTS,
    )
    const s = summariseOverview(entries, TODAY, false)
    const g = group(s, depId(1))
    expect(g.orders).toBe(3)
    expect(g.depositPaid).toBe(2)
    expect(g.balancePaid).toBe(1)
    expect(g.fullyPaid).toBe(1)
    expect(g.unsettled).toBe(2)

    const n2 = entries.find((e) => e.item.booking.id === bid(2))
    if (n2 === undefined) throw new Error('missing entry for booking 2')
    expect(n2.view.milestones).toHaveLength(2)
    for (const m of n2.view.milestones) expect(m.state).toBe('paid')
    expect(g.fullyPaid).toBeLessThanOrEqual(
      Math.min(g.depositPaid, g.balancePaid),
    )
  })

  it('unsettled and overdue', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { due: '2026-10-01' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 2,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 3,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { state: 'paid' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.orders).toBe(3)
    expect(g.unsettled).toBe(2)
    expect(g.unsettledOverdue).toBe(1)
  })

  it('an item due today is not overdue, due yesterday is', () => {
    const today = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { due: '2026-10-12' },
            balance: { state: 'paid' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const gToday = group(today, depId(1))
    expect(gToday.unsettled).toBe(1)
    expect(gToday.unsettledOverdue).toBe(0)

    const yesterday = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { due: '2026-10-11' },
            balance: { state: 'paid' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const gYesterday = group(yesterday, depId(1))
    expect(gYesterday.unsettled).toBe(1)
    expect(gYesterday.unsettledOverdue).toBe(1)
  })

  it('offline handled only counts unpaid quiet items and is not part of unsettled', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { quiet: true, due: '2026-10-01' },
            balance: { state: 'paid' },
          },
          {
            n: 2,
            departureId: depId(1),
            deposit: { state: 'paid', quiet: true },
            balance: { due: '2027-01-01' },
          },
          {
            n: 3,
            departureId: depId(1),
            deposit: { quiet: true, due: '2026-10-01' },
            balance: { due: '2027-01-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.orders).toBe(3)
    expect(g.unsettled).toBe(2)
    expect(g.unsettledOverdue).toBe(0)
    expect(g.offlineHandled).toBe(2)
    expect(s.notes.offlineHandledOrders).toBe(2)
    // unsettled (2) + offlineHandled (2) = 4 exceeds orders (3): the two columns are not exclusive.
  })

  it('a quiet overdue item is never counted as overdue', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { quiet: true, due: '2026-10-01' },
            balance: { state: 'paid' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.unsettledOverdue).toBe(0)
    expect(g.unsettled).toBe(0)
  })

  it('nearest due date is the earliest open item, ignoring quiet and paid ones', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { due: '2026-11-20' },
            balance: { due: '2027-01-05' },
          },
          {
            n: 2,
            departureId: depId(1),
            deposit: { quiet: true, due: '2026-10-01' },
            balance: { due: '2026-12-01' },
          },
          {
            n: 3,
            departureId: depId(1),
            deposit: { state: 'paid', due: '2026-09-01' },
            balance: { state: 'paid' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(group(s, depId(1)).nearestDueOn).toBe('2026-11-20')

    const allPaid = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { state: 'paid' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(group(allPaid, depId(1)).nearestDueOn).toBeNull()
  })

  it('orders with no departure chosen: the deposit still gets a due date and can be overdue, the balance never does', () => {
    const entries = entriesOf(
      [
        {
          n: 1,
          departureId: null,
          snapshot: null,
          bookedOn: '2026-10-01',
          deposit: {},
          balance: {},
        },
        {
          n: 2,
          departureId: null,
          snapshot: null,
          bookedOn: '2026-10-01',
          deposit: { state: 'paid' },
          balance: {},
        },
      ],
      FACTS,
    )
    const s = summariseOverview(entries, TODAY, false)
    const g = group(s, 'none')
    expect(g.kind).toBe('undecided')
    expect(g.tourId).toBeNull()
    expect(g.orders).toBe(2)
    expect(g.depositPaid).toBe(1)
    expect(g.unsettled).toBe(2)
    expect(g.unsettledOverdue).toBe(1)
    expect(g.nearestDueOn).toBe('2026-10-06')

    const n1 = entries.find((e) => e.item.booking.id === bid(1))
    if (n1 === undefined) throw new Error('missing entry for booking 1')
    const balance = n1.view.milestones.find((m) => m.kind === 'balance')
    if (balance === undefined) throw new Error('missing balance milestone')
    expect(balance.dueOn).toBeNull()
    expect(balance.overdue).toBe(false)
  })

  it('a booking whose due dates cannot be computed is treated like one with no departure', () => {
    const entries = entriesOf(
      [
        {
          n: 1,
          departureId: depId(5),
          snapshot: '2027-03-19',
          bookedOn: '2026-10-01',
          deposit: {},
          balance: {},
        },
        {
          n: 2,
          departureId: depId(5),
          snapshot: '2027-03-19',
          bookedOn: '2026-10-01',
          deposit: { state: 'paid' },
          balance: {},
        },
      ],
      FACTS,
    )
    const s = summariseOverview(entries, TODAY, false)
    const g = group(s, depId(5))
    expect(g.orders).toBe(2)
    expect(g.unsettled).toBe(2)
    expect(g.unsettledOverdue).toBe(1)
    expect(g.depositPaid).toBe(1)

    const n1 = entries.find((e) => e.item.booking.id === bid(1))
    if (n1 === undefined) throw new Error('missing entry for booking 1')
    const balance = n1.view.milestones.find((m) => m.kind === 'balance')
    if (balance === undefined) throw new Error('missing balance milestone')
    expect(balance.dueOn).toBeNull()
    expect(balance.overdue).toBe(false)
  })

  it('due dates follow the live departure date, not the stored snapshot', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            snapshot: '2026-10-20',
            bookedOn: '2026-09-01',
            deposit: { state: 'paid' },
            balance: {},
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.nearestDueOn).toBe('2026-12-19')
    expect(g.unsettledOverdue).toBe(0)
    expect(g.warningCodes).toContain('departure_changed')
  })

  it('an override due date beats the computed one', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { due: '2026-10-05' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(g.unsettledOverdue).toBe(1)
    expect(g.nearestDueOn).toBe('2026-10-05')
  })

  it('snoozed orders are counted in the note only', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { remindAfter: '2026-11-01' },
          },
          {
            n: 2,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { remindAfter: '2026-10-01' },
          },
          {
            n: 3,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { state: 'paid', remindAfter: '2026-11-01' },
          },
          {
            n: 4,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { quiet: true, remindAfter: '2026-11-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(1))
    expect(s.notes.snoozedOrders).toBe(1)
    expect(g.unsettled).toBe(2)
    expect(g.offlineHandled).toBe(1)
  })

  it('the summary carries no money', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(1),
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(JSON.stringify(s)).not.toMatch(/amount|price|money|revenue/i)
  })
})
