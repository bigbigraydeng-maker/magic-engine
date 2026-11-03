import { describe, expect, it } from 'vitest'
import { addMonthsClamped, emptyDeparturesFor } from '../booking-overview-empty'
import { summariseOverview } from '../booking-overview'
import type { BookingOptionTour } from '../booking-options'
import type { OverviewGroup, OverviewSummary } from '../booking-overview-types'
import { TODAY, depId, entriesOf, factsOf } from './booking-overview-fixtures'
import { TOUR_A1 } from './booking-fixtures'

function group(s: OverviewSummary, key: string): OverviewGroup {
  const found = s.groups.find((g) => g.key === key)
  if (found === undefined) throw new Error(`no group with key ${key}`)
  return found
}

describe('addMonthsClamped', () => {
  it('clamps the day to the last day of the target month', () => {
    expect(addMonthsClamped('2028-02-29', 12)).toBe('2029-02-28')
    expect(addMonthsClamped('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28')
  })

  it('keeps the day when the target month is long enough', () => {
    expect(addMonthsClamped('2026-10-12', 12)).toBe('2027-10-12')
  })
})

describe('emptyDeparturesFor', () => {
  const tour: BookingOptionTour = {
    id: 't1',
    name: 'Tour A',
    durationText: null,
    departures: [
      { id: 'd-open', departOn: '2026-10-12', returnOn: null, status: 'open' },
      { id: 'd-limited', departOn: '2027-10-12', returnOn: null, status: 'limited' },
      { id: 'd-sold', departOn: '2027-01-01', returnOn: null, status: 'sold_out' },
      { id: 'd-closed', departOn: '2027-01-02', returnOn: null, status: 'closed' },
      { id: 'd-cancelled', departOn: '2027-01-03', returnOn: null, status: 'cancelled' },
      { id: 'd-blank', departOn: '2027-01-04', returnOn: null, status: '' },
      { id: 'd-past', departOn: '2026-10-11', returnOn: null, status: 'open' },
      { id: 'd-far', departOn: '2027-10-13', returnOn: null, status: 'open' },
    ],
  }

  it('keeps open and limited departures inside the horizon, inclusive', () => {
    const rows = emptyDeparturesFor([tour], TODAY)
    const ids = rows.map((r) => r.departureId)
    expect(ids).toContain('d-open')
    expect(ids).toContain('d-limited')
  })

  it('drops sold_out, closed, cancelled and blank statuses', () => {
    const rows = emptyDeparturesFor([tour], TODAY)
    const ids = rows.map((r) => r.departureId)
    expect(ids).not.toContain('d-sold')
    expect(ids).not.toContain('d-closed')
    expect(ids).not.toContain('d-cancelled')
    expect(ids).not.toContain('d-blank')
  })

  it('drops past dates and dates beyond the horizon', () => {
    const rows = emptyDeparturesFor([tour], TODAY)
    const ids = rows.map((r) => r.departureId)
    expect(ids).not.toContain('d-past')
    expect(ids).not.toContain('d-far')
  })

  it('de-duplicates departures of the same tour on the same date, keeping the first', () => {
    const dup: BookingOptionTour = {
      id: 't1',
      name: 'Tour A',
      durationText: null,
      departures: [
        { id: 'd-first', departOn: '2027-03-26', returnOn: null, status: 'open' },
        { id: 'd-second', departOn: '2027-03-26', returnOn: null, status: 'open' },
      ],
    }
    const rows = emptyDeparturesFor([dup], TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].departureId).toBe('d-first')
  })

  it('sorts by departOn then tour name across two tours', () => {
    const a: BookingOptionTour = {
      id: 'ta',
      name: 'Tour B',
      durationText: null,
      departures: [{ id: 'a-1', departOn: '2027-03-26', returnOn: null, status: 'open' }],
    }
    const b: BookingOptionTour = {
      id: 'tb',
      name: 'Tour A',
      durationText: null,
      departures: [
        { id: 'b-1', departOn: '2027-03-26', returnOn: null, status: 'open' },
        { id: 'b-2', departOn: '2027-01-01', returnOn: null, status: 'open' },
      ],
    }
    const rows = emptyDeparturesFor([a, b], TODAY)
    expect(rows.map((r) => r.departureId)).toEqual(['b-2', 'b-1', 'a-1'])
  })

  it('normalises a timestamp departOn to a plain date', () => {
    const ts: BookingOptionTour = {
      id: 't1',
      name: 'Tour A',
      durationText: null,
      departures: [{ id: 'd-ts', departOn: '2027-03-26T00:00:00+00:00', returnOn: null, status: 'open' }],
    }
    const rows = emptyDeparturesFor([ts], TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].departOn).toBe('2027-03-26')
  })
})

