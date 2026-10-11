/**
 * Staff-facing view builder for a contact's bookings.
 *
 * Pure view assembly lives in buildBookingView; the two async helpers load
 * rows through the read store and then delegate. The Supabase client is always
 * passed in; this module never imports a client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BookingView,
  BookingWarning,
  BookingWarningCode,
  CatalogFacts,
  MilestoneKind,
  MilestoneRow,
  MilestoneView,
  BookingWithMilestones,
} from './booking-types'
import { MILESTONE_LABELS } from './booking-types'
import type { DueDates, DueDatesResult } from './booking-schedule'
import { computeMilestoneDueDates } from './booking-schedule'
import type { TravelBookingRule } from './industry/travel-booking-rule'
import {
  getBookingWithMilestones,
  listBookingsForContact,
  loadCatalogFacts,
} from './booking-store-reads'
import { diffDaysIso, isIsoDate } from '../locale/nz-public-holidays'

/** Today's date in Pacific/Auckland as YYYY-MM-DD. */
export function nzTodayIso(now?: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(now ?? new Date())
}

/** Everything the pure view builder needs. */
export interface BookingViewInput {
  item: BookingWithMilestones
  facts: CatalogFacts
  rule: TravelBookingRule
  today: string
}

/** The due-date computation outcome plus any warning it produced. */
interface DueOutcome {
  dates: DueDates | null
  warnings: BookingWarning[]
}

/** Shown when the due date cannot be computed from the current inputs. */
const DUE_UNAVAILABLE_TEXT = '到期日暂时算不出来，请核对出发日期'

/** Build a warning with the shared shape. */
function warn(
  code: BookingWarningCode,
  text: string,
  needsConfirm: boolean,
  kind: MilestoneKind | null,
): BookingWarning {
  return { code, text, needsConfirm, kind }
}

/** The due_unavailable outcome: no dates, one warning. */
function dueUnavailable(): DueOutcome {
  return {
    dates: null,
    warnings: [warn('due_unavailable', DUE_UNAVAILABLE_TEXT, false, null)],
  }
}

/** The computed due date for one milestone kind, or null when unavailable. */
function computedDue(
  dates: DueDates | null,
  kind: MilestoneKind,
): string | null {
  if (dates === null) return null
  return kind === 'deposit' ? dates.depositDueOn : dates.balanceDueOn
}

/** Build one milestone view row. */
function buildMilestoneView(
  row: MilestoneRow,
  dates: DueDates | null,
  today: string,
): MilestoneView {
  const dueOn = row.dueOverrideOn ?? computedDue(dates, row.kind)
  const dueInDays = dueOn === null ? null : diffDaysIso(today, dueOn)
  const overdue =
    row.state === 'unpaid' && dueInDays !== null && dueInDays < 0
  return {
    kind: row.kind,
    label: MILESTONE_LABELS[row.kind],
    state: row.state,
    paidOn: row.paidOn,
    autoByEmail: row.paidSource === 'email',
    dueOn,
    dueOverrideOn: row.dueOverrideOn,
    dueInDays,
    overdue,
    remindAfter: row.remindAfter,
    quiet: row.quiet,
    updatedAt: row.updatedAt,
  }
}

/** Milestone views with no due dates (cancelled bookings, missing dates). */
function milestonesWithoutDates(
  rows: MilestoneRow[],
  today: string,
): MilestoneView[] {
  return rows.map((row) => buildMilestoneView(row, null, today))
}

/** Turn a due-date result into dates plus any warning it implies. */
function resolveDueDates(result: DueDatesResult): DueOutcome {
  if (result.state === 'ok') {
    return { dates: result.dates, warnings: [] }
  }
  if (result.state === 'holiday_table_missing') {
    const years = result.missingYears.join('、')
    return {
      dates: result.provisional,
      warnings: [
        warn(
          'holiday_table_missing',
          `假日表缺失（${years} 年），到期日可能偏早`,
          false,
          null,
        ),
      ],
    }
  }
  if (result.state === 'no_departure') {
    return { dates: null, warnings: [] }
  }
  return dueUnavailable()
}

/** Compute due dates for an active booking, guarding invalid ISO input. */
function computeDueOutcome(
  input: BookingViewInput,
  effectiveDepartOn: string | null,
): DueOutcome {
  const { booking } = input.item
  if (effectiveDepartOn === null) {
    return { dates: null, warnings: [] }
  }
  if (!isIsoDate(effectiveDepartOn) || !isIsoDate(booking.bookedOn)) {
    return dueUnavailable()
  }
  const live = booking.departureId
    ? input.facts.departures.get(booking.departureId)
    : undefined
  const result = computeMilestoneDueDates(input.rule, {
    bookedOn: booking.bookedOn,
    departOn: effectiveDepartOn,
    returnOn: live?.returnOn ?? null,
    durationText: input.facts.tours.get(booking.tourId)?.durationText ?? null,
    isCruise: booking.isCruise,
  })
  return resolveDueDates(result)
}

/** Catalog warnings about the tour and the departure date. */
function catalogWarnings(
  input: BookingViewInput,
  effectiveDepartOn: string | null,
): BookingWarning[] {
  const { booking } = input.item
  const out: BookingWarning[] = []
  if (!input.facts.tours.has(booking.tourId)) {
    out.push(warn('tour_missing', '团目录里已找不到这个团', false, null))
  }
  if (booking.departureId === null) {
    out.push(
      warn(
        'departure_not_set',
        '出发日期还没定，补上才有到期日',
        false,
        null,
      ),
    )
    return out
  }
  const live = input.facts.departures.get(booking.departureId)
  if (live === undefined) {
    out.push(
      warn(
        'departure_missing',
        `团目录里已找不到这个出发日期（原为 ${booking.departureDepartOn ?? '（未定）'}）`,
        false,
        null,
      ),
    )
    return out
  }
  if (live.status === 'cancelled') {
    out.push(warn('departure_cancelled', '这个出发日期已取消', false, null))
  }
  if (booking.departureDepartOn !== live.departOn) {
    out.push(
      warn(
        'departure_changed',
        `出发日变了：原 ${booking.departureDepartOn ?? '（未定）'} 现 ${live.departOn}，到期日已重算，请确认`,
        true,
        null,
      ),
    )
  }
  return out
}

