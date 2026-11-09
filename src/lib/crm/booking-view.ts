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
import {
  computeDepositDueOnly,
  computeMilestoneDueDates,
} from './booking-schedule'
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
  depositOnlyOn: string | null
  balanceNote: string | null
}

/** Shown when the due date cannot be computed from the current inputs. */
const DUE_UNAVAILABLE_TEXT = '到期日暂时算不出来，请核对出发日期'

/** Shown for the balance milestone when no departure is chosen yet. */
const NOT_SET_NOTE = '出发日期未定'

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
    depositOnlyOn: null,
    balanceNote: null,
  }
}

/** The holiday_table_missing warning text for a set of missing years. */
function holidayTableWarning(missingYears: number[]): BookingWarning {
  const years = missingYears.join('、')
  return warn(
    'holiday_table_missing',
    `假日表缺失（${years} 年），到期日可能偏早`,
    false,
    null,
  )
}

/** The computed due date for one milestone kind, or null when unavailable. */
function computedDue(
  dates: DueDates | null,
  kind: MilestoneKind,
): string | null {
  if (dates === null) return null
  return kind === 'deposit' ? dates.depositDueOn : dates.balanceDueOn
}

/** The computed due date for one milestone, using the deposit-only fallback. */
function computedDueFromOutcome(
  due: DueOutcome,
  kind: MilestoneKind,
): string | null {
  if (kind === 'deposit') {
    return due.dates?.depositDueOn ?? due.depositOnlyOn
  }
  return due.dates?.balanceDueOn ?? null
}

/** The due note for one milestone, or null when a due date is available. */
function dueNoteFor(
  due: DueOutcome,
  kind: MilestoneKind,
  dueOn: string | null,
): string | null {
  if (dueOn !== null) return null
  if (kind === 'balance') return due.balanceNote ?? DUE_UNAVAILABLE_TEXT
  return DUE_UNAVAILABLE_TEXT
}

/** Build one milestone view row. */
function buildMilestoneView(
  row: MilestoneRow,
  due: DueOutcome,
  today: string,
): MilestoneView {
  const dueOn = row.dueOverrideOn ?? computedDueFromOutcome(due, row.kind)
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
    dueNote: dueNoteFor(due, row.kind, dueOn),
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
  const empty: DueOutcome = {
    dates: null,
    warnings: [],
    depositOnlyOn: null,
    balanceNote: null,
  }
  return rows.map((row) => ({
    ...buildMilestoneView(row, empty, today),
    dueNote: null,
  }))
}

/** Turn a due-date result into dates plus any warning it implies. */
function resolveDueDates(result: DueDatesResult): DueOutcome {
  if (result.state === 'ok') {
    return {
      dates: result.dates,
      warnings: [],
      depositOnlyOn: null,
      balanceNote: null,
    }
  }
  if (result.state === 'holiday_table_missing') {
    return {
      dates: result.provisional,
      warnings: [holidayTableWarning(result.missingYears)],
      depositOnlyOn: null,
      balanceNote: null,
    }
  }
  if (result.state === 'no_departure') {
    return {
      dates: null,
      warnings: [],
      depositOnlyOn: null,
      balanceNote: null,
    }
  }
  return dueUnavailable()
}

/** The deposit-only fallback outcome for a valid booking date. */
function depositOnlyOutcome(
  rule: TravelBookingRule,
  bookedOn: string,
  balanceNote: string,
): DueOutcome {
  const result = computeDepositDueOnly(rule, bookedOn)
  if (result.state === 'ok') {
    return {
      dates: null,
      warnings: [],
      depositOnlyOn: result.depositDueOn,
      balanceNote,
    }
  }
  if (result.state === 'holiday_table_missing') {
    return {
      dates: null,
      warnings: [holidayTableWarning(result.missingYears)],
      depositOnlyOn: result.depositDueOn,
      balanceNote,
    }
  }
  return dueUnavailable()
}

/** The outcome when no departure is chosen yet: deposit only, if possible. */
function noDepartureOutcome(
  input: BookingViewInput,
): DueOutcome {
  if (!isIsoDate(input.item.booking.bookedOn)) return dueUnavailable()
  return depositOnlyOutcome(
    input.rule,
    input.item.booking.bookedOn,
    NOT_SET_NOTE,
  )
}

/** The outcome when the full computation is unavailable for another reason. */
function unavailableWithFallback(
  input: BookingViewInput,
): DueOutcome {
  const fallback = isIsoDate(input.item.booking.bookedOn)
    ? depositOnlyOutcome(
        input.rule,
        input.item.booking.bookedOn,
        DUE_UNAVAILABLE_TEXT,
      )
    : dueUnavailable()
  return {
    ...fallback,
    warnings: [warn('due_unavailable', DUE_UNAVAILABLE_TEXT, false, null)],
  }
}

/** Compute due dates for an active booking, guarding invalid ISO input. */
function computeDueOutcome(
  input: BookingViewInput,
  effectiveDepartOn: string | null,
): DueOutcome {
  const { booking } = input.item
  if (effectiveDepartOn === null) {
    return noDepartureOutcome(input)
  }
  if (!isIsoDate(effectiveDepartOn) || !isIsoDate(booking.bookedOn)) {
    return unavailableWithFallback(input)
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
  if (result.state === 'invalid_input') {
    return unavailableWithFallback(input)
  }
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
        `团目录里已找不到这个出发日期（原为 ${booking.departureDepartOn ?? '（未定）'}），请点「改团/出发日期」重新选`,
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

/** The one plain-words line saying which balance lead applies and why. */
function leadNote(
  input: BookingViewInput,
  dates: DueDates | null,
): BookingWarning | null {
  const { rule } = input
  if (input.item.booking.isCruise) {
    const n = dates ? dates.leadDays : rule.balanceLeadDays.longOrCruise
    return warn('lead_cruise_note', `尾款按出发前 ${n} 天算（邮轮）`, false, null)
  }
  const n = dates ? dates.leadDays : rule.balanceLeadDays.standard
  if (dates !== null && dates.tier === 'long_or_cruise') {
    return warn(
      'cruise_not_ticked',
      `尾款按出发前 ${n} 天算（团期 ${rule.longTourMinDays} 天以上）`,
      false,
      null,
    )
  }
  return { ...warn('cruise_not_ticked', `尾款按出发前 ${n} 天算（没勾邮轮）`, false, null), defaultLead: true }
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
  const lead = leadNote(input, dates)
  if (lead !== null) out.push(lead)
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
    milestones.map((row) => buildMilestoneView(row, due, input.today)),
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
