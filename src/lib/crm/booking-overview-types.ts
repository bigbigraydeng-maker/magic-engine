/**
 * Types for the CRM 付款总览 (payment overview) page.
 *
 * Everything here counts ORDERS, never money: the booking tracker stores no amounts,
 * so no type in this file may carry one (design §1, §8.3). Types only, no runtime code.
 */

import type {
  BookingView,
  BookingWarningCode,
  BookingWithMilestones,
  MilestoneKind,
} from './booking-types'

/** A booking together with its staff-facing view (built once, reused by summary and list). */
export interface OverviewEntry {
  item: BookingWithMilestones
  view: BookingView
}

/**
 * departure      = a departure_id with a date (live, else the stored snapshot)
 * unknown_date   = a departure_id but no date at all (live and snapshot both missing)
 * undecided      = no departure_id: 「出发日期还没定」
 */
export type OverviewGroupKind = 'departure' | 'unknown_date' | 'undecided'

export interface OverviewGroup {
  /** The departure_id, or 'none' for the undecided group. Never a date. */
  key: string
  kind: OverviewGroupKind
  tourId: string | null
  tourName: string | null
  departureId: string | null
  departOn: string | null
  /** departOn is known and earlier than today (the 「已出发」 flag). */
  departed: boolean
  /** Active bookings in the group. */
  orders: number
  depositPaid: number
  balancePaid: number
  /** Both records exist and both are paid. Not shown as a column; used for cross-checks. */
  fullyPaid: number
  /** Orders with at least one unpaid item that is NOT marked quiet. */
  unsettled: number
  /** Of those, orders with at least one such item whose due date is before today. */
  unsettledOverdue: number
  /** Orders with at least one UNPAID item marked quiet. Not part of `unsettled`. */
  offlineHandled: number
  /** Earliest due date among unpaid, non-quiet items; null when none can be worked out. */
  nearestDueOn: string | null
  /** Unpaid items including quiet ones: decides whether a past group stays in the default view. */
  unpaidItems: number
  /** Catalog warnings seen in the group (departure_missing, tour_missing, departure_changed, ...). */
  warningCodes: BookingWarningCode[]
}

export interface OverviewTotals {
  orders: number
  depositPaid: number
  balancePaid: number
  unsettled: number
  unsettledOverdue: number
  offlineHandled: number
}

export interface OverviewNotes {
  /** Active orders with at least one unpaid quiet item (all groups, visible or not). */
  offlineHandledOrders: number
  /** Active orders with an unpaid, non-quiet item whose remind_after is after today. */
  snoozedOrders: number
  cancelledOrders: number
}

export interface OverviewSummary {
  groups: OverviewGroup[]
  /** Sums over the groups in `groups` (the visible ones). */
  totals: OverviewTotals
  /** Past groups that are fully paid and were left out of the default view. */
  hiddenGroupCount: number
  notes: OverviewNotes
}

/** 订单清单 状态筛选: 全部 / 未收齐 / 已收齐 / 已取消. */
export type OverviewStatusFilter = 'all' | 'unsettled' | 'settled' | 'cancelled'

export interface OverviewListQuery {
  /** undefined = any departure, null = orders with no departure chosen, string = that departure_id. */
  departureId?: string | null
  tourId?: string
  status: OverviewStatusFilter
  page: number
}

export interface OverviewMilestoneCell {
  kind: MilestoneKind
  label: string
  state: 'unpaid' | 'paid'
  paidOn: string | null
  dueOn: string | null
  dueNote: string | null
  overdue: boolean
  quiet: boolean
}

export interface OverviewListRow {
  bookingId: string
  contactId: string
  contactName: string | null
  tourId: string
  tourName: string | null
  departureId: string | null
  departOn: string | null
  status: 'active' | 'cancelled'
  deposit: OverviewMilestoneCell | null
  balance: OverviewMilestoneCell | null
  /** The latest nudged_on over the booking's items (最近催过). */
  lastNudgedOn: string | null
  warnings: Array<{ code: BookingWarningCode; text: string }>
  note: string | null
}

export interface OverviewListPage {
  rows: OverviewListRow[]
  page: number
  pageCount: number
  total: number
}

export const OVERVIEW_PAGE_SIZE = 50
/** Same ceiling the nudge readers use; reaching it makes fetchAll throw and the page refuse to render numbers. */
export const OVERVIEW_HARD_CAP = 20000
/** The paid-without-booking name list is capped at this many rows; the count is never capped. */
export const PAID_WITHOUT_BOOKING_ROW_CAP = 200
