/**
 * Seats from deposit-confirmed bookings, for a goal that lists its departures.
 *
 * Reuses computeProgress for headcount (cancelled bookings and closed
 * departures stay out of the row totals). Payment status is supplied by the
 * caller: this file does not read the database and does not treat a paid
 * balance as a second deal.
 *
 * The cutoff is the later of the goal period start and the goal's created
 * day in New Zealand. Only deposits marked paid on or after that day, and
 * on or before period end, count. Deposits already recorded before the
 * cutoff stay out, so they are not new progress.
 *
 * Missing headcount, an unconfirmed departure on a scoped tour, or a paid
 * deposit with no date blocks a numeric total. A missing ad source is
 * reported beside the number and does not change it. Nothing here rewrites
 * the source, and notes are not read.
 */

import { computeProgress } from './calc'
import type { SalesBooking, SalesUnit } from './types'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const NZ = 'Pacific/Auckland'

export const DEPOSITED_SEAT_SOURCE = 'auto.crm_deposited_seats'

export interface SeatDeparture {
  departOn: string
  /** null = any tour on that date */
  tourId: string | null
}

export interface DepositMark {
  state: 'unpaid' | 'paid'
  /** ISO day when state is paid; null means the date was not stored */
  paidOn: string | null
}

export interface BookingPayment {
  deposit: DepositMark
  balancePaid: boolean
}

export interface MilestoneFact {
  bookingId: string
  kind: string
  state: string
  paidOn: string | null
}

export interface DepositSeatBooking {
  booking: SalesBooking
  deposit: DepositMark
  /** Recorded so a paid balance is visible. It never adds a deal. */
  balancePaid: boolean
  /** Original ad source. null = unknown. Never inferred. */
  adSource: string | null
}

export interface DepartureSeats {
  departOn: string
  tourId: string
  deals: number
  seats: number
}

export interface SourceEcho {
  bookingId: string
  adSource: string | null
}

export interface DepositedSeatCount {
  /** null when headcount, tour date, or deposit date is missing on a scoped row */
  seats: number | null
  deals: number | null
  byDeparture: DepartureSeats[]
  unknownHeadcount: number
  unknownTourDate: number
  unknownDepositDate: number
  unknownSource: number
  /** deposits on a scoped departure whose unit is closed or cancelled */
  excludedClosed: number
  sources: SourceEcho[]
}

export type SeatFetchResult =
  | { ok: true; value: number; source: string; snapshot_date: string; label: string }
  | { ok: false; reason: string; unknown: true; noData?: true }

export function isIsoDay(value: string): boolean {
  return DAY.test(value)
}

/** Later of period start and the goal's New Zealand created day. */
export function depositCutoff(periodStart: string, createdAt: string | null | undefined): string {
  const createdDay = createdDayOf(createdAt)
  if (createdDay !== null && createdDay > periodStart) return createdDay
  return periodStart
}

function createdDayOf(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null
  if (createdAt.length === 10 && isIsoDay(createdAt)) return createdAt
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function paymentsByBooking(facts: readonly MilestoneFact[]): Map<string, BookingPayment> {
  const map = new Map<string, BookingPayment>()
  for (const fact of facts) {
    const current = map.get(fact.bookingId) ?? freshPayment()
    if (fact.kind === 'balance' && fact.state === 'paid') current.balancePaid = true
    if (fact.kind === 'deposit' && fact.state === 'paid') {
      current.deposit = { state: 'paid', paidOn: fact.paidOn }
    }
    map.set(fact.bookingId, current)
  }
  return map
}

function freshPayment(): BookingPayment {
  return { deposit: { state: 'unpaid', paidOn: null }, balancePaid: false }
}

export function attachPayments(
  bookings: readonly SalesBooking[],
  payments: ReadonlyMap<string, BookingPayment>,
  adSourceOf: (bookingId: string) => string | null = () => null,
): DepositSeatBooking[] {
  return bookings.map((booking) => {
    const payment = payments.get(booking.id)
    return {
      booking,
      deposit: payment?.deposit ?? { state: 'unpaid', paidOn: null },
      balancePaid: payment?.balancePaid ?? false,
      adSource: adSourceOf(booking.id),
    }
  })
}

/**
 * New deposited seats are published only when baseline is 0.
 * The verdict formula subtracts baseline again; a non-zero baseline would
 * remove the same already-booked seats twice.
 */
export function incrementalSeatBaseline(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (value === undefined || value === null) {
    return { ok: false, reason: '没有读到目标起点，座位进度不出数' }
  }
  const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric)) {
    return { ok: false, reason: '目标起点读不懂，座位进度不出数' }
  }
  if (numeric !== 0) {
    return {
      ok: false,
      reason: `目标起点是 ${numeric}。这次计的是起点日之后的新座位，进度还会用起点再减一次，起点不是 0 时不出数`,
    }
  }
  return { ok: true }
}

type Bucket = DepartureSeats

interface Tally {
  buckets: Map<string, Bucket>
  seen: Set<string>
  unknownHeadcount: number
  unknownTourDate: number
  unknownSource: number
  excludedClosed: number
  sources: SourceEcho[]
}

