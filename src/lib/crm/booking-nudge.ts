/**
 * Staff "付款要催" (payments to chase) list builder.
 *
 * Pure helpers (limit normalisation, tightest-item pick, bucketing, list
 * assembly) live at the top; buildNudgeList loads rows through the read store
 * and then delegates. The Supabase client is always passed in; this module
 * never imports a client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BookingRow,
  BookingView,
  BookingWarningCode,
  MilestoneRow,
  MilestoneView,
  NudgeBucket,
  NudgeList,
  NudgeRow,
} from './booking-types'
import {
  NUDGE_CANDIDATE_CAP,
  NUDGE_OVERDUE_COLLAPSE_DAYS,
  NUDGE_SOON_DAYS,
  NUDGE_WINDOW_DAYS,
} from './booking-types'
import { buildBookingView } from './booking-view'
import type { TravelBookingRule } from './industry/travel-booking-rule'
import {
  listActiveBookingsForNudge,
  listContactsForNudge,
  listMilestonesForBookings,
  loadCatalogFacts,
} from './booking-store-reads'

/** Default number of rows returned when the caller does not ask for a size. */
export const NUDGE_DEFAULT_LIMIT = 10

/** Hard ceiling on the number of rows returned. */
export const NUDGE_MAX_LIMIT = 100

/** The bucket order used when sorting the assembled list. */
const BUCKET_ORDER: Record<NudgeBucket, number> = {
  overdue: 0,
  within_3: 1,
  within_14: 2,
}

/** Clamp a caller-supplied limit into the supported range. */
export function normaliseNudgeLimit(raw: number | null): number {
  if (raw === null || !Number.isInteger(raw) || raw < 1) {
    return NUDGE_DEFAULT_LIMIT
  }
  if (raw > NUDGE_MAX_LIMIT) {
    return NUDGE_MAX_LIMIT
  }
  return raw
}

/** True when a milestone is unpaid, not quiet, dated and not snoozed. */
function isChaseable(milestone: MilestoneView, today: string): boolean {
  if (milestone.state !== 'unpaid') return false
  if (milestone.quiet) return false
  if (milestone.dueOn === null) return false
  if (milestone.remindAfter !== null && milestone.remindAfter > today) {
    return false
  }
  return true
}

/** True when `a` should be picked over `b` (earlier dueOn, deposit first). */
function isTighter(a: MilestoneView, b: MilestoneView): boolean {
  if (a.dueOn === null || b.dueOn === null) return false
  if (a.dueOn !== b.dueOn) return a.dueOn < b.dueOn
  return a.kind === 'deposit' && b.kind === 'balance'
}

/**
 * The single milestone a booking should be chased for, or null.
 *
 * Only active bookings qualify; among the chaseable milestones the one with
 * the smallest dueOn wins (ties go to the deposit).
 */
export function pickTightestItem(
  view: BookingView,
  today: string,
): MilestoneView | null {
  if (view.status !== 'active') return null
  let best: MilestoneView | null = null
  for (const milestone of view.milestones) {
    if (!isChaseable(milestone, today)) continue
    if (best === null || isTighter(milestone, best)) {
      best = milestone
    }
  }
  return best
}

/** Map a due-in-days value onto its bucket, or a non-listed marker. */
export function bucketFor(
  dueInDays: number,
): NudgeBucket | 'collapsed' | 'later' {
  if (dueInDays < -NUDGE_OVERDUE_COLLAPSE_DAYS) return 'collapsed'
  if (dueInDays < 0) return 'overdue'
  if (dueInDays <= NUDGE_SOON_DAYS) return 'within_3'
  if (dueInDays <= NUDGE_WINDOW_DAYS) return 'within_14'
  return 'later'
}

