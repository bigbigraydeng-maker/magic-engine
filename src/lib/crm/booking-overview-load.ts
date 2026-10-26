/**
 * CRM 付款总览 (payment overview) — the thin async orchestrator the route calls.
 *
 * Everything pure already exists (booking-overview, booking-overview-list);
 * this file only loads rows and wires them together. Read-only: it never
 * writes, and the Supabase client is always passed in, never imported.
 *
 * The three top-level reads — bookings, milestones/paid-without-booking, and
 * the bookable catalog — run in parallel. If any of them throws — including
 * the fetchAll hard-cap error or a failed catalog read — the error propagates:
 * no try/catch, no partial result, no fallback. The page refuses to render
 * numbers rather than show half a book or silently drop catalog rows.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TravelBookingRule } from './industry/travel-booking-rule'
import type {
  BookingRow,
  BookingWithMilestones,
  CatalogFacts,
  MilestoneRow,
} from './booking-types'
import type {
  OverviewListPage,
  OverviewListQuery,
  OverviewStatusFilter,
  OverviewSummary,
} from './booking-overview-types'
import {
  listBookingsForOverview,
  listContactNamesForClient,
  listMilestonesForClient,
  listPaidStageContactsWithoutBooking,
} from './booking-overview-reads'
import { loadCatalogFacts } from './booking-store-reads'
import { loadBookingOptions } from './booking-options'
import { emptyDeparturesFor } from './booking-overview-empty'
import { buildOverviewEntries, summariseOverview } from './booking-overview'
import {
  selectOverviewListPage,
  toOverviewListRows,
} from './booking-overview-list'

/** The filters and paging the route passes down from the query string. */
export interface OverviewRequest {
  /** undefined = any departure, null = no departure chosen, string = that departure_id. */
  departureId?: string | null
  tourId?: string
  status: OverviewStatusFilter
  page: number
  includePastPaid: boolean
}

/** Everything the overview page needs to render, in one payload. */
export interface OverviewPayload {
  summary: OverviewSummary
  /** true when the client has at least one booking row at all (active or cancelled). */
  hasBookings: boolean
  paidWithoutBooking: {
    total: number
    rows: Array<{ id: string; name: string | null; stage: string }>
  }
  list: OverviewListPage
  today: string
}

/** Deposit sorts before balance; anything else keeps its relative order. */
function milestoneRank(kind: MilestoneRow['kind']): number {
  return kind === 'deposit' ? 0 : 1
}

/**
 * Group milestones by bookingId into one BookingWithMilestones per booking.
 *
 * Milestones whose booking is not in `bookings` are ignored. Each booking's
 * milestones are sorted deposit first, then balance.
 */
function groupMilestones(
  bookings: BookingRow[],
  milestones: MilestoneRow[],
): BookingWithMilestones[] {
  const byBooking = new Map<string, MilestoneRow[]>()
  for (const m of milestones) {
    const list = byBooking.get(m.bookingId)
    if (list === undefined) byBooking.set(m.bookingId, [m])
    else list.push(m)
  }
  return bookings.map((booking) => {
    const own = byBooking.get(booking.id) ?? []
    // The database guarantees exactly one deposit and one balance; anything else is a data error.
    if (own.length !== 2 || own.filter((m) => m.kind === 'deposit').length !== 1) {
      throw new Error('incomplete milestone set')
    }
    const sorted = [...own].sort(
      (a, b) => milestoneRank(a.kind) - milestoneRank(b.kind),
    )
    return { booking, milestones: sorted }
  })
}

/** The distinct tour ids across the bookings. */
function tourIdsOf(bookings: BookingRow[]): string[] {
  return Array.from(new Set(bookings.map((b) => b.tourId)))
}

/** The distinct, non-null departure ids across the bookings. */
function departureIdsOf(bookings: BookingRow[]): string[] {
  const ids: string[] = []
  for (const b of bookings) {
    if (b.departureId !== null) ids.push(b.departureId)
  }
  return Array.from(new Set(ids))
}

/** Load catalog facts once, or empty Maps when there are no bookings. */
async function loadFacts(
  db: SupabaseClient,
  clientId: string,
  bookings: BookingRow[],
): Promise<CatalogFacts> {
  if (bookings.length === 0) {
    return { tours: new Map(), departures: new Map() }
  }
  return loadCatalogFacts(
    db,
    clientId,
    tourIdsOf(bookings),
    departureIdsOf(bookings),
  )
}

/** Build the list query, omitting undefined filters so they mean "no filter". */
function listQueryOf(req: OverviewRequest): OverviewListQuery {
  return {
    ...(req.departureId !== undefined ? { departureId: req.departureId } : {}),
    ...(req.tourId !== undefined ? { tourId: req.tourId } : {}),
    status: req.status,
    page: req.page,
  }
}

/** Load the overview: rows in, one payload out. Read-only, no fallbacks. */
export async function loadBookingOverview(
  db: SupabaseClient,
  clientId: string,
  rule: TravelBookingRule,
  today: string,
  req: OverviewRequest,
): Promise<OverviewPayload> {
  const bookings = await listBookingsForOverview(db, clientId)
  const [milestones, paidWithoutBooking, options] = await Promise.all([
    listMilestonesForClient(db, clientId),
    listPaidStageContactsWithoutBooking(db, clientId, bookings),
    loadBookingOptions(db, clientId, today),
  ])

  const items = groupMilestones(bookings, milestones)
  const facts = await loadFacts(db, clientId, bookings)
  const entries = buildOverviewEntries(items, facts, rule, today)
  const summary = summariseOverview(
    entries,
    today,
    req.includePastPaid,
    emptyDeparturesFor(options, today),
  )

  const page = selectOverviewListPage(entries, listQueryOf(req), today)
  const names = await listContactNamesForClient(
    db,
    clientId,
    page.entries.map((e) => e.item.booking.contactId),
  )
  const rows = toOverviewListRows(page.entries, names)

  return {
    summary,
    hasBookings: bookings.length > 0,
    paidWithoutBooking,
    list: {
      rows,
      page: page.page,
      pageCount: page.pageCount,
      total: page.total,
    },
    today,
  }
}
