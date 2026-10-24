/**
 * IMPACT Measure — maps to magic-engine-platform app/impact measure.
 *
 * Travel "deposit already received" seat count. Off unless the goal's own
 * config names this interpreter. Headcount is computeProgress: cancelled
 * bookings and closed departures stay out of the row totals, and a missing
 * headcount stays unknown. This file does not read the database, does not
 * decide the deposit date window, and does not treat a paid balance as a
 * second deal. Callers pass only rows they have already marked deposit-paid.
 */

import { computeProgress } from '@/lib/crm/sales-progress/calc'
import type { ProgressResult, SalesBooking, SalesUnit } from '@/lib/crm/sales-progress/types'

export const TRAVEL_DEPOSITED_SEATS_ID = 'travel.deposited_seats'
export const DEPOSITED_SEAT_SCOPE_KEY = 'deposited_seat_scope'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export interface DepartureRef {
  departOn: string
  /** null = any tour on that date */
  tourId: string | null
}

/** One order. `depositPaid` is true only for a deposit marked paid. Balance never sets it. */
export interface DepositMarkedBooking {
  booking: SalesBooking
  depositPaid: boolean
}

export interface DepositedSeatFacts {
  units: readonly SalesUnit[]
  bookings: readonly DepositMarkedBooking[]
}

export interface DepartureSeatTotal {
  departOn: string
  tourId: string
  seats: number
  deals: number
}

export type DepositedSeatCount =
  | { ok: true; seats: number; deals: number; byDeparture: DepartureSeatTotal[] }
  | { ok: false; unknown: true; reason: string }

