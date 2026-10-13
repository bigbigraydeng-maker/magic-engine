/**
 * Shared types and constants for the CRM booking payment tracker.
 *
 * Types only (plus a few tiny constants). No imports: this file is the leaf
 * of the booking module's dependency graph so both the store and the access
 * gate can depend on it without cycles.
 */

export type BookingCapability = 'view' | 'edit' | 'manage_members'
export type BookingRole = 'me_admin' | 'member'
export type MilestoneKind = 'deposit' | 'balance'
export type BookingStatus = 'active' | 'cancelled'
export type NudgeMode = 'nudged_today' | 'snooze' | 'quiet'

/** Internal rows (camelCase). They never include client_id or created_by. */
export interface BookingRow {
  id: string; contactId: string; tourId: string; departureId: string | null
  departureDepartOn: string | null   // snapshot of the catalog depart_on
  bookedOn: string; partySize: number | null; isCruise: boolean
  status: BookingStatus; cancelNote: string | null; note: string | null
  createdAt: string; updatedAt: string
}
export interface MilestoneRow {
  id: string; bookingId: string; kind: MilestoneKind
  state: 'unpaid' | 'paid'; paidOn: string | null; paidSource: 'staff' | 'email' | null
  dueOverrideOn: string | null; dueOverrideDepartOn: string | null
  remindAfter: string | null; nudgedOn: string | null; quiet: boolean; updatedAt: string
}
export interface BookingWithMilestones { booking: BookingRow; milestones: MilestoneRow[] }

export interface CatalogTourFacts { id: string; name: string; durationText: string | null }
export interface CatalogDepartureFacts { id: string; tourId: string; departOn: string; returnOn: string | null; status: string }
export interface CatalogFacts { tours: Map<string, CatalogTourFacts>; departures: Map<string, CatalogDepartureFacts> }

export type StoreErrorKind = 'stale' | 'invalid' | 'not_found' | 'forbidden' | 'duplicate' | 'inactive' | 'error'
export type StoreResult<T> = { ok: true; value: T } | { ok: false; kind: StoreErrorKind; code: string }

export type BookingWarningCode =
  | 'departure_changed' | 'departure_missing' | 'departure_cancelled' | 'departure_not_set'
  | 'holiday_table_missing' | 'tour_length_mismatch' | 'cruise_not_ticked' | 'override_stale'
  | 'lead_cruise_note' | 'tour_missing' | 'due_unavailable' | 'pay_in_full'
export interface BookingWarning {
  code: BookingWarningCode
  text: string                 // plain Chinese for the PM / staff
  needsConfirm: boolean        // true only for departure_changed (staff must press the confirm button)
  kind: MilestoneKind | null   // which milestone it is about, null = the whole booking
  defaultLead?: true           // the standard-lead-time note (nothing unusual); roll-up lists leave it out
}
export interface MilestoneView {
  kind: MilestoneKind
  label: string                // '定金' or '尾款'
  state: 'unpaid' | 'paid'
  paidOn: string | null
  autoByEmail: boolean         // paidSource === 'email'
  dueOn: string | null         // the manual override when set, else the computed date, else null
  dueNote: string | null       // plain Chinese note shown when no due date is available
  dueOverrideOn: string | null
  dueInDays: number | null     // dueOn minus NZ today (negative = overdue); null when dueOn is null
  overdue: boolean             // unpaid and dueOn < today
  remindAfter: string | null
  quiet: boolean
  updatedAt: string            // staff send this back as expectedUpdatedAt
}
export interface BookingView {
  id: string; tourId: string
  tourName: string | null      // null when the catalog no longer has the tour
  departureId: string | null
  departOn: string | null      // live catalog date, else the stored snapshot
  departureStatus: string | null
  bookedOn: string; partySize: number | null; isCruise: boolean
  status: BookingStatus; cancelNote: string | null; note: string | null
  updatedAt: string
  payInFull: boolean           // booked too close to departure: both dates merge into one
  milestones: MilestoneView[]
  warnings: BookingWarning[]
}

export type NudgeBucket = 'overdue' | 'within_3' | 'within_14' | 'undated'
export interface NudgeRow {
  bookingId: string; contactId: string; contactName: string | null
  tourName: string | null
  departOn: string | null      // live catalog date, else the stored snapshot (same as BookingView.departOn)
  kind: MilestoneKind; label: string
  dueOn: string | null; dueInDays: number | null; bucket: NudgeBucket
  note: string | null
  milestoneUpdatedAt: string
  warningCodes: BookingWarningCode[]
}
export interface NudgeList {
  rows: NudgeRow[]             // at most `limit` rows, ordered overdue, then within_3, then within_14
  more: boolean                // more rows exist beyond `limit`
  collapsedOverdue: number     // bookings whose tightest item is overdue by more than 14 days (not listed)
  collapsedRows: NudgeRow[]    // those same bookings as rows (most overdue first, at most 50)
  truncated: boolean           // the 500-candidate hard cap was hit
}
export interface BookingMember { email: string; grantedBy: string; createdAt: string }

/** Shown to staff in plain words. */
export const MILESTONE_LABELS: Record<MilestoneKind, string> = { deposit: '定金', balance: '尾款' }
export const NUDGE_OVERDUE_COLLAPSE_DAYS = 14
export const NUDGE_SOON_DAYS = 3
export const NUDGE_WINDOW_DAYS = 14
export const NUDGE_CANDIDATE_CAP = 500
