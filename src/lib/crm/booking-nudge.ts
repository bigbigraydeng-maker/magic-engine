/**
 * Staff "付款要催" (payments to chase) list builder.
 *
 * Pure helpers (limit normalisation, chaseability, tightest-item pick,
 * bucketing, decision, list assembly) live at the top; buildNudgeList loads
 * rows through the read store and then delegates. The Supabase client is
 * always passed in; this module never imports a client.
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
  listActiveBookingsByIds,
  listContactsForNudge,
  listUnpaidMilestonesForClient,
  loadCatalogFacts,
} from './booking-store-reads'

/** Default number of rows returned when the caller does not ask for a size. */
export const NUDGE_DEFAULT_LIMIT = 10

/** Hard ceiling on the number of rows returned. */
export const NUDGE_MAX_LIMIT = 100

/** At most this many long-overdue guests are listed behind the folded line. */
export const NUDGE_COLLAPSED_ROWS_CAP = 50

/** The bucket order used when sorting the assembled list. */
const BUCKET_ORDER: Record<NudgeBucket, number> = {
  overdue: 0,
  within_3: 1,
  within_14: 2,
  undated: 3,
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

/** True when a milestone is unpaid, not quiet and not snoozed past today. */
function isChaseable(milestone: MilestoneView, today: string): boolean {
  if (milestone.state !== 'unpaid') return false
  if (milestone.quiet) return false
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
    if (milestone.dueOn === null) continue
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

/** The decision for one booking: a row, a collapse, or nothing. */
export type NudgeDecision =
  | { kind: 'row'; item: MilestoneView; bucket: NudgeBucket }
  | { kind: 'collapsed'; item: MilestoneView }
  | { kind: 'skip' }

/** True when a bucket is one of the three listable dated buckets. */
function isListableBucket(
  bucket: NudgeBucket | 'collapsed' | 'later',
): bucket is 'overdue' | 'within_3' | 'within_14' {
  return bucket === 'overdue' || bucket === 'within_3' || bucket === 'within_14'
}

/** The tightest milestone among a set, or null when the set is empty. */
function tightestOf(items: MilestoneView[]): MilestoneView | null {
  let best: MilestoneView | null = null
  for (const item of items) {
    if (best === null || isTighter(item, best)) {
      best = item
    }
  }
  return best
}

/** The undated item to show: the deposit when present, else the first. */
function undatedPick(items: MilestoneView[]): MilestoneView | null {
  for (const item of items) {
    if (item.kind === 'deposit') return item
  }
  return items[0] ?? null
}

/**
 * Decide what one booking contributes to the chase list.
 *
 * A booking yields at most one decision: the tightest listable dated item,
 * else a collapse when every dated item is long overdue, else an undated row,
 * else nothing.
 */
export function decideNudgeItem(
  view: BookingView,
  today: string,
): NudgeDecision {
  if (view.status !== 'active') return { kind: 'skip' }
  const items = view.milestones.filter((m) => isChaseable(m, today))
  if (items.length === 0) return { kind: 'skip' }

  const dated = items.filter((m) => m.dueOn !== null && m.dueInDays !== null)
  const listable = dated.filter((m) =>
    isListableBucket(bucketFor(m.dueInDays as number)),
  )
  if (listable.length > 0) {
    const item = tightestOf(listable)
    if (item !== null && item.dueInDays !== null) {
      const bucket = bucketFor(item.dueInDays)
      if (isListableBucket(bucket)) {
        return { kind: 'row', item, bucket }
      }
    }
  }

  const collapsed = dated.filter(
    (m) => bucketFor(m.dueInDays as number) === 'collapsed',
  )
  const deepest = tightestOf(collapsed)
  if (deepest !== null) return { kind: 'collapsed', item: deepest }

  const undated = items.filter((m) => m.dueOn === null)
  const pick = undatedPick(undated)
  if (pick !== null) return { kind: 'row', item: pick, bucket: 'undated' }

  return { kind: 'skip' }
}

/** Compare two rows for the assembled list order. */
function compareRows(a: NudgeRow, b: NudgeRow): number {
  const byBucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
  if (byBucket !== 0) return byBucket
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return 1
    if (b.dueOn === null) return -1
    return a.dueOn < b.dueOn ? -1 : 1
  }
  if (a.bookingId !== b.bookingId) return a.bookingId < b.bookingId ? -1 : 1
  return 0
}

/** Sort, truncate and package the rows into the final list. */
export function assembleNudgeList(
  rows: NudgeRow[],
  collapsedOverdue: number,
  truncated: boolean,
  limit: number,
  collapsedRows: NudgeRow[] = [],
): NudgeList {
  const sorted = [...rows].sort(compareRows)
  const deepFirst = [...collapsedRows].sort(compareRows)
  return {
    rows: sorted.slice(0, limit),
    more: sorted.length > limit,
    collapsedOverdue,
    collapsedRows: deepFirst.slice(0, NUDGE_COLLAPSED_ROWS_CAP),
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

/** The due note of the first undated unpaid milestone, or null. */
function undatedNoteOf(view: BookingView): string | null {
  for (const milestone of view.milestones) {
    if (milestone.state !== 'unpaid') continue
    if (milestone.dueOn !== null) continue
    if (milestone.dueNote !== null) return milestone.dueNote
  }
  return null
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
  | { kind: 'collapsed'; row: NudgeRow }
  | { kind: 'skip' }

/** Build the NudgeRow for a decided item, or a skip/collapse marker. */
function outcomeForBooking(
  booking: BookingRow,
  milestones: MilestoneRow[],
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
  const decision = decideNudgeItem(view, context.today)
  if (decision.kind === 'skip') return { kind: 'skip' }
  if (decision.kind === 'collapsed') {
    return {
      kind: 'collapsed',
      row: rowFor(booking, contact.name, view, decision.item, 'overdue'),
    }
  }
  return {
    kind: 'row',
    row: rowFor(booking, contact.name, view, decision.item, decision.bucket),
  }
}

/** Assemble the list row for one booking and its chosen item. */
function rowFor(
  booking: BookingRow,
  contactName: string | null,
  view: BookingView,
  item: MilestoneView,
  bucket: NudgeBucket,
): NudgeRow {
  return {
      bookingId: booking.id,
      contactId: booking.contactId,
      contactName,
      tourName: view.tourName,
      departOn: view.departOn,
      kind: item.kind,
      label: item.label,
      dueOn: item.dueOn,
      dueInDays: item.dueInDays,
      bucket,
      note: undatedNoteOf(view),
      milestoneUpdatedAt: item.updatedAt,
      warningCodes: warningCodesOf(view),
  }
}

/** Group milestones by their booking id. */
function groupMilestones(
  milestones: MilestoneRow[],
): Map<string, MilestoneRow[]> {
  const byBooking = new Map<string, MilestoneRow[]>()
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

/** Turn each booking into a row, keeping the long-overdue ones apart. */
function collectRows(
  bookings: BookingRow[],
  byBooking: Map<string, MilestoneRow[]>,
  context: RowContext,
): { rows: NudgeRow[]; collapsedRows: NudgeRow[] } {
  const rows: NudgeRow[] = []
  const collapsedRows: NudgeRow[] = []
  for (const booking of bookings) {
    const outcome = outcomeForBooking(
      booking,
      byBooking.get(booking.id) ?? [],
      context,
    )
    if (outcome.kind === 'row') {
      rows.push(outcome.row)
    } else if (outcome.kind === 'collapsed') {
      collapsedRows.push(outcome.row)
    }
  }
  return { rows, collapsedRows }
}

/** True when an unpaid milestone is not quiet and not snoozed past today. */
function isEligibleMilestone(milestone: MilestoneRow, today: string): boolean {
  if (milestone.state !== 'unpaid') return false
  if (milestone.quiet) return false
  if (milestone.remindAfter !== null && milestone.remindAfter > today) {
    return false
  }
  return true
}

/** The distinct booking ids referenced by a set of milestones. */
function bookingIdsOf(milestones: MilestoneRow[]): string[] {
  return Array.from(new Set(milestones.map((milestone) => milestone.bookingId)))
}

/** Build the staff "payments to chase" list for one client. */
export async function buildNudgeList(
  db: SupabaseClient,
  clientId: string,
  rule: TravelBookingRule,
  today: string,
  limit: number,
): Promise<NudgeList> {
  const all = await listUnpaidMilestonesForClient(db, clientId)
  const eligible = all.filter((milestone) =>
    isEligibleMilestone(milestone, today),
  )
  if (eligible.length === 0) {
    return { rows: [], more: false, collapsedOverdue: 0, collapsedRows: [], truncated: false }
  }

  const bookings = await listActiveBookingsByIds(
    db,
    clientId,
    bookingIdsOf(eligible),
  )
  const truncated = bookings.length > NUDGE_CANDIDATE_CAP
  const candidates = bookings.slice(0, NUDGE_CANDIDATE_CAP)
  if (candidates.length === 0) {
    return { rows: [], more: false, collapsedOverdue: 0, collapsedRows: [], truncated }
  }

  const [contacts, facts] = await Promise.all([
    listContactsForNudge(db, clientId, contactIdsOf(candidates)),
    loadCatalogFacts(
      db,
      clientId,
      tourIdsOf(candidates),
      departureIdsOf(candidates),
    ),
  ])

  const byBooking = groupMilestones(eligible)
  const context: RowContext = { rule, today, facts, contacts }
  const { rows, collapsedRows } = collectRows(candidates, byBooking, context)

  return assembleNudgeList(rows, collapsedRows.length, truncated, limit, collapsedRows)
}
