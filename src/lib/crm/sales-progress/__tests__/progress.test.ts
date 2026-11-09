/**
 * Draft tests for the read-only "sales progress" calculation.
 * Covers capacity resolution and the computeProgress aggregation rules.
 * Move into __tests__/ when ready; pure unit tests, no IO.
 */

import { describe, it, expect } from 'vitest'
import { effectiveCapacity, readInternalCapacity } from '../capacity'
import { computeProgress } from '../calc'
import type { SalesBooking, SalesUnit } from '../types'

function makeUnit(overrides: Partial<SalesUnit> = {}): SalesUnit {
  return {
    unitId: 'u1',
    groupId: 't1',
    label: 'Departure 1',
    date: '2025-01-01',
    capacity: 10,
    capacityNote: null,
    unitStatus: 'open',
    ...overrides,
  }
}

function makeBooking(overrides: Partial<SalesBooking> = {}): SalesBooking {
  return {
    id: 'b1',
    tourId: 't1',
    departureId: 'u1',
    departureDepartOn: '2025-01-01',
    bookedOn: '2024-12-01',
    partySize: 2,
    originKind: 'company_confirmed',
    evidenceRef: null,
    status: 'active',
    ...overrides,
  }
}

describe('effectiveCapacity', () => {
  it('returns the value when both are valid and equal', () => {
    expect(effectiveCapacity({ internalCapacity: 20, tourMaxGroupSize: 20 })).toEqual({
      capacity: 20,
      note: null,
    })
  })

  it('returns the smaller value with a note when both are valid and different', () => {
    expect(effectiveCapacity({ internalCapacity: 20, tourMaxGroupSize: 18 })).toEqual({
      capacity: 18,
      note: '内部 20 / 官方 18，按 18 算',
    })
  })

  it('uses the internal value when only internal is valid', () => {
    expect(effectiveCapacity({ internalCapacity: 20, tourMaxGroupSize: null })).toEqual({
      capacity: 20,
      note: null,
    })
  })

  it('uses the tour value when only tour is valid', () => {
    expect(effectiveCapacity({ internalCapacity: null, tourMaxGroupSize: 18 })).toEqual({
      capacity: 18,
      note: null,
    })
  })

  it('returns null when neither is valid', () => {
    expect(effectiveCapacity({ internalCapacity: null, tourMaxGroupSize: null })).toEqual({
      capacity: null,
      note: null,
    })
  })

  it('ignores an invalid public tour number, and treats an invalid-but-present internal number as unusable', () => {
    for (const value of ['20', 0, -1, 1.5, NaN, null, undefined]) {
      expect(effectiveCapacity({ internalCapacity: null, tourMaxGroupSize: value })).toEqual({
        capacity: null,
        note: null,
      })
    }
  })
})

describe('readInternalCapacity', () => {
  it('returns only the capacity key from a plain object', () => {
    expect(readInternalCapacity({ capacity: 20, airline: 'CA' })).toBe(20)
  })

  it('returns null for null, arrays and strings', () => {
    expect(readInternalCapacity(null)).toBeNull()
    expect(readInternalCapacity([20])).toBeNull()
    expect(readInternalCapacity('20')).toBeNull()
  })
})