interface Gate {
  qualifying: DepositSeatBooking[]
  unknownDepositDate: number
  unknownSource: number
  sources: SourceEcho[]
}

export function countDepositedSeats(input: {
  units: readonly SalesUnit[]
  rows: readonly DepositSeatBooking[]
  scope: readonly SeatDeparture[]
  cutoff: string
  periodEnd: string
}): DepositedSeatCount {
  const unitById = indexUnits(input.units)
  const tours = scopedTourIds(input.units, input.scope)
  const gate = gateRows(input.rows, input.cutoff, input.periodEnd, input.scope, tours, unitById)
  const bookings = gate.qualifying.map((row) => row.booking)
  const progress = computeProgress(input.units, bookings)
  const byId = new Map(gate.qualifying.map((row) => [row.booking.id, row]))
  const tally = emptyTally()
  absorbRows(tally, progress.rows, byId, input.scope)
  absorbLeftovers(tally, gate.qualifying, unitById, tours, input.scope)
  tally.unknownSource += gate.unknownSource
  for (const source of gate.sources) tally.sources.push(source)
  return finish(tally, gate.unknownDepositDate)
}

export function depositedSeatsToFetchResult(count: DepositedSeatCount, periodEnd: string): SeatFetchResult {
  const parts = unknownParts(count)
  const blocking = count.unknownHeadcount > 0 || count.unknownTourDate > 0 || count.unknownDepositDate > 0
  if (blocking) {
    return { ok: false, unknown: true, reason: `已收定金的座位还不能出数：${parts.join('；')}` }
  }
  if (count.seats === null || count.seats === 0) return emptySeatResult(count)
  const sourceNote = count.unknownSource > 0 ? `；来源未知 ${count.unknownSource} 笔` : ''
  return {
    ok: true,
    value: count.seats,
    source: DEPOSITED_SEAT_SOURCE,
    snapshot_date: periodEnd,
    label: `${count.deals ?? 0} 笔定金，${count.seats} 个座位${sourceNote}`,
  }
}

function emptySeatResult(count: DepositedSeatCount): SeatFetchResult {
  if (count.excludedClosed > 0) {
    return {
      ok: false,
      unknown: true,
      reason: '已收定金的订单都挂在已关闭或已取消的出发日上，这次不给数字',
    }
  }
  return {
    ok: false,
    unknown: true,
    noData: true,
    reason: '这几个出发日上，还没有一笔在统计起点之后标过已收定金的订单。可能是还没有，也可能是定金没人点；这两种看不出区别，所以不给数字',
  }
}

function unknownParts(count: DepositedSeatCount): string[] {
  const parts: string[] = []
  if (count.unknownHeadcount > 0) parts.push(`人数未知 ${count.unknownHeadcount} 笔`)
  if (count.unknownTourDate > 0) parts.push(`出发日未知 ${count.unknownTourDate} 笔`)
  if (count.unknownDepositDate > 0) parts.push(`定金日期未知 ${count.unknownDepositDate} 笔`)
  if (count.unknownSource > 0) parts.push(`来源未知 ${count.unknownSource} 笔`)
  return parts
}

function emptyTally(): Tally {
  return {
    buckets: new Map(),
    seen: new Set(),
    unknownHeadcount: 0,
    unknownTourDate: 0,
    unknownSource: 0,
    excludedClosed: 0,
    sources: [],
  }
}

function finish(tally: Tally, unknownDepositDate: number): DepositedSeatCount {
  const byDeparture = [...tally.buckets.values()].sort(byDepartThenTour)
  let seats = 0
  let deals = 0
  for (const bucket of byDeparture) {
    seats += bucket.seats
    deals += bucket.deals
  }
  const blocking = tally.unknownHeadcount > 0 || tally.unknownTourDate > 0 || unknownDepositDate > 0
  return {
    seats: blocking ? null : seats,
    deals: blocking ? null : deals,
    byDeparture,
    unknownHeadcount: tally.unknownHeadcount,
    unknownTourDate: tally.unknownTourDate,
    unknownDepositDate,
    unknownSource: tally.unknownSource,
    excludedClosed: tally.excludedClosed,
    sources: tally.sources,
  }
}

function byDepartThenTour(a: Bucket, b: Bucket): number {
  return a.departOn.localeCompare(b.departOn) || a.tourId.localeCompare(b.tourId)
}

function indexUnits(units: readonly SalesUnit[]): Map<string, SalesUnit> {
  const map = new Map<string, SalesUnit>()
  for (const unit of units) map.set(unit.unitId, unit)
  return map
}

function scopedTourIds(units: readonly SalesUnit[], scope: readonly SeatDeparture[]): Set<string> {
  const ids = new Set<string>()
  for (const item of scope) {
    if (item.tourId) ids.add(item.tourId)
  }
  for (const unit of units) {
    if (inScope(unit.date, unit.groupId, scope)) ids.add(unit.groupId)
  }
  return ids
}

