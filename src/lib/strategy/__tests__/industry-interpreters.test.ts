import { afterEach, describe, expect, it, vi } from 'vitest'
import * as calc from '@/lib/crm/sales-progress/calc'
import type { SalesBooking, SalesUnit } from '@/lib/crm/sales-progress/types'
import {
  INDUSTRY_INTERPRETER_KEY,
  applyIndustryInterpreter,
  resolveIndustryInterpreter,
  routeSignupCount,
} from '../industry-interpreters'
import {
  DEPOSITED_SEAT_SCOPE_KEY,
  TRAVEL_DEPOSITED_SEATS_ID,
  countTravelDepositedSeats,
} from '../outcome-profiles/travel-deposited-seats'
import type { DepositMarkedBooking } from '../outcome-profiles/travel-deposited-seats'

const DEPART = '2027-03-11'
const OTHER = '2027-03-18'

afterEach(() => {
  vi.restoreAllMocks()
})

function unit(overrides: Partial<SalesUnit> = {}): SalesUnit {
  return {
    unitId: 'u1',
    groupId: 'tour-b',
    label: 'B',
    date: DEPART,
    capacity: 20,
    capacityNote: null,
    unitStatus: 'open',
    ...overrides,
  }
}

function booking(overrides: Partial<SalesBooking> = {}): SalesBooking {
  return {
    id: 'b1',
    tourId: 'tour-b',
    departureId: 'u1',
    departureDepartOn: DEPART,
    bookedOn: '2026-10-22',
    partySize: 2,
    originKind: 'company_confirmed',
    evidenceRef: null,
    status: 'active',
    ...overrides,
  }
}

function paid(overrides: Partial<SalesBooking> = {}, depositPaid = true): DepositMarkedBooking {
  return { booking: booking(overrides), depositPaid }
}

function scope(departures: { depart_on: string; tour_id?: string }[]) {
  return { key: DEPOSITED_SEAT_SCOPE_KEY, label: '已收定金座位', departures }
}

function optIn(extra: Record<string, unknown> = {}) {
  return {
    key: INDUSTRY_INTERPRETER_KEY,
    enabled: true,
    interpreter_id: TRAVEL_DEPOSITED_SEATS_ID,
    ...extra,
  }
}

function opened(departures: { depart_on: string; tour_id?: string }[] = [{ depart_on: DEPART }]) {
  return [optIn(), scope(departures)]
}

describe('resolveIndustryInterpreter', () => {
  it('stays on the original metric when the goal has no interpreter config', () => {
    expect(resolveIndustryInterpreter(undefined, 'travel')).toEqual({ mode: 'original' })
    expect(resolveIndustryInterpreter([], 'travel')).toEqual({ mode: 'original' })
    expect(resolveIndustryInterpreter({ industry: 'travel' }, 'travel')).toEqual({ mode: 'original' })
  })

  it('does not switch when only departure dates are filled', () => {
    const decision = resolveIndustryInterpreter([scope([{ depart_on: DEPART }])], 'travel')
    expect(decision).toEqual({ mode: 'original' })
  })

  it('does not switch when the interpreter is explicitly off', () => {
    const supporting = [
      { key: INDUSTRY_INTERPRETER_KEY, enabled: false },
      scope([{ depart_on: DEPART, tour_id: 'tour-b' }]),
    ]
    expect(resolveIndustryInterpreter(supporting, 'travel')).toEqual({ mode: 'original' })
  })

  it('refuses a half-written switch instead of falling back to deal rows', () => {
    const supporting = [{ key: INDUSTRY_INTERPRETER_KEY, enabled: 'true', interpreter_id: TRAVEL_DEPOSITED_SEATS_ID }]
    const decision = resolveIndustryInterpreter(supporting, null)
    expect(decision.mode).toBe('unknown')
    if (decision.mode === 'unknown') expect(decision.reason.length).toBeGreaterThan(0)
  })

  it('refuses an enabled switch with no known interpreter', () => {
    const supporting = [{ key: INDUSTRY_INTERPRETER_KEY, enabled: true, interpreter_id: 'flooring.contracts' }]
    expect(resolveIndustryInterpreter(supporting, 'travel').mode).toBe('unknown')
  })

  it('refuses two enabled interpreters', () => {
    const supporting = [optIn(), { ...optIn(), interpreter_id: 'flooring.contracts' }]
    expect(resolveIndustryInterpreter(supporting).mode).toBe('unknown')
  })

  it('requires a readable departure list only after the goal opts in', () => {
    expect(resolveIndustryInterpreter([optIn()]).mode).toBe('unknown')
    expect(resolveIndustryInterpreter([optIn(), scope([])]).mode).toBe('unknown')
    expect(resolveIndustryInterpreter([optIn(), scope([{ depart_on: '2027-13-40' }])]).mode).toBe('unknown')
    expect(resolveIndustryInterpreter([optIn(), scope([{ depart_on: DEPART }]), scope([{ depart_on: OTHER }])]).mode).toBe('unknown')
  })

  it('opens only for the exact interpreter id on that goal', () => {
    const decision = resolveIndustryInterpreter(opened(), 'flooring')
    expect(decision).toMatchObject({ mode: 'count', interpreterId: TRAVEL_DEPOSITED_SEATS_ID })
  })
})