/** Warnings about the computed dates and the tour length. */
function dateWarnings(
  input: BookingViewInput,
  dates: DueDates | null,
): BookingWarning[] {
  const out: BookingWarning[] = []
  if (dates !== null && dates.durationMismatch) {
    out.push(warn('tour_length_mismatch', '团天数对不上，请核对', false, null))
  }
  if (!input.item.booking.isCruise) {
    const n = dates ? dates.leadDays : input.rule.balanceLeadDays.standard
    out.push(warn('cruise_not_ticked', `未勾邮轮按 ${n} 天算`, false, null))
  }
  if (dates !== null && dates.mode === 'full_payment') {
    out.push(
      warn('pay_in_full', '这单离出发太近，需一次付清', false, null),
    )
  }
  return out
}

/** Warnings for manual due-date overrides that no longer match departure. */
function overrideWarnings(
  rows: MilestoneRow[],
  effectiveDepartOn: string | null,
): BookingWarning[] {
  const out: BookingWarning[] = []
  for (const row of rows) {
    if (row.dueOverrideOn === null) continue
    if (row.dueOverrideDepartOn === effectiveDepartOn) continue
    out.push(
      warn(
        'override_stale',
        `你手改的到期日是按原出发日 ${row.dueOverrideDepartOn ?? '（未定）'} 定的，现在出发日是 ${effectiveDepartOn ?? '（未定）'}，请核对`,
        false,
        row.kind,
      ),
    )
  }
  return out
}

/** Assemble the full warning list in the documented order. */
function buildWarnings(
  input: BookingViewInput,
  effectiveDepartOn: string | null,
  due: DueOutcome,
): BookingWarning[] {
  return [
    ...catalogWarnings(input, effectiveDepartOn),
    ...due.warnings,
    ...dateWarnings(input, due.dates),
    ...overrideWarnings(input.item.milestones, effectiveDepartOn),
  ]
}

/** Build the shared view fields; looks up the tour and live departure. */
function baseView(
  input: BookingViewInput,
  effectiveDepartOn: string | null,
  milestones: MilestoneView[],
  warnings: BookingWarning[],
  payInFull: boolean,
): BookingView {
  const { booking } = input.item
  const tour = input.facts.tours.get(booking.tourId)
  const live = booking.departureId
    ? input.facts.departures.get(booking.departureId)
    : undefined
  return {
    id: booking.id,
    tourId: booking.tourId,
    tourName: tour?.name ?? null,
    departureId: booking.departureId,
    departOn: effectiveDepartOn,
    departureStatus: live?.status ?? null,
    bookedOn: booking.bookedOn,
    partySize: booking.partySize,
    isCruise: booking.isCruise,
    status: booking.status,
    cancelNote: booking.cancelNote,
    note: booking.note,
    updatedAt: booking.updatedAt,
    payInFull,
    milestones,
    warnings,
  }
}

/** Build the staff-facing view of one booking. Pure: no I/O, no clock. */
export function buildBookingView(input: BookingViewInput): BookingView {
  const { booking, milestones } = input.item
  const live = booking.departureId
    ? input.facts.departures.get(booking.departureId)
    : undefined
  const effectiveDepartOn = live?.departOn ?? booking.departureDepartOn

  if (booking.status === 'cancelled') {
    return baseView(
      input,
      effectiveDepartOn,
      milestonesWithoutDates(milestones, input.today),
      [],
      false,
    )
  }

  const due = computeDueOutcome(input, effectiveDepartOn)
  return baseView(
    input,
    effectiveDepartOn,
    milestones.map((row) => buildMilestoneView(row, due.dates, input.today)),
    buildWarnings(input, effectiveDepartOn, due),
    due.dates?.mode === 'full_payment',
  )
}

/** Load catalog facts for a set of bookings and build their views. */
async function buildViewsForItems(
  db: SupabaseClient,
  clientId: string,
  items: BookingWithMilestones[],
  rule: TravelBookingRule,
  today: string,
): Promise<BookingView[]> {
  if (items.length === 0) return []
  const tourIds = items.map((item) => item.booking.tourId)
  const departureIds: string[] = []
  for (const item of items) {
    if (item.booking.departureId !== null) {
      departureIds.push(item.booking.departureId)
    }
  }
  const facts = await loadCatalogFacts(db, clientId, tourIds, departureIds)
  return items.map((item) => buildBookingView({ item, facts, rule, today }))
}

/** Staff-facing views of every booking for one contact. */
export async function getContactBookingViews(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
  rule: TravelBookingRule,
  today: string,
): Promise<BookingView[]> {
  const items = await listBookingsForContact(db, clientId, contactId)
  return buildViewsForItems(db, clientId, items, rule, today)
}

/** Staff-facing view of one booking, or null when it does not exist. */
export async function getBookingView(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
  rule: TravelBookingRule,
  today: string,
): Promise<BookingView | null> {
  const item = await getBookingWithMilestones(db, clientId, bookingId)
  if (item === null) return null
  const views = await buildViewsForItems(db, clientId, [item], rule, today)
  return views[0] ?? null
}