type ScopeRead =
  | { ok: true; departures: DepartureRef[] }
  | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isIsoDay(value: string): boolean {
  if (!DAY.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Departure list for a goal that already opted in. Absence or a bad list is unknown, not "count every date". */
export function readDepartureScope(supporting: unknown): ScopeRead {
  if (!Array.isArray(supporting)) {
    return { ok: false, reason: '这条目标开了已收定金座位，但出发日不是列表，不出数' }
  }
  const found = supporting.filter((item) => isRecord(item) && item.key === DEPOSITED_SEAT_SCOPE_KEY)
  if (found.length === 0) {
    return { ok: false, reason: '这条目标开了已收定金座位，但没有写出发日，不出数' }
  }
  if (found.length > 1) return { ok: false, reason: '出发日写了不止一份，已收定金座位不出数' }
  return parseDepartures(found[0])
}

function parseDepartures(raw: unknown): ScopeRead {
  if (!isRecord(raw) || !Array.isArray(raw.departures) || raw.departures.length === 0) {
    return { ok: false, reason: '出发日是空的，已收定金座位不出数' }
  }
  const departures: DepartureRef[] = []
  const seen = new Set<string>()
  for (const item of raw.departures) {
    const parsed = parseOne(item)
    if (!parsed) return { ok: false, reason: '出发日有读不懂的日期，已收定金座位不出数' }
    const key = `${parsed.departOn}\t${parsed.tourId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    departures.push(parsed)
  }
  return departures.length === 0
    ? { ok: false, reason: '出发日是空的，已收定金座位不出数' }
    : { ok: true, departures }
}

function parseOne(item: unknown): DepartureRef | null {
  if (!isRecord(item) || typeof item.depart_on !== 'string' || !isIsoDay(item.depart_on)) return null
  if (item.tour_id === undefined) return { departOn: item.depart_on, tourId: null }
  if (typeof item.tour_id !== 'string' || item.tour_id.trim() === '') return null
  return { departOn: item.depart_on, tourId: item.tour_id }
}

function matches(departOn: string | null, tourId: string, departures: readonly DepartureRef[]): boolean {
  if (departOn === null || !isIsoDay(departOn)) return false
  return departures.some((item) => item.departOn === departOn && (item.tourId === null || item.tourId === tourId))
}

function fail(reason: string): DepositedSeatCount {
  return { ok: false, unknown: true, reason }
}

function asHeadcount(booking: SalesBooking): SalesBooking {
  const size = booking.partySize
  if (size === null) return booking
  if (typeof size === 'number' && Number.isInteger(size) && size > 0) return booking
  return { ...booking, partySize: null }
}

/** One row per order. Unpaid and duplicate ids drop out. Balance must be unpaid here. */
function paidOnce(marked: readonly DepositMarkedBooking[]): SalesBooking[] {
  const seen = new Set<string>()
  const bookings: SalesBooking[] = []
  for (const row of marked) {
    if (!row.depositPaid || seen.has(row.booking.id)) continue
    seen.add(row.booking.id)
    bookings.push(asHeadcount(row.booking))
  }
  return bookings
}

function hasListedUnit(units: readonly SalesUnit[], departureId: string | null): boolean {
  return departureId !== null && units.some((unit) => unit.unitId === departureId)
}

/**
 * Tours in this count. A date-only goal names no tour id, so a snapshot-dated
 * order is the only proof its tour belongs here. That tour must be checked
 * before prepareUnits builds the snapshot row, or an undated order on it
 * disappears and a partial total is published as complete.
 */
function scopedTourIds(
  bookings: readonly SalesBooking[],
  units: readonly SalesUnit[],
  departures: readonly DepartureRef[],
): Set<string> {
  const ids = new Set<string>()
  for (const item of departures) {
    if (item.tourId) ids.add(item.tourId)
  }
  for (const unit of units) {
    if (matches(unit.date, unit.groupId, departures)) ids.add(unit.groupId)
  }
  for (const booking of bookings) {
    if (booking.status !== 'active' || hasListedUnit(units, booking.departureId)) continue
    if (matches(booking.departureDepartOn, booking.tourId, departures)) ids.add(booking.tourId)
  }
  return ids
}

function unknownTourDates(
  bookings: readonly SalesBooking[],
  units: readonly SalesUnit[],
  departures: readonly DepartureRef[],
): number {
  const tours = scopedTourIds(bookings, units, departures)
  let count = 0
  for (const booking of bookings) {
    if (booking.status !== 'active') continue
    const unit = units.find((item) => item.unitId === booking.departureId)
    if (unit && unit.date !== null && isIsoDay(unit.date)) continue
    if (booking.departureDepartOn !== null && isIsoDay(booking.departureDepartOn)) continue
    if (tours.has(booking.tourId)) count += 1
  }
  return count
}

function snapshotUnit(unitId: string, tourId: string, departOn: string): SalesUnit {
  return {
    unitId,
    groupId: tourId,
    label: departOn,
    date: departOn,
    capacity: null,
    capacityNote: null,
    unitStatus: 'open',
  }
}

/**
 * Bookings whose bought departure is not in the unit list still need a unit,
 * so computeProgress can count the snapshot date. The bought date wins:
 * asking about A and paying for B stays on B.
 */
function prepareUnits(
  units: readonly SalesUnit[],
  bookings: readonly SalesBooking[],
  departures: readonly DepartureRef[],
): { units: SalesUnit[]; bookings: SalesBooking[] } {
  const nextUnits = [...units]
  const nextBookings: SalesBooking[] = []
  const added = new Set<string>()
  for (const booking of bookings) {
    const known = booking.departureId !== null && units.some((unit) => unit.unitId === booking.departureId)
    const date = booking.departureDepartOn
    if (known || date === null || !matches(date, booking.tourId, departures)) {
      nextBookings.push(booking)
      continue
    }
    const unitId = `interpreter-snapshot:${booking.tourId}:${date}`
    if (!added.has(unitId) && !units.some((unit) => unit.unitId === unitId)) {
      added.add(unitId)
      nextUnits.push(snapshotUnit(unitId, booking.tourId, date))
    }
    nextBookings.push({ ...booking, departureId: unitId })
  }
  return { units: nextUnits, bookings: nextBookings }
}

function emptyReason(progress: ProgressResult, departures: readonly DepartureRef[]): DepositedSeatCount {
  const closed = progress.onClosedUnits.some(
    (item) => item.orders > 0 && matches(item.unit.date, item.unit.groupId, departures),
  )
  if (closed) return fail('已收定金的订单都挂在已关闭或已取消的出发日上，这次不给数字')
  return fail('这几个出发日上还没有可计的已收定金座位，不给数字')
}

function summarise(progress: ProgressResult, departures: readonly DepartureRef[]): DepositedSeatCount {
  const rows = progress.rows.filter((row) => matches(row.unit.date, row.unit.groupId, departures))
  const unfilled = rows.reduce((sum, row) => sum + row.unfilledOrders, 0)
  if (unfilled > 0) return fail(`人数未知 ${unfilled} 笔，已收定金座位不出数`)
  const byDeparture: DepartureSeatTotal[] = []
  let seats = 0
  let deals = 0
  for (const row of rows) {
    if (row.total === 0 || row.unit.date === null) continue
    seats += row.total
    deals += row.bookings.length
    byDeparture.push({
      departOn: row.unit.date,
      tourId: row.unit.groupId,
      seats: row.total,
      deals: row.bookings.length,
    })
  }
  if (seats === 0) return emptyReason(progress, departures)
  return { ok: true, seats, deals, byDeparture }
}

export function countTravelDepositedSeats(
  facts: DepositedSeatFacts,
  departures: readonly DepartureRef[],
): DepositedSeatCount {
  const paid = paidOnce(facts.bookings)
  const missingDate = unknownTourDates(paid, facts.units, departures)
  if (missingDate > 0) return fail(`出发日未知 ${missingDate} 笔，已收定金座位不出数`)
  const prepared = prepareUnits(facts.units, paid, departures)
  return summarise(computeProgress(prepared.units, prepared.bookings), departures)
}