describe('summariseOverview with empty departures', () => {
  const FACTS = factsOf([{ id: depId(1), departOn: '2027-03-19' }])

  it('adds an empty group that contributes nothing to the totals', () => {
    const entries = entriesOf(
      [{ n: 1, departureId: depId(1), partySize: 4 }],
      FACTS,
    )
    const s = summariseOverview(entries, TODAY, false, [
      {
        departureId: depId(2),
        tourId: 'tour-x',
        tourName: 'Tour X',
        departOn: '2027-03-26',
      },
    ])
    expect(s.groups).toHaveLength(2)

    const empty = group(s, depId(2))
    expect(empty.orders).toBe(0)
    expect(empty.partySize).toBe(0)
    expect(empty.partySizeMissing).toBe(0)
    expect(empty.depositPaid).toBe(0)
    expect(empty.balancePaid).toBe(0)
    expect(empty.unsettled).toBe(0)
    expect(empty.nearestDueOn).toBeNull()
    expect(empty.departed).toBe(false)

    expect(s.groups[0].key).toBe(depId(1))
    expect(s.groups[1].key).toBe(depId(2))

    expect(s.totals.orders).toBe(1)
    expect(s.totals.partySize).toBe(4)
  })

  it('does not duplicate a group whose departureId already exists', () => {
    const entries = entriesOf(
      [{ n: 1, departureId: depId(1), partySize: 4 }],
      FACTS,
    )
    const s = summariseOverview(entries, TODAY, false, [
      {
        departureId: depId(1),
        tourId: 'tour-x',
        tourName: 'Tour X',
        departOn: '2027-03-26',
      },
    ])
    const matching = s.groups.filter((g) => g.key === depId(1))
    expect(matching).toHaveLength(1)
    expect(matching[0].orders).toBe(1)
  })

  it('does not add an empty departure matching an existing tour and date', () => {
    const entries = entriesOf(
      [{ n: 1, departureId: depId(1), partySize: 4 }],
      FACTS,
    )
    const s = summariseOverview(entries, TODAY, false, [
      {
        departureId: depId(2),
        tourId: TOUR_A1,
        tourName: 'Tour A',
        departOn: '2027-03-19',
      },
    ])
    expect(s.groups).toHaveLength(1)
    expect(s.groups[0].key).toBe(depId(1))
  })

  it('never hides empty rows and keeps hiddenGroupCount at zero', () => {
    const entries = entriesOf(
      [{ n: 1, departureId: depId(1), partySize: 4 }],
      FACTS,
    )
    const s = summariseOverview(entries, TODAY, false, [
      {
        departureId: depId(2),
        tourId: 'tour-x',
        tourName: 'Tour X',
        departOn: '2027-03-26',
      },
    ])
    expect(s.hiddenGroupCount).toBe(0)
    expect(s.groups.some((g) => g.key === depId(2))).toBe(true)
  })

  it('behaves as before when no empty departures are passed', () => {
    const entries = entriesOf(
      [{ n: 1, departureId: depId(1), partySize: 4 }],
      FACTS,
    )
    const s = summariseOverview(entries, TODAY, false)
    expect(s.groups).toHaveLength(1)
    expect(s.groups[0].key).toBe(depId(1))
  })

  it('keeps an empty departure of a different tour on the same day as a booked group', () => {
    const entries = entriesOf([{ n: 1, departureId: depId(1), partySize: 2 }], FACTS)
    const s = summariseOverview(entries, TODAY, false, [
      { departureId: depId(3), tourId: 'other-tour', tourName: 'Other Tour', departOn: '2027-03-19' },
    ])
    expect(s.groups.map((g) => g.key)).toEqual(expect.arrayContaining([depId(1), depId(3)]))
    expect(s.groups).toHaveLength(2)
  })
})
