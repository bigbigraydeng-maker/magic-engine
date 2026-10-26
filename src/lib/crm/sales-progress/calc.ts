/**
 * Read-only "sales progress" calculation.
 * Turns a list of seat-limited units and their orders into per-unit
 * progress rows (people by origin, remaining seats, over-capacity) plus
 * totals for orders on closed units and unattributed orders.
 * Pure functions only: no IO, no mutation of the inputs.
 */

import type {
  BookingStatus,
  ClosedUnitOrders,
  ProgressResult,
  SalesBooking,
  SalesUnit,
  UnitProgress,
} from './types'

function isClosed(unit: SalesUnit): boolean {
  return unit.unitStatus === 'cancelled' || unit.unitStatus === 'closed'
}

function isActive(booking: SalesBooking): boolean {
  const status: BookingStatus = booking.status
  return status === 'active'
}

interface Buckets {
  companyConfirmed: number
  customerStated: number
  unverified: number
  unfilledOrders: number
}

function addToBuckets(buckets: Buckets, booking: SalesBooking): void {
  if (booking.partySize === null) {
    buckets.unfilledOrders += 1
    return
  }
  if (booking.originKind === 'company_confirmed') {
    buckets.companyConfirmed += booking.partySize
  } else if (booking.originKind === 'customer_stated') {
    buckets.customerStated += booking.partySize
  } else {
    buckets.unverified += booking.partySize
  }
}

function buildRow(
  unit: SalesUnit,
  bookings: SalesBooking[],
  unattributedPeople: number,
): UnitProgress {
  const buckets: Buckets = {
    companyConfirmed: 0,
    customerStated: 0,
    unverified: 0,
    unfilledOrders: 0,
  }
  for (const booking of bookings) {
    addToBuckets(buckets, booking)
  }
  const total = buckets.companyConfirmed + buckets.customerStated + buckets.unverified
  const capacity = unit.capacity
  const remaining = capacity === null ? null : capacity - total
  const remainingCompanyOnly = capacity === null ? null : capacity - buckets.companyConfirmed
  const overBy = capacity !== null && total > capacity ? total - capacity : 0
  return {
    unit,
    companyConfirmed: buckets.companyConfirmed,
    customerStated: buckets.customerStated,
    unverified: buckets.unverified,
    total,
    unfilledOrders: buckets.unfilledOrders,
    remaining,
    remainingCompanyOnly,
    overBy,
    unattributedPeople,
    bookings,
  }
}

export function computeProgress(
  units: readonly SalesUnit[],
  bookings: readonly SalesBooking[],
): ProgressResult {
  const unitById = new Map<string, SalesUnit>()
  for (const unit of units) {
    unitById.set(unit.unitId, unit)
  }

  const activeBookings = bookings.filter(isActive)
  const activeOrders = activeBookings.length

  const rowBookings = new Map<string, SalesBooking[]>()
  const closedOrders = new Map<string, number>()
  const closedPeople = new Map<string, number>()
  const unattributedByTour = new Map<string, number>()
  let unattributedOrders = 0
  let unattributedPeople = 0

  for (const booking of activeBookings) {
    const unit = booking.departureId === null ? undefined : unitById.get(booking.departureId)
    if (unit === undefined) {
      unattributedOrders += 1
      const people = booking.partySize ?? 0
      unattributedPeople += people
      unattributedByTour.set(booking.tourId, (unattributedByTour.get(booking.tourId) ?? 0) + people)
      continue
    }
    if (isClosed(unit)) {
      closedOrders.set(unit.unitId, (closedOrders.get(unit.unitId) ?? 0) + 1)
      closedPeople.set(unit.unitId, (closedPeople.get(unit.unitId) ?? 0) + (booking.partySize ?? 0))
      continue
    }
    const list = rowBookings.get(unit.unitId)
    if (list === undefined) {
      rowBookings.set(unit.unitId, [booking])
    } else {
      list.push(booking)
    }
  }

  const rows: UnitProgress[] = []
  for (const unit of units) {
    if (isClosed(unit)) {
      continue
    }
    const unitBookings = rowBookings.get(unit.unitId) ?? []
    const unattributed = unattributedByTour.get(unit.groupId) ?? 0
    rows.push(buildRow(unit, unitBookings, unattributed))
  }

  const onClosedUnits: ClosedUnitOrders[] = []
  for (const unit of units) {
    const orders = closedOrders.get(unit.unitId)
    if (orders !== undefined && orders > 0) {
      onClosedUnits.push({
        unit,
        orders,
        people: closedPeople.get(unit.unitId) ?? 0,
      })
    }
  }

  return {
    rows,
    onClosedUnits,
    unattributedOrders,
    unattributedPeople,
    activeOrders,
  }
}
