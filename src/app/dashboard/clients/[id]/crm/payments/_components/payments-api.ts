/**
 * Browser-side fetch for the 付款总览 page.
 *
 * Imported by client components, so it must NOT import any server module: only
 * type-only imports from the shared CRM modules. A response that is not well formed
 * is treated as an error, never as zeros.
 *
 * `parseOverviewPayload` validates every nested field the page reads and returns a
 * fresh, normalised object (missing OPTIONAL newer fields get their defaults). Any
 * malformed value makes the whole payload null, so the page refuses to render numbers.
 */

import type { OverviewPayload } from '@/lib/crm/booking-overview-load'
import type {
  OverviewGroup,
  OverviewListRow,
  OverviewMilestoneCell,
  OverviewSummary,
} from '@/lib/crm/booking-overview-types'
import type { BookingWarningCode } from '@/lib/crm/booking-types'
import { toSearchString, type PaymentsQuery } from './payments-query'

export type OverviewFetchResult =
  | { kind: 'ok'; data: OverviewPayload }
  | { kind: 'hidden' }
  | { kind: 'error' }

export function overviewUrl(clientId: string, query: PaymentsQuery): string {
  return `/api/clients/${clientId}/crm/bookings/overview${toSearchString(query)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A finite number, or null when the value is anything else. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** A string, or null when the value is anything else. */
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** A string or an explicit null; undefined and other types are malformed. */
function strOrNull(v: unknown): string | null | undefined {
  if (v === null) return null
  return typeof v === 'string' ? v : undefined
}

/** A finite number or an explicit null; undefined and other types are malformed (undefined). */
function numOrNull(v: unknown): number | null | undefined {
  if (v === null) return null
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** A boolean, or null when the value is anything else. */
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

const WARNING_CODES: readonly BookingWarningCode[] = [
  'departure_changed',
  'departure_missing',
  'departure_cancelled',
  'departure_not_set',
  'holiday_table_missing',
  'tour_length_mismatch',
  'cruise_not_ticked',
  'override_stale',
  'lead_cruise_note',
  'tour_missing',
  'due_unavailable',
  'pay_in_full',
]

function isWarningCode(v: unknown): v is BookingWarningCode {
  return typeof v === 'string' && (WARNING_CODES as readonly string[]).includes(v)
}

/** An optional number: absent -> default, present-but-wrong-type -> null. */
function optionalNum(v: unknown, fallback: number): number | null {
  if (v === undefined) return fallback
  return num(v)
}

/** An optional boolean: absent -> default, present-but-wrong-type -> null. */
function optionalBool(v: unknown, fallback: boolean): boolean | null {
  if (v === undefined) return fallback
  return bool(v)
}

function parseGroup(value: unknown): OverviewGroup | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (kind !== 'departure' && kind !== 'unknown_date' && kind !== 'undecided') return null
  const key = str(value.key)
  const tourId = strOrNull(value.tourId)
  const tourName = strOrNull(value.tourName)
  const departureId = strOrNull(value.departureId)
  const departOn = strOrNull(value.departOn)
  const departed = bool(value.departed)
  const orders = num(value.orders)
  const partySize = num(value.partySize)
  const partySizeMissing = num(value.partySizeMissing)
  const depositPaid = num(value.depositPaid)
  const balancePaid = num(value.balancePaid)
  const fullyPaid = num(value.fullyPaid)
  const unsettled = num(value.unsettled)
  const unsettledOverdue = num(value.unsettledOverdue)
  const offlineHandled = num(value.offlineHandled)
  const unpaidItems = num(value.unpaidItems)
  const nearestDueOn = strOrNull(value.nearestDueOn)
  const openItems = optionalNum(value.openItems, 0)
  const dateAmbiguous = optionalBool(value.dateAmbiguous, false)
  if (
    key === null ||
    tourId === undefined ||
    tourName === undefined ||
    departureId === undefined ||
    departOn === undefined ||
    departed === null ||
    orders === null ||
    partySize === null ||
    partySizeMissing === null ||
    depositPaid === null ||
    balancePaid === null ||
    fullyPaid === null ||
    unsettled === null ||
    unsettledOverdue === null ||
    offlineHandled === null ||
    unpaidItems === null ||
    nearestDueOn === undefined ||
    openItems === null ||
    dateAmbiguous === null
  ) {
    return null
  }
  if (!Array.isArray(value.warningCodes)) return null
  const warningCodes: BookingWarningCode[] = []
  for (const code of value.warningCodes) {
    if (!isWarningCode(code)) return null
    warningCodes.push(code)
  }
  return {
    key,
    kind,
    tourId,
    tourName,
    departureId,
    departOn,
    departed,
    orders,
    partySize,
    partySizeMissing,
    depositPaid,
    balancePaid,
    fullyPaid,
    unsettled,
    unsettledOverdue,
    offlineHandled,
    nearestDueOn,
    unpaidItems,
    openItems,
    dateAmbiguous,
    warningCodes,
  }
}

function parseTotals(value: unknown): OverviewSummary['totals'] | null {
  if (!isRecord(value)) return null
  const orders = num(value.orders)
  const partySize = num(value.partySize)
  const partySizeMissing = num(value.partySizeMissing)
  const depositPaid = num(value.depositPaid)
  const balancePaid = num(value.balancePaid)
  const unsettled = num(value.unsettled)
  const unsettledOverdue = num(value.unsettledOverdue)
  const offlineHandled = num(value.offlineHandled)
  if (
    orders === null ||
    partySize === null ||
    partySizeMissing === null ||
    depositPaid === null ||
    balancePaid === null ||
    unsettled === null ||
    unsettledOverdue === null ||
    offlineHandled === null
  ) {
    return null
  }
  return { orders, partySize, partySizeMissing, depositPaid, balancePaid, unsettled, unsettledOverdue, offlineHandled }
}

function parseNotes(value: unknown): OverviewSummary['notes'] | null {
  if (!isRecord(value)) return null
  const offlineHandledOrders = num(value.offlineHandledOrders)
  const snoozedOrders = num(value.snoozedOrders)
  const cancelledOrders = num(value.cancelledOrders)
  if (offlineHandledOrders === null || snoozedOrders === null || cancelledOrders === null) {
    return null
  }
  return { offlineHandledOrders, snoozedOrders, cancelledOrders }
}

function parseCell(value: unknown): OverviewMilestoneCell | null {
  if (value === null) return null
  if (!isRecord(value)) return null
  const kind = value.kind
  if (kind !== 'deposit' && kind !== 'balance') return null
  const label = str(value.label)
  const state = value.state
  if (state !== 'unpaid' && state !== 'paid') return null
  const paidOn = strOrNull(value.paidOn)
  const dueOn = strOrNull(value.dueOn)
  const dueNote = strOrNull(value.dueNote)
  const overdue = bool(value.overdue)
  const quiet = bool(value.quiet)
  if (
    label === null ||
    paidOn === undefined ||
    dueOn === undefined ||
    dueNote === undefined ||
    overdue === null ||
    quiet === null
  ) {
    return null
  }
  return { kind, label, state, paidOn, dueOn, dueNote, overdue, quiet }
}

function parseRow(value: unknown): OverviewListRow | null {
  if (!isRecord(value)) return null
  const bookingId = str(value.bookingId)
  const contactId = str(value.contactId)
  const contactName = strOrNull(value.contactName)
  const tourId = str(value.tourId)
  const tourName = strOrNull(value.tourName)
  const departureId = strOrNull(value.departureId)
  const departOn = strOrNull(value.departOn)
  const status = value.status
  if (status !== 'active' && status !== 'cancelled') return null
  const partySize = numOrNull(value.partySize)
  const deposit = parseCell(value.deposit)
  const balance = parseCell(value.balance)
  // parseCell answers null for both "no cell" and "malformed cell": only a real null may stay null.
  if ((value.deposit !== null && deposit === null) || (value.balance !== null && balance === null)) return null
  const lastNudgedOn = strOrNull(value.lastNudgedOn)
  const note = strOrNull(value.note)
  if (
    bookingId === null ||
    contactId === null ||
    contactName === undefined ||
    tourId === null ||
    tourName === undefined ||
    departureId === undefined ||
    departOn === undefined ||
    partySize === undefined ||
    lastNudgedOn === undefined ||
    note === undefined
  ) {
    return null
  }
  if (!Array.isArray(value.warnings)) return null
  const warnings: OverviewListRow['warnings'] = []
  for (const w of value.warnings) {
    if (!isRecord(w)) return null
    const code = w.code
    const text = str(w.text)
    if (!isWarningCode(code) || text === null) return null
    warnings.push({ code, text })
  }
  return {
    bookingId,
    contactId,
    contactName,
    tourId,
    tourName,
    departureId,
    departOn,
    status,
    partySize,
    deposit,
    balance,
    lastNudgedOn,
    warnings,
    note,
  }
}

function parseSummary(value: unknown): OverviewSummary | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.groups)) return null
  const groups: OverviewGroup[] = []
  for (const g of value.groups) {
    const parsed = parseGroup(g)
    if (parsed === null) return null
    groups.push(parsed)
  }
  const totals = parseTotals(value.totals)
  const notes = parseNotes(value.notes)
  const hiddenGroupCount = num(value.hiddenGroupCount)
  const hiddenOrders = optionalNum(value.hiddenOrders, 0)
  const hiddenOfflineOnlyGroups = optionalNum(value.hiddenOfflineOnlyGroups, 0)
  if (
    totals === null ||
    notes === null ||
    hiddenGroupCount === null ||
    hiddenOrders === null ||
    hiddenOfflineOnlyGroups === null
  ) {
    return null
  }
  return {
    groups,
    totals,
    hiddenGroupCount,
    hiddenOrders,
    hiddenOfflineOnlyGroups,
    notes,
  }
}

function parseList(value: unknown): OverviewPayload['list'] | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.rows)) return null
  const rows: OverviewListRow[] = []
  for (const r of value.rows) {
    const parsed = parseRow(r)
    if (parsed === null) return null
    rows.push(parsed)
  }
  const page = num(value.page)
  const pageCount = num(value.pageCount)
  const total = num(value.total)
  if (page === null || pageCount === null || total === null) return null
  return { rows, page, pageCount, total }
}

function parsePaidWithoutBooking(value: unknown): OverviewPayload['paidWithoutBooking'] | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.rows)) return null
  const rows: OverviewPayload['paidWithoutBooking']['rows'] = []
  for (const r of value.rows) {
    if (!isRecord(r)) return null
    const id = str(r.id)
    const name = strOrNull(r.name)
    const stage = str(r.stage)
    if (id === null || name === undefined || stage === null) return null
    rows.push({ id, name, stage })
  }
  const total = num(value.total)
  if (total === null) return null
  return { total, rows }
}

/** Validate and normalise the whole payload; null when anything the page reads is malformed. */
export function parseOverviewPayload(value: unknown): OverviewPayload | null {
  if (!isRecord(value)) return null
  const hasBookings = bool(value.hasBookings)
  const today = str(value.today)
  if (hasBookings === null || today === null) return null
  const summary = parseSummary(value.summary)
  const list = parseList(value.list)
  const paidWithoutBooking = parsePaidWithoutBooking(value.paidWithoutBooking)
  if (summary === null || list === null || paidWithoutBooking === null) return null
  return { summary, hasBookings, paidWithoutBooking, list, today }
}

/** Backwards-compatible boolean guard built on the parser. */
export function isOverviewPayload(value: unknown): value is OverviewPayload {
  return parseOverviewPayload(value) !== null
}

/** GET the overview. 403/404 = not available to this person; everything else that is not a good body = error. */
export async function fetchOverview(
  clientId: string,
  query: PaymentsQuery,
  signal?: AbortSignal,
): Promise<OverviewFetchResult> {
  let res: Response
  try {
    res = await fetch(overviewUrl(clientId, query), signal ? { signal } : undefined)
  } catch {
    return { kind: 'error' }
  }
  if (res.status === 403 || res.status === 404) return { kind: 'hidden' }
  if (!res.ok) return { kind: 'error' }
  const body: unknown = await res.json().catch(() => null)
  const parsed = parseOverviewPayload(body)
  return parsed === null ? { kind: 'error' } : { kind: 'ok', data: parsed }
}
