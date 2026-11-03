/**
 * Pure server-side filter / sort / pagination for the lower half of the CRM
 * 付款总览 (payment overview) page: the 订单清单 (all-orders list).
 *
 * No I/O, no clock (today is a parameter), no Supabase. The status filter
 * reuses isUnsettled / isFullyPaid from booking-overview so the list and the
 * summary can never disagree about what "未收齐" means. Everything here counts
 * ORDERS and people (party size), never money: a row carries a party size (null
 * when unknown or cancelled) but never an amount.
 */

import type {
  BookingWithMilestones,
  MilestoneKind,
  MilestoneView,
} from './booking-types'
import type {
  OverviewEntry,
  OverviewListQuery,
  OverviewListRow,
  OverviewMilestoneCell,
  OverviewStatusFilter,
} from './booking-overview-types'
import { OVERVIEW_PAGE_SIZE } from './booking-overview-types'
import { isFullyPaid, isOfflineOnly, isUnsettled } from './booking-overview'

/** The band an entry sorts into: upcoming, past, or undated. */
type SortBand = 0 | 1 | 2

/** True when the entry passes the tour, departure and status filters. */
function matchesFilters(entry: OverviewEntry, query: OverviewListQuery): boolean {
  const { view } = entry
  if (query.tourId !== undefined && view.tourId !== query.tourId) return false
  if (
    query.departureId !== undefined &&
    view.departureId !== query.departureId
  ) {
    return false
  }
  return matchesStatus(view.status, query.status, entry)
}

/** True when the entry passes the status filter. */
function matchesStatus(
  status: 'active' | 'cancelled',
  filter: OverviewStatusFilter,
  entry: OverviewEntry,
): boolean {
  if (filter === 'cancelled') return status === 'cancelled'
  if (status === 'cancelled') return false
  if (filter === 'all') return true
  if (filter === 'unsettled') return isUnsettled(entry.view)
  if (filter === 'offline') return isOfflineOnly(entry.view)
  return isFullyPaid(entry.view)
}

/** The sort band: 0 = upcoming, 1 = past, 2 = no date at all. */
function bandOf(view: OverviewEntry['view'], today: string): SortBand {
  if (view.departOn === null) return 2
  return view.departOn >= today ? 0 : 1
}

/** Total order over entries: band, then date, then bookedOn, then id. */
function compareEntries(a: OverviewEntry, b: OverviewEntry, today: string): number {
  const ba = bandOf(a.view, today)
  const bb = bandOf(b.view, today)
  if (ba !== bb) return ba - bb
  if (ba === 0 || ba === 1) {
    const da = a.view.departOn ?? ''
    const db = b.view.departOn ?? ''
    if (da !== db) {
      // Upcoming: ascending. Past: most recent first (descending).
      return ba === 0 ? (da < db ? -1 : 1) : da < db ? 1 : -1
    }
  }
  if (a.view.bookedOn !== b.view.bookedOn) {
    return a.view.bookedOn < b.view.bookedOn ? -1 : 1
  }
  if (a.view.id === b.view.id) return 0
  return a.view.id < b.view.id ? -1 : 1
}

/** Clamp a requested page into [1, pageCount]; non-integer / < 1 => 1. */
function clampPage(page: number, pageCount: number): number {
  if (!Number.isInteger(page) || page < 1) return 1
  return page > pageCount ? pageCount : page
}

/** Filter, order and paginate the entries for the all-orders list. */
export function selectOverviewListPage(
  entries: OverviewEntry[],
  query: OverviewListQuery,
  today: string,
): { entries: OverviewEntry[]; page: number; pageCount: number; total: number } {
  const filtered = entries.filter((entry) => matchesFilters(entry, query))
  const ordered = [...filtered].sort((a, b) => compareEntries(a, b, today))
  const total = ordered.length
  const pageCount = Math.max(1, Math.ceil(total / OVERVIEW_PAGE_SIZE))
  const page = clampPage(query.page, pageCount)
  const start = (page - 1) * OVERVIEW_PAGE_SIZE
  return {
    entries: ordered.slice(start, start + OVERVIEW_PAGE_SIZE),
    page,
    pageCount,
    total,
  }
}

/** The latest non-null nudgedOn over the booking's milestones, or null. */
export function lastNudgedOn(item: BookingWithMilestones): string | null {
  let best: string | null = null
  for (const m of item.milestones) {
    if (m.nudgedOn === null) continue
    if (best === null || m.nudgedOn > best) best = m.nudgedOn
  }
  return best
}

/** Build the list cell for one milestone kind, or null when it is absent. */
function cellFor(
  view: OverviewEntry['view'],
  kind: MilestoneKind,
): OverviewMilestoneCell | null {
  // A cancelled order owes nothing: no 未收 cells that could read as money still due.
  if (view.status === 'cancelled') return null
  const m = view.milestones.find((x) => x.kind === kind)
  if (m === undefined) return null
  return toCell(m, false)
}

/** Copy a MilestoneView into a list cell; cancelled bookings are never overdue. */
function toCell(m: MilestoneView, cancelled: boolean): OverviewMilestoneCell {
  return {
    kind: m.kind,
    label: m.label,
    state: m.state,
    paidOn: m.paidOn,
    dueOn: m.dueOn,
    dueNote: m.dueNote,
    overdue: cancelled ? false : m.overdue,
    quiet: m.quiet,
  }
}

/** Build one list row from an entry and the contact-name lookup. */
function toRow(
  entry: OverviewEntry,
  names: Map<string, string | null>,
): OverviewListRow {
  const { item, view } = entry
  const contactId = item.booking.contactId
  return {
    bookingId: view.id,
    contactId,
    contactName: names.get(contactId) ?? null,
    tourId: view.tourId,
    tourName: view.tourName,
    departureId: view.departureId,
    departOn: view.departOn,
    status: view.status,
    partySize: view.status === 'cancelled' ? null : view.partySize,
    deposit: cellFor(view, 'deposit'),
    balance: cellFor(view, 'balance'),
    lastNudgedOn: lastNudgedOn(item),
    // The standard lead-time note repeats on every row; keep only the unusual ones (cruise, long tour).
    warnings: view.warnings.filter((w) => w.defaultLead !== true).map((w) => ({ code: w.code, text: w.text })),
    note: view.status === 'cancelled' ? view.cancelNote : view.note,
  }
}

/** Build the list rows for the given entries, in the given order. */
export function toOverviewListRows(
  entries: OverviewEntry[],
  names: Map<string, string | null>,
): OverviewListRow[] {
  return entries.map((entry) => toRow(entry, names))
}
