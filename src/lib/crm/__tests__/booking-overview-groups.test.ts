import { describe, expect, it } from 'vitest'
import { summariseOverview } from '../booking-overview'
import type { OverviewGroup, OverviewSummary } from '../booking-overview-types'
import {
  TODAY,
  depId,
  entriesOf,
  factsOf,
} from './booking-overview-fixtures'

const FACTS = factsOf([
  { id: depId(1), departOn: '2027-03-19' },
  { id: depId(4), departOn: '2027-03-19' },
  { id: depId(2), departOn: '2026-09-20' },
  { id: depId(3), departOn: '2026-11-02' },
  { id: depId(7), departOn: '2026-10-12' },
  { id: depId(10), departOn: '2026-08-01' },
])

function group(s: OverviewSummary, key: string): OverviewGroup {
  const found = s.groups.find((g) => g.key === key)
  if (found === undefined) throw new Error(`no group with key ${key}`)
  return found
}

function keys(s: OverviewSummary): string[] {
  return s.groups.map((g) => g.key)
}

describe('grouping by departure id, not by date', () => {
  it('two different departures on the same date stay two groups', () => {
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
            departureId: depId(4),
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(s.groups).toHaveLength(2)
    const g1 = group(s, depId(1))
    const g4 = group(s, depId(4))
    expect(g1.orders).toBe(1)
    expect(g4.orders).toBe(1)
    expect(g1.departOn).toBe('2027-03-19')
    expect(g4.departOn).toBe('2027-03-19')
  })

  it('one departure whose stored dates differ stays one group', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(6),
            snapshot: '2027-03-19',
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 2,
            departureId: depId(6),
            snapshot: '2027-03-22',
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(s.groups).toHaveLength(1)
    const g = group(s, depId(6))
    expect(g.orders).toBe(2)
    expect(g.departOn).toBe('2027-03-19')
    expect(g.warningCodes).toContain('departure_missing')
  })

  it('orders with no departure share one group keyed none', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: null,
            snapshot: null,
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 2,
            departureId: null,
            snapshot: null,
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(s.groups).toHaveLength(1)
    const g = group(s, 'none')
    expect(g.kind).toBe('undecided')
    expect(g.orders).toBe(2)
    expect(g.departureId).toBeNull()
    expect(g.departOn).toBeNull()
    expect(g.tourId).toBeNull()
  })
})

describe('the departed flag', () => {
  it('the flag comes from the departure date only', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(2),
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 2,
            departureId: depId(3),
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 3,
            departureId: depId(7),
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 4,
            departureId: depId(8),
            snapshot: '2026-08-01',
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(group(s, depId(2)).departed).toBe(true)
    expect(group(s, depId(3)).departed).toBe(false)
    expect(group(s, depId(7)).departed).toBe(false)
    const g8 = group(s, depId(8))
    expect(g8.departed).toBe(true)
    expect(g8.warningCodes).toContain('departure_missing')
  })

  it('a departure id with no date anywhere is an unknown-date group', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(9),
            snapshot: null,
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    const g = group(s, depId(9))
    expect(g.kind).toBe('unknown_date')
    expect(g.departOn).toBeNull()
    expect(g.departed).toBe(false)
  })
})

describe('default view', () => {
  const specs = [
    {
      n: 1,
      departureId: depId(3),
      deposit: { state: 'paid' as const },
      balance: { state: 'paid' as const },
    },
    {
      n: 2,
      departureId: depId(2),
      deposit: { state: 'paid' as const },
      balance: { due: '2027-01-01' },
    },
    {
      n: 3,
      departureId: depId(10),
      deposit: { state: 'paid' as const },
      balance: { state: 'paid' as const },
    },
    {
      n: 4,
      departureId: depId(9),
      snapshot: null,
      deposit: { state: 'paid' as const },
      balance: { due: '2027-01-01' },
    },
    {
      n: 5,
      departureId: depId(11),
      snapshot: null,
      deposit: { state: 'paid' as const },
      balance: { state: 'paid' as const },
    },
    {
      n: 6,
      departureId: null,
      snapshot: null,
      deposit: { state: 'paid' as const },
      balance: { state: 'paid' as const },
    },
  ]

  it('default view keeps future groups, past groups that still have unpaid items, unknown-date groups that still owe, and the undecided group; it hides past fully paid groups', () => {
    const s = summariseOverview(entriesOf(specs, FACTS), TODAY, false)
    expect(keys(s)).toEqual([depId(2), depId(3), depId(9), 'none'])
    expect(s.hiddenGroupCount).toBe(2)

    const all = summariseOverview(entriesOf(specs, FACTS), TODAY, true)
    expect(keys(all)).toEqual([
      depId(10),
      depId(2),
      depId(3),
      depId(9),
      depId(11),
      'none',
    ])
    expect(all.hiddenGroupCount).toBe(0)
  })

  // S4 (product owner's delegate): this test used to pin the OLD rule (such a group stayed visible).
  // New rule: offline-handled = staff said "stop reminding me", so the group is hidden by default,
  // but it is counted in hiddenOfflineOnlyGroups so the page can say so.
  it('a past group whose only unpaid item is offline-handled is hidden by default but counted', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(2),
            deposit: { state: 'paid' },
            balance: { quiet: true, due: '2026-09-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(s.groups.find((x) => x.key === depId(2))).toBeUndefined()
    expect(s.hiddenGroupCount).toBe(1)
    expect(s.hiddenOfflineOnlyGroups).toBe(1)
    expect(s.hiddenOrders).toBe(1)
    const shown = summariseOverview(
      entriesOf(
        [{ n: 1, departureId: depId(2), deposit: { state: 'paid' }, balance: { quiet: true, due: '2026-09-01' } }],
        FACTS,
      ),
      TODAY,
      true,
    )
    const g = group(shown, depId(2))
    expect(g.offlineHandled).toBe(1)
    expect(g.unsettled).toBe(0)
  })

  it('a past group with unpaid items is shown even though no due date can be computed', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(8),
            snapshot: '2026-08-01',
            deposit: { state: 'paid' },
            balance: {},
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(keys(s)).toContain(depId(8))
  })

  it('totals add up over the visible groups only', () => {
    const s = summariseOverview(entriesOf(specs, FACTS), TODAY, false)
    const orders = s.groups.reduce((sum, g) => sum + g.orders, 0)
    const unsettled = s.groups.reduce((sum, g) => sum + g.unsettled, 0)
    expect(s.totals.orders).toBe(orders)
    expect(s.totals.unsettled).toBe(unsettled)
    expect(s.totals.orders).toBe(4)
  })

  it('ordering: dated groups by date then tour name, then unknown-date groups, then undecided last', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: null,
            snapshot: null,
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 2,
            departureId: depId(9),
            snapshot: null,
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 3,
            departureId: depId(4),
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 4,
            departureId: depId(3),
            deposit: { state: 'paid' },
            balance: { due: '2027-01-01' },
          },
          {
            n: 5,
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
    expect(keys(s)).toEqual([depId(3), depId(1), depId(4), depId(9), 'none'])
  })

  it('an empty or all-cancelled departure produces no group', () => {
    const s = summariseOverview(
      entriesOf(
        [
          {
            n: 1,
            departureId: depId(3),
            status: 'cancelled',
            deposit: { due: '2027-01-01' },
            balance: { due: '2027-01-01' },
          },
        ],
        FACTS,
      ),
      TODAY,
      false,
    )
    expect(s.groups).toEqual([])
    expect(s.notes.cancelledOrders).toBe(1)
    expect(s.totals.orders).toBe(0)
  })
})
