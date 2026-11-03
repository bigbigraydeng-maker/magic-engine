/**
 * Shared types for the read-only "sales progress" calculation.
 * Describes the minimal shape of orders (SalesBooking) and the
 * seat-limited units (SalesUnit) they belong to, plus the computed
 * per-unit and overall progress results. Pure data only, no IO.
 */

export type OriginKind = 'company_confirmed' | 'customer_stated' | 'staff_entered'
export type BookingStatus = 'active' | 'cancelled'

/** One order, only the columns this page needs. */
export interface SalesBooking {
  id: string
  tourId: string
  departureId: string | null
  /** snapshot of the departure date copied when the order was created */
  departureDepartOn: string | null
  bookedOn: string
  partySize: number | null
  /** null = old / hand-entered order with no origin recorded */
  originKind: OriginKind | null
  /** invoice number, null when not recorded */
  evidenceRef: string | null
  status: BookingStatus
}

/** A "sales unit" = one thing that has a seat limit and orders (for the travel adapter: one departure). */
export interface SalesUnit {
  unitId: string
  /** the group the unit belongs to (for the travel adapter: the tour id) */
  groupId: string
  label: string
  /** ISO date (YYYY-MM-DD) or null */
  date: string | null
  capacity: number | null
  capacityNote: string | null
  /** raw status text from the source, e.g. open / limited / sold_out / closed / cancelled */
  unitStatus: string
}

export interface UnitProgress {
  unit: SalesUnit
  companyConfirmed: number
  customerStated: number
  unverified: number
  /** companyConfirmed + customerStated + unverified */
  total: number
  /** active orders with partySize null (not counted in the people numbers) */
  unfilledOrders: number
  /** capacity - total; may be negative; null when capacity is null */
  remaining: number | null
  /** capacity - companyConfirmed; may be negative; null when capacity is null */
  remainingCompanyOnly: number | null
  /** how many people above capacity (0 when not over, or capacity null) */
  overBy: number
  /** people on orders of the same group that belong to NO listed unit (see computeProgress) */
  unattributedPeople: number
  bookings: SalesBooking[]
}

export interface ClosedUnitOrders {
  unit: SalesUnit
  orders: number
  people: number
}

export interface ProgressResult {
  rows: UnitProgress[]
  /** active orders on units whose status is cancelled or closed */
  onClosedUnits: ClosedUnitOrders[]
  /** active orders whose departure is missing (departureId null, or id not found among ALL units) */
  unattributedOrders: number
  unattributedPeople: number
  /** active orders in total, for the page footer */
  activeOrders: number
}