describe('computeProgress', () => {
  it('buckets people by origin', () => {
    const units = [makeUnit()]
    const bookings = [
      makeBooking({ id: 'a', originKind: 'company_confirmed', partySize: 3 }),
      makeBooking({ id: 'b', originKind: 'customer_stated', partySize: 2 }),
      makeBooking({ id: 'c', originKind: 'staff_entered', partySize: 1 }),
    ]
    const result = computeProgress(units, bookings)
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]
    expect(row.companyConfirmed).toBe(3)
    expect(row.customerStated).toBe(2)
    expect(row.unverified).toBe(1)
    expect(row.total).toBe(6)
  })

  it('puts null and staff_entered origins into unverified', () => {
    const units = [makeUnit()]
    const bookings = [
      makeBooking({ id: 'a', originKind: null, partySize: 2 }),
      makeBooking({ id: 'b', originKind: 'staff_entered', partySize: 3 }),
    ]
    const result = computeProgress(units, bookings)
    expect(result.rows[0].unverified).toBe(5)
  })

  it('counts null partySize in unfilledOrders and not in people', () => {
    const units = [makeUnit()]
    const bookings = [makeBooking({ id: 'a', partySize: null })]
    const result = computeProgress(units, bookings)
    const row = result.rows[0]
    expect(row.unfilledOrders).toBe(1)
    expect(row.total).toBe(0)
  })

  it('ignores cancelled bookings and excludes them from activeOrders', () => {
    const units = [makeUnit()]
    const bookings = [
      makeBooking({ id: 'a', partySize: 2 }),
      makeBooking({ id: 'b', partySize: 5, status: 'cancelled' }),
    ]
    const result = computeProgress(units, bookings)
    expect(result.activeOrders).toBe(1)
    expect(result.rows[0].total).toBe(2)
  })

  it('computes remaining (negative allowed) and overBy', () => {
    const units = [makeUnit({ capacity: 5 })]
    const bookings = [makeBooking({ id: 'a', partySize: 8 })]
    const result = computeProgress(units, bookings)
    const row = result.rows[0]
    expect(row.remaining).toBe(-3)
    expect(row.overBy).toBe(3)
  })

  it('computes remainingCompanyOnly', () => {
    const units = [makeUnit({ capacity: 10 })]
    const bookings = [
      makeBooking({ id: 'a', originKind: 'company_confirmed', partySize: 4 }),
      makeBooking({ id: 'b', originKind: 'customer_stated', partySize: 3 }),
    ]
    const result = computeProgress(units, bookings)
    expect(result.rows[0].remainingCompanyOnly).toBe(6)
  })

  it('returns null remaining and zero overBy when capacity is null', () => {
    const units = [makeUnit({ capacity: null })]
    const bookings = [makeBooking({ id: 'a', partySize: 8 })]
    const result = computeProgress(units, bookings)
    const row = result.rows[0]
    expect(row.remaining).toBeNull()
    expect(row.remainingCompanyOnly).toBeNull()
    expect(row.overBy).toBe(0)
  })

  it('routes orders on closed units to onClosedUnits and not into rows', () => {
    const units = [makeUnit({ unitId: 'u1', unitStatus: 'closed' })]
    const bookings = [makeBooking({ id: 'a', departureId: 'u1', partySize: 4 })]
    const result = computeProgress(units, bookings)
    expect(result.rows).toHaveLength(0)
    expect(result.onClosedUnits).toHaveLength(1)
    expect(result.onClosedUnits[0].orders).toBe(1)
    expect(result.onClosedUnits[0].people).toBe(4)
  })

  it('excludes closed units from rows', () => {
    const units = [
      makeUnit({ unitId: 'u1', unitStatus: 'open' }),
      makeUnit({ unitId: 'u2', unitStatus: 'cancelled' }),
    ]
    const result = computeProgress(units, [])
    expect(result.rows.map((row) => row.unit.unitId)).toEqual(['u1'])
  })

  it('treats a null departureId as unattributed and shows people only on matching groupId', () => {
    const units = [
      makeUnit({ unitId: 'u1', groupId: 't1' }),
      makeUnit({ unitId: 'u2', groupId: 't2' }),
    ]
    const bookings = [makeBooking({ id: 'a', departureId: null, tourId: 't1', partySize: 3 })]
    const result = computeProgress(units, bookings)
    expect(result.unattributedOrders).toBe(1)
    expect(result.unattributedPeople).toBe(3)
    const row1 = result.rows.find((row) => row.unit.unitId === 'u1')
    const row2 = result.rows.find((row) => row.unit.unitId === 'u2')
    expect(row1?.unattributedPeople).toBe(3)
    expect(row2?.unattributedPeople).toBe(0)
  })

  it('treats an unknown departureId as unattributed', () => {
    const units = [makeUnit({ unitId: 'u1' })]
    const bookings = [makeBooking({ id: 'a', departureId: 'missing', partySize: 2 })]
    const result = computeProgress(units, bookings)
    expect(result.unattributedOrders).toBe(1)
    expect(result.unattributedPeople).toBe(2)
    expect(result.rows[0].total).toBe(0)
  })

  it('does not mutate the inputs', () => {
    const units = Object.freeze([makeUnit()])
    const bookings = Object.freeze([makeBooking()])
    expect(() => computeProgress(units, bookings)).not.toThrow()
    expect(units).toHaveLength(1)
    expect(bookings).toHaveLength(1)
  })

  it('keeps the order of units in rows', () => {
    const units = [
      makeUnit({ unitId: 'u3' }),
      makeUnit({ unitId: 'u1' }),
      makeUnit({ unitId: 'u2' }),
    ]
    const result = computeProgress(units, [])
    expect(result.rows.map((row) => row.unit.unitId)).toEqual(['u3', 'u1', 'u2'])
  })
})

describe('internal capacity present but unusable never falls back to the public number (overstating seats is the unsafe direction)', () => {
  it.each([['"15"', '15'], ['0', 0], ['15.5', 15.5], ['-3', -3]])('internal %s with tour 18 -> unset + note', (_label, value) => {
    expect(effectiveCapacity({ internalCapacity: value, tourMaxGroupSize: 18 })).toEqual({
      capacity: null,
      note: '内部座位格式不对，请到团目录核对',
    })
  })
  it('missing or null internal still falls back to the tour number', () => {
    expect(effectiveCapacity({ internalCapacity: undefined, tourMaxGroupSize: 18 })).toEqual({ capacity: 18, note: null })
    expect(effectiveCapacity({ internalCapacity: null, tourMaxGroupSize: 18 })).toEqual({ capacity: 18, note: null })
  })
  it('readInternalCapacity: absent key is undefined, other keys never leak', () => {
    expect(readInternalCapacity({ airline: 'CA' })).toBeUndefined()
  })
})