function inScope(departOn: string | null, tourId: string, scope: readonly SeatDeparture[]): boolean {
  if (departOn === null || !isIsoDay(departOn)) return false
  return scope.some((item) => item.departOn === departOn && (item.tourId === null || item.tourId === tourId))
}

function isClosed(unit: SalesUnit): boolean {
  return unit.unitStatus === 'cancelled' || unit.unitStatus === 'closed'
}

function asDay(value: string | null): string | null {
  if (value === null) return null
  const day = value.slice(0, 10)
  return isIsoDay(day) ? day : null
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === ''
}

function couldBelong(
  booking: SalesBooking,
  scope: readonly SeatDeparture[],
  tours: ReadonlySet<string>,
  unitById: ReadonlyMap<string, SalesUnit>,
): boolean {
  const unit = booking.departureId === null ? undefined : unitById.get(booking.departureId)
  if (unit && inScope(unit.date, unit.groupId, scope)) return true
  if (inScope(booking.departureDepartOn, booking.tourId, scope)) return true
  return booking.departureDepartOn === null && tours.has(booking.tourId)
}

function gateRows(
  rows: readonly DepositSeatBooking[],
  cutoff: string,
  periodEnd: string,
  scope: readonly SeatDeparture[],
  tours: ReadonlySet<string>,
  unitById: ReadonlyMap<string, SalesUnit>,
): Gate {
  const qualifying: DepositSeatBooking[] = []
  const sources: SourceEcho[] = []
  let unknownDepositDate = 0
  let unknownSource = 0
  for (const row of rows) {
    const gated = gateOne(row, cutoff, periodEnd, scope, tours, unitById)
    if (gated === 'qualifying') qualifying.push(row)
    if (gated === 'undated') {
      unknownDepositDate += 1
      if (isBlank(row.adSource)) unknownSource += 1
      sources.push({ bookingId: row.booking.id, adSource: row.adSource })
    }
  }
  return { qualifying, unknownDepositDate, unknownSource, sources }
}

function gateOne(
  row: DepositSeatBooking,
  cutoff: string,
  periodEnd: string,
  scope: readonly SeatDeparture[],
  tours: ReadonlySet<string>,
  unitById: ReadonlyMap<string, SalesUnit>,
): 'skip' | 'undated' | 'qualifying' {
  if (row.booking.status !== 'active' || row.deposit.state !== 'paid') return 'skip'
  const paidOn = asDay(row.deposit.paidOn)
  if (paidOn === null) {
    return couldBelong(row.booking, scope, tours, unitById) ? 'undated' : 'skip'
  }
  if (paidOn < cutoff || paidOn > periodEnd) return 'skip'
  return 'qualifying'
}

function addBucket(buckets: Map<string, Bucket>, departOn: string, tourId: string, partySize: number): void {
  const key = `${departOn}\t${tourId}`
  const current = buckets.get(key) ?? { departOn, tourId, deals: 0, seats: 0 }
  current.deals += 1
  current.seats += partySize
  buckets.set(key, current)
}

function remember(tally: Tally, row: DepositSeatBooking, departOn: string, tourId: string): void {
  tally.seen.add(row.booking.id)
  if (row.booking.partySize === null) tally.unknownHeadcount += 1
  else addBucket(tally.buckets, departOn, tourId, row.booking.partySize)
  if (isBlank(row.adSource)) tally.unknownSource += 1
  tally.sources.push({ bookingId: row.booking.id, adSource: row.adSource })
}

function absorbRows(
  tally: Tally,
  rows: { unit: SalesUnit; bookings: SalesBooking[] }[],
  byId: ReadonlyMap<string, DepositSeatBooking>,
  scope: readonly SeatDeparture[],
): void {
  for (const progressRow of rows) {
    const departOn = progressRow.unit.date
    if (!inScope(departOn, progressRow.unit.groupId, scope) || departOn === null) continue
    for (const booking of progressRow.bookings) {
      const row = byId.get(booking.id)
      if (row) remember(tally, row, departOn, progressRow.unit.groupId)
    }
  }
}

function absorbLeftovers(
  tally: Tally,
  rows: readonly DepositSeatBooking[],
  unitById: ReadonlyMap<string, SalesUnit>,
  tours: ReadonlySet<string>,
  scope: readonly SeatDeparture[],
): void {
  for (const row of rows) {
    if (tally.seen.has(row.booking.id)) continue
    const unit = row.booking.departureId === null ? undefined : unitById.get(row.booking.departureId)
    if (unit !== undefined) {
      if (isClosed(unit) && inScope(unit.date, unit.groupId, scope)) tally.excludedClosed += 1
      continue
    }
    const date = row.booking.departureDepartOn
    if (date !== null && inScope(date, row.booking.tourId, scope)) {
      remember(tally, row, date, row.booking.tourId)
      continue
    }
    if (date === null && tours.has(row.booking.tourId)) {
      tally.unknownTourDate += 1
      if (isBlank(row.adSource)) tally.unknownSource += 1
      tally.sources.push({ bookingId: row.booking.id, adSource: row.adSource })
    }
  }
}