describe('applyIndustryInterpreter', () => {
  it('returns no seat number when the switch is off, even if dates and a travel industry are present', () => {
    const spy = vi.spyOn(calc, 'computeProgress')
    const result = applyIndustryInterpreter({
      industry: 'travel',
      supportingMetrics: [scope([{ depart_on: DEPART }])],
      deposited: { units: [unit()], bookings: [paid({ partySize: 4 })] },
    })
    expect(result).toEqual({ applied: false })
    expect(spy).not.toHaveBeenCalled()
  })

  it('counts one order as one deal and party size as seats', () => {
    const result = applyIndustryInterpreter({
      industry: 'travel',
      supportingMetrics: opened(),
      deposited: { units: [unit()], bookings: [paid({ partySize: 2 })] },
    })
    expect(result).toMatchObject({ applied: true, ok: true, seats: 2, deals: 1 })
  })

  it('uses the total from sales-progress rather than adding party sizes itself', () => {
    vi.spyOn(calc, 'computeProgress').mockReturnValue({
      rows: [
        {
          unit: unit(),
          companyConfirmed: 7,
          customerStated: 0,
          unverified: 0,
          total: 7,
          unfilledOrders: 0,
          remaining: null,
          remainingCompanyOnly: null,
          overBy: 0,
          unattributedPeople: 0,
          bookings: [booking({ partySize: 2 })],
        },
      ],
      onClosedUnits: [],
      unattributedOrders: 0,
      unattributedPeople: 0,
      activeOrders: 1,
    })
    const result = countTravelDepositedSeats(
      { units: [unit()], bookings: [paid({ partySize: 2 })] },
      [{ departOn: DEPART, tourId: null }],
    )
    expect(result).toMatchObject({ ok: true, seats: 7, deals: 1 })
  })

  it('keeps a paid balance from adding a second deal', () => {
    const result = countTravelDepositedSeats(
      {
        units: [unit()],
        bookings: [paid({ id: 'order-1', partySize: 2 }, true), paid({ id: 'order-1', partySize: 2 }, false)],
      },
      [{ departOn: DEPART, tourId: null }],
    )
    expect(result).toMatchObject({ ok: true, seats: 2, deals: 1 })
  })

  it('drops an unpaid order and a cancelled order', () => {
    const result = countTravelDepositedSeats(
      {
        units: [unit()],
        bookings: [
          paid({ id: 'paid', partySize: 2 }, true),
          paid({ id: 'unpaid', partySize: 9 }, false),
          paid({ id: 'cancelled', partySize: 5, status: 'cancelled' }, true),
        ],
      },
      [{ departOn: DEPART, tourId: null }],
    )
    expect(result).toMatchObject({ ok: true, seats: 2, deals: 1 })
  })

  it('attributes ask-A-buy-B seats to the bought departure', () => {
    const result = countTravelDepositedSeats(
      {
        units: [
          unit({ unitId: 'a', groupId: 'tour-a', date: DEPART }),
          unit({ unitId: 'b', groupId: 'tour-b', date: OTHER }),
        ],
        bookings: [paid({ id: 'bought-b', tourId: 'tour-b', departureId: 'b', departureDepartOn: OTHER, partySize: 2 })],
      },
      [
        { departOn: DEPART, tourId: 'tour-a' },
        { departOn: OTHER, tourId: 'tour-b' },
      ],
    )
    expect(result).toMatchObject({
      ok: true,
      seats: 2,
      deals: 1,
      byDeparture: [{ departOn: OTHER, tourId: 'tour-b', seats: 2, deals: 1 }],
    })
  })

  it('counts a bought date that is not in the unit list', () => {
    const result = countTravelDepositedSeats(
      {
        units: [unit({ unitId: 'a', groupId: 'tour-a', date: DEPART })],
        bookings: [
          paid({
            id: 'snapshot-b',
            tourId: 'tour-b',
            departureId: null,
            departureDepartOn: OTHER,
            partySize: 3,
          }),
        ],
      },
      [
        { departOn: DEPART, tourId: null },
        { departOn: OTHER, tourId: null },
      ],
    )
    expect(result).toMatchObject({ ok: true, seats: 3, deals: 1 })
  })

  it('sums seats across the goal departures', () => {
    const result = countTravelDepositedSeats(
      {
        units: [
          unit({ unitId: 'a', groupId: 'tour-a', date: DEPART }),
          unit({ unitId: 'b', groupId: 'tour-b', date: OTHER }),
        ],
        bookings: [
          paid({ id: 'a', tourId: 'tour-a', departureId: 'a', departureDepartOn: DEPART, partySize: 2 }),
          paid({ id: 'b', tourId: 'tour-b', departureId: 'b', departureDepartOn: OTHER, partySize: 3 }),
        ],
      },
      [
        { departOn: DEPART, tourId: null },
        { departOn: OTHER, tourId: null },
      ],
    )
    expect(result).toMatchObject({ ok: true, seats: 5, deals: 2 })
  })

  it('does not publish a number when headcount is missing', () => {
    const result = countTravelDepositedSeats(
      {
        units: [unit()],
        bookings: [paid({ id: 'known', partySize: 2 }), paid({ id: 'blank', partySize: null })],
      },
      [{ departOn: DEPART, tourId: null }],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.unknown).toBe(true)
      expect(result.reason).toContain('人数未知')
      expect(result).not.toHaveProperty('seats')
    }
  })

  it('treats a zero headcount as unknown', () => {
    const result = countTravelDepositedSeats(
      { units: [unit()], bookings: [paid({ partySize: 0 })] },
      [{ departOn: DEPART, tourId: null }],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('人数未知')
  })

  it('does not publish 0 when the departure is closed or has no deposited seats', () => {
    const closed = countTravelDepositedSeats(
      {
        units: [unit({ unitStatus: 'closed' })],
        bookings: [paid({ partySize: 4 })],
      },
      [{ departOn: DEPART, tourId: null }],
    )
    expect(closed.ok).toBe(false)
    if (!closed.ok) {
      expect(closed.reason).toContain('关闭')
      expect(closed).not.toHaveProperty('seats')
    }

    const none = countTravelDepositedSeats(
      { units: [unit()], bookings: [paid({ partySize: 4 }, false)] },
      [{ departOn: DEPART, tourId: null }],
    )
    expect(none.ok).toBe(false)
    if (!none.ok) {
      expect(none).not.toHaveProperty('seats')
      expect(none.reason).not.toContain('0')
    }
  })

  it('still counts open departures when another scoped departure is closed', () => {
    const result = countTravelDepositedSeats(
      {
        units: [unit({ unitId: 'open', date: DEPART }), unit({ unitId: 'shut', date: OTHER, unitStatus: 'cancelled' })],
        bookings: [
          paid({ id: 'open', departureId: 'open', departureDepartOn: DEPART, partySize: 2 }),
          paid({ id: 'shut', departureId: 'shut', departureDepartOn: OTHER, partySize: 4 }),
        ],
      },
      [
        { departOn: DEPART, tourId: null },
        { departOn: OTHER, tourId: null },
      ],
    )
    expect(result).toMatchObject({ ok: true, seats: 2, deals: 1 })
  })

  it('does not publish a partial count when a date-only goal has an undated order on the snapshot tour', () => {
    const result = countTravelDepositedSeats(
      {
        units: [],
        bookings: [
          paid({
            id: 'snapshot-dated',
            tourId: 'tour-b',
            departureId: null,
            departureDepartOn: DEPART,
            partySize: 2,
          }),
          paid({
            id: 'no-tour-date',
            tourId: 'tour-b',
            departureId: null,
            departureDepartOn: null,
            partySize: 3,
          }),
        ],
      },
      [{ departOn: DEPART, tourId: null }],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.unknown).toBe(true)
      expect(result.reason).toContain('出发日未知')
      expect(result).not.toHaveProperty('seats')
    }
  })

  it('blocks the number when a scoped tour has no departure date', () => {
    const result = countTravelDepositedSeats(
      {
        units: [unit()],
        bookings: [paid({ id: 'undated', tourId: 'tour-b', departureId: null, departureDepartOn: null, partySize: 2 })],
      },
      [{ departOn: DEPART, tourId: 'tour-b' }],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('出发日未知')
  })

  it('returns unknown, not the original metric, when opted in without facts', () => {
    const result = applyIndustryInterpreter({ supportingMetrics: opened(), industry: 'travel' })
    expect(result.applied).toBe(true)
    expect(result).not.toHaveProperty('seats')
  })
})