/** Compare two rows for the assembled list order. */
function compareRows(a: NudgeRow, b: NudgeRow): number {
  const byBucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
  if (byBucket !== 0) return byBucket
  if (a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1
  if (a.bookingId !== b.bookingId) return a.bookingId < b.bookingId ? -1 : 1
  return 0
}

/** Sort, truncate and package the rows into the final list. */
export function assembleNudgeList(
  rows: NudgeRow[],
  collapsedOverdue: number,
  truncated: boolean,
  limit: number,
): NudgeList {
  const sorted = [...rows].sort(compareRows)
  return {
    rows: sorted.slice(0, limit),
    more: sorted.length > limit,
    collapsedOverdue,
    truncated,
  }
}

/** The distinct contact ids referenced by a set of bookings. */
function contactIdsOf(bookings: { contactId: string }[]): string[] {
  return Array.from(new Set(bookings.map((booking) => booking.contactId)))
}

/** The distinct tour ids referenced by a set of bookings. */
function tourIdsOf(bookings: { tourId: string }[]): string[] {
  return Array.from(new Set(bookings.map((booking) => booking.tourId)))
}

/** The non-null departure ids referenced by a set of bookings. */
function departureIdsOf(
  bookings: { departureId: string | null }[],
): string[] {
  const out: string[] = []
  for (const booking of bookings) {
    if (booking.departureId !== null) out.push(booking.departureId)
  }
  return Array.from(new Set(out))
}

/** The view's warning codes, de-duplicated, in their original order. */
function warningCodesOf(view: BookingView): BookingWarningCode[] {
  const out: BookingWarningCode[] = []
  for (const warning of view.warnings) {
    if (!out.includes(warning.code)) out.push(warning.code)
  }
  return out
}

/** Everything buildNudgeList needs to turn one booking into a row. */
interface RowContext {
  rule: TravelBookingRule
  today: string
  facts: Awaited<ReturnType<typeof loadCatalogFacts>>
  contacts: Awaited<ReturnType<typeof listContactsForNudge>>
}

/** The outcome of considering one booking: a row, a collapse, or nothing. */
type RowOutcome =
  | { kind: 'row'; row: NudgeRow }
  | { kind: 'collapsed' }
  | { kind: 'skip' }

/** Build the NudgeRow for a chaseable milestone, or a skip/collapse marker. */
function outcomeForBooking(
  booking: Parameters<typeof buildBookingView>[0]['item']['booking'],
  milestones: Parameters<typeof buildBookingView>[0]['item']['milestones'],
  context: RowContext,
): RowOutcome {
  const contact = context.contacts.get(booking.contactId)
  if (contact === undefined || contact.doNotContact) return { kind: 'skip' }

  const view = buildBookingView({
    item: { booking, milestones },
    facts: context.facts,
    rule: context.rule,
    today: context.today,
  })
  const item = pickTightestItem(view, context.today)
  if (item === null || item.dueInDays === null) return { kind: 'skip' }

  const bucket = bucketFor(item.dueInDays)
  if (bucket === 'collapsed') return { kind: 'collapsed' }
  if (bucket === 'later') return { kind: 'skip' }

  return {
    kind: 'row',
    row: {
      bookingId: booking.id,
      contactId: booking.contactId,
      contactName: contact.name,
      tourName: view.tourName,
      kind: item.kind,
      label: item.label,
      dueOn: item.dueOn ?? '',
      dueInDays: item.dueInDays,
      bucket,
      milestoneUpdatedAt: item.updatedAt,
      warningCodes: warningCodesOf(view),
    },
  }
}

/** Group milestones by their booking id. */
function groupMilestones(
  milestones: Awaited<ReturnType<typeof listMilestonesForBookings>>,
): Map<string, typeof milestones> {
  const byBooking = new Map<string, typeof milestones>()
  for (const milestone of milestones) {
    const list = byBooking.get(milestone.bookingId)
    if (list === undefined) {
      byBooking.set(milestone.bookingId, [milestone])
    } else {
      list.push(milestone)
    }
  }
  return byBooking
}

/** Turn each booking into a row, counting the collapsed-overdue ones. */
function collectRows(
  bookings: BookingRow[],
  byBooking: Map<string, MilestoneRow[]>,
  context: RowContext,
): { rows: NudgeRow[]; collapsedOverdue: number } {
  const rows: NudgeRow[] = []
  let collapsedOverdue = 0
  for (const booking of bookings) {
    const outcome = outcomeForBooking(
      booking,
      byBooking.get(booking.id) ?? [],
      context,
    )
    if (outcome.kind === 'row') {
      rows.push(outcome.row)
    } else if (outcome.kind === 'collapsed') {
      collapsedOverdue += 1
    }
  }
  return { rows, collapsedOverdue }
}

/** Build the staff "payments to chase" list for one client. */
export async function buildNudgeList(
  db: SupabaseClient,
  clientId: string,
  rule: TravelBookingRule,
  today: string,
  limit: number,
): Promise<NudgeList> {
  const { bookings, truncated } = await listActiveBookingsForNudge(
    db,
    clientId,
    NUDGE_CANDIDATE_CAP,
  )
  if (bookings.length === 0) {
    return { rows: [], more: false, collapsedOverdue: 0, truncated }
  }

  const [milestones, contacts, facts] = await Promise.all([
    listMilestonesForBookings(
      db,
      clientId,
      bookings.map((booking) => booking.id),
    ),
    listContactsForNudge(db, clientId, contactIdsOf(bookings)),
    loadCatalogFacts(
      db,
      clientId,
      tourIdsOf(bookings),
      departureIdsOf(bookings),
    ),
  ])

  const byBooking = groupMilestones(milestones)
  const context: RowContext = { rule, today, facts, contacts }
  const { rows, collapsedOverdue } = collectRows(bookings, byBooking, context)

  return assembleNudgeList(rows, collapsedOverdue, truncated, limit)
}