describe('routeSignupCount', () => {
  it('calls only the original counter when the goal has not opted in', () => {
    const original = vi.fn(() => 'deals')
    const depositedSeats = vi.fn(() => 'seats')
    const unknown = vi.fn(() => 'unknown')
    const decision = resolveIndustryInterpreter([scope([{ depart_on: DEPART }])], 'travel')
    expect(routeSignupCount(decision, { original, depositedSeats, unknown })).toBe('deals')
    expect(original).toHaveBeenCalledOnce()
    expect(depositedSeats).not.toHaveBeenCalled()
    expect(unknown).not.toHaveBeenCalled()
  })

  it('calls only the seat counter after the goal opts in', () => {
    const original = vi.fn(() => 'deals')
    const depositedSeats = vi.fn(() => 'seats')
    const unknown = vi.fn(() => 'unknown')
    const decision = resolveIndustryInterpreter(opened(), 'travel')
    expect(routeSignupCount(decision, { original, depositedSeats, unknown })).toBe('seats')
    expect(depositedSeats).toHaveBeenCalledOnce()
    expect(original).not.toHaveBeenCalled()
  })

  it('does not fall back to deal rows when the opt-in cannot be read', () => {
    const original = vi.fn(() => 'deals')
    const depositedSeats = vi.fn(() => 'seats')
    const unknown = vi.fn((reason: string) => reason)
    const decision = resolveIndustryInterpreter([optIn(), scope([{ depart_on: 'not-a-day' }])])
    const result = routeSignupCount(decision, { original, depositedSeats, unknown })
    expect(result).toContain('出发日')
    expect(original).not.toHaveBeenCalled()
    expect(depositedSeats).not.toHaveBeenCalled()
  })
})
