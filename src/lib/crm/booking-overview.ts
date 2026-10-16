/**
 * Pure aggregation for the CRM 付款总览 (payment overview) page.
 *
 * No I/O, no clock (today is a parameter), no Supabase. Every due date and
 * overdue flag comes from the BookingView built by buildBookingView; this
 * module never recomputes them. Everything here counts ORDERS, never money.
 */

import type {
  BookingView,
  BookingWarningCode,
  BookingWithMilestones,
  CatalogFacts,
  MilestoneView,
} from './booking-types'
import type {
  OverviewEntry,
  OverviewGroup,
  OverviewGroupKind,
  OverviewNotes,
  OverviewSummary,
  OverviewTotals,
} from './booking-overview-types'
import type { TravelBookingRule } from './industry/travel-booking-rule'
import { buildBookingView } from './booking-view'

/** The group key used for bookings with no departure chosen. */
const UNDECIDED_KEY = 'none'

/** The catalog warning codes the overview surfaces on a group. */
const GROUP_WARNING_CODES: BookingWarningCode[] = [
  'departure_missing',
  'tour_missing',
  'departure_changed',
  'departure_cancelled',
]

/** Build the staff-facing view of every booking, reusing buildBookingView. */
export function buildOverviewEntries(
  items: BookingWithMilestones[],
  facts: CatalogFacts,
  rule: TravelBookingRule,
  today: string,
): OverviewEntry[] {
  return items.map((item) => ({
    item,
    view: buildBookingView({ item, facts, rule, today }),
  }))
}

/** True when the booking is active and has an unpaid, non-quiet item. */
export function isUnsettled(view: BookingView): boolean {
  if (view.status !== 'active') return false
  return view.milestones.some((m) => m.state === 'unpaid' && !m.quiet)
}

/** True when the booking is active and both milestones exist and are paid. */
export function isFullyPaid(view: BookingView): boolean {
  if (view.status !== 'active') return false
  const deposit = view.milestones.find((m) => m.kind === 'deposit')
  const balance = view.milestones.find((m) => m.kind === 'balance')
  return (
    deposit !== undefined &&
    balance !== undefined &&
    deposit.state === 'paid' &&
    balance.state === 'paid'
  )
}

/** True when the booking is active, has no open item, is not fully paid, and has an unpaid quiet item. */
export function isOfflineOnly(view: BookingView): boolean {
  if (view.status !== 'active') return false
  if (isUnsettled(view) || isFullyPaid(view)) return false
  return view.milestones.some(isQuietItem)
}

/** A fresh, empty group for the given key and kind. */
function emptyGroup(
  key: string,
  kind: OverviewGroupKind,
  tourId: string | null,
  tourName: string | null,
  departureId: string | null,
): OverviewGroup {
  return {
    key,
    kind,
    tourId,
    tourName,
    departureId,
    departOn: null,
    departed: false,
    orders: 0,
    partySize: 0,
    partySizeMissing: 0,
    depositPaid: 0,
    balancePaid: 0,
    fullyPaid: 0,
    unsettled: 0,
    unsettledOverdue: 0,
    offlineHandled: 0,
    nearestDueOn: null,
    unpaidItems: 0,
    openItems: 0,
    dateAmbiguous: false,
    warningCodes: [],
  }
}

/** The group key for a view: the departure_id, or 'none' when undecided. */
function groupKeyOf(view: BookingView): string {
  return view.departureId ?? UNDECIDED_KEY
}

/** The smallest non-null date among two candidates. */
function minDate(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a < b ? a : b
}

/** True when the milestone is unpaid and not marked quiet. */
function isOpenItem(m: MilestoneView): boolean {
  return m.state === 'unpaid' && !m.quiet
}

/** True when the milestone is unpaid and marked quiet. */
function isQuietItem(m: MilestoneView): boolean {
  return m.state === 'unpaid' && m.quiet
}

/** True when the milestone is paid. */
function isPaid(m: MilestoneView): boolean {
  return m.state === 'paid'
}

/** The smallest non-null dueOn among the booking's open items. */
function nearestOpenDue(view: BookingView): string | null {
  let best: string | null = null
  for (const m of view.milestones) {
    if (!isOpenItem(m)) continue
    best = minDate(best, m.dueOn)
  }
  return best
}

/** The group warning codes present in a view, filtered to the surfaced set. */
function groupWarnings(view: BookingView): BookingWarningCode[] {
  const out: BookingWarningCode[] = []
  for (const w of view.warnings) {
    if (GROUP_WARNING_CODES.includes(w.code)) out.push(w.code)
  }
  return out
}

/** Merge new warning codes into a group's sorted, de-duplicated list. */
function mergeWarnings(
  existing: BookingWarningCode[],
  incoming: BookingWarningCode[],
): BookingWarningCode[] {
  const set = new Set<BookingWarningCode>(existing)
  for (const code of incoming) set.add(code)
  return [...set].sort()
}

/** Fold one active booking's counters into its group. */
function addBookingToGroup(group: OverviewGroup, view: BookingView): void {
  group.orders += 1
  if (view.partySize === null) group.partySizeMissing += 1
  else group.partySize += view.partySize
  if (view.milestones.some((m) => m.kind === 'deposit' && isPaid(m))) {
    group.depositPaid += 1
  }
  if (view.milestones.some((m) => m.kind === 'balance' && isPaid(m))) {
    group.balancePaid += 1
  }
  if (isFullyPaid(view)) group.fullyPaid += 1
  if (isUnsettled(view)) group.unsettled += 1
  if (view.milestones.some((m) => isOpenItem(m) && m.overdue)) {
    group.unsettledOverdue += 1
  }
  if (view.milestones.some(isQuietItem)) group.offlineHandled += 1
  group.nearestDueOn = minDate(group.nearestDueOn, nearestOpenDue(view))
  group.unpaidItems += view.milestones.filter(
    (m) => m.state === 'unpaid',
  ).length
  group.openItems += view.milestones.filter(isOpenItem).length
  group.warningCodes = mergeWarnings(group.warningCodes, groupWarnings(view))
}

/** The group kind for a departure group: 'departure' when a date is known. */
function departureKind(departOn: string | null): OverviewGroupKind {
  return departOn === null ? 'unknown_date' : 'departure'
}

/** Create the group a view belongs to, seeded from that view. */
function newGroupFor(view: BookingView): OverviewGroup {
  if (view.departureId === null) {
    return emptyGroup(UNDECIDED_KEY, 'undecided', null, null, null)
  }
  return emptyGroup(
    view.departureId,
    departureKind(view.departOn),
    view.tourId,
    view.tourName,
    view.departureId,
  )
}

/** Fold one active view into the group map, creating the group if needed. */
function foldView(
  groups: Map<string, OverviewGroup>,
  view: BookingView,
): void {
  const key = groupKeyOf(view)
  const group = groups.get(key) ?? newGroupFor(view)
  if (view.departOn !== null && group.departOn !== null && view.departOn !== group.departOn) {
    group.dateAmbiguous = true
  }
  group.departOn = minDate(group.departOn, view.departOn)
  if (group.kind !== 'undecided') group.kind = departureKind(group.departOn)
  addBookingToGroup(group, view)
  groups.set(key, group)
}

/** Set the departed flag on every group from its departOn and today. */
function markDeparted(groups: OverviewGroup[], today: string): void {
  for (const group of groups) {
    // Disagreeing stored dates are not a fact: never call such a group departed (it stays visible).
    group.departed = !group.dateAmbiguous && group.departOn !== null && group.departOn < today
  }
}

/** Order groups: departures by date, then unknown_date, then undecided. */
function compareGroups(a: OverviewGroup, b: OverviewGroup): number {
  const rank = (g: OverviewGroup): number => {
    if (g.kind === 'departure') return 0
    if (g.kind === 'unknown_date') return 1
    return 2
  }
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (a.kind === 'departure' && b.kind === 'departure') {
    const da = a.departOn ?? ''
    const db = b.departOn ?? ''
    if (da !== db) return da < db ? -1 : 1
    const na = a.tourName ?? '\uffff'
    const nb = b.tourName ?? '\uffff'
    if (na !== nb) return na < nb ? -1 : 1
  }
  if (a.key === b.key) return 0
  return a.key < b.key ? -1 : 1
}

/** True when a group is past (or date-unknown) and has nothing OPEN to collect (offline-handled items do not count). */
function isHiddenGroup(group: OverviewGroup): boolean {
  if (group.openItems > 0) return false
  if (group.kind === 'undecided') return false
  if (group.kind === 'unknown_date') return true
  return group.departed
}

interface HiddenSplit {
  visible: OverviewGroup[]
  hiddenGroupCount: number
  hiddenOrders: number
  hiddenOfflineOnlyGroups: number
}

/** Split groups into the visible set and the hidden counts. */
function filterVisible(
  groups: OverviewGroup[],
  includePastPaid: boolean,
): HiddenSplit {
  if (includePastPaid) {
    return { visible: groups, hiddenGroupCount: 0, hiddenOrders: 0, hiddenOfflineOnlyGroups: 0 }
  }
  const out: HiddenSplit = { visible: [], hiddenGroupCount: 0, hiddenOrders: 0, hiddenOfflineOnlyGroups: 0 }
  for (const group of groups) {
    if (!isHiddenGroup(group)) {
      out.visible.push(group)
      continue
    }
    out.hiddenGroupCount += 1
    out.hiddenOrders += group.orders
    if (group.unpaidItems > 0) out.hiddenOfflineOnlyGroups += 1
  }
  return out
}

/** Sum the numeric columns over the visible groups. */
function sumTotals(groups: OverviewGroup[]): OverviewTotals {
  const totals: OverviewTotals = {
    orders: 0,
    partySize: 0,
    partySizeMissing: 0,
    depositPaid: 0,
    balancePaid: 0,
    unsettled: 0,
    unsettledOverdue: 0,
    offlineHandled: 0,
  }
  for (const g of groups) {
    totals.orders += g.orders
    totals.partySize += g.partySize
    totals.partySizeMissing += g.partySizeMissing
    totals.depositPaid += g.depositPaid
    totals.balancePaid += g.balancePaid
    totals.unsettled += g.unsettled
    totals.unsettledOverdue += g.unsettledOverdue
    totals.offlineHandled += g.offlineHandled
  }
  return totals
}

/** True when the booking has an unpaid, non-quiet item that is snoozed. */
function isSnoozed(view: BookingView, today: string): boolean {
  return view.milestones.some(
    (m) =>
      isOpenItem(m) && m.remindAfter !== null && m.remindAfter > today,
  )
}

/** Count the cross-group notes over all entries. */
function countNotes(entries: OverviewEntry[], today: string): OverviewNotes {
  let offlineHandledOrders = 0
  let snoozedOrders = 0
  let cancelledOrders = 0
  for (const { view } of entries) {
    if (view.status === 'cancelled') {
      cancelledOrders += 1
      continue
    }
    if (view.milestones.some(isQuietItem)) offlineHandledOrders += 1
    if (isSnoozed(view, today)) snoozedOrders += 1
  }
  return { offlineHandledOrders, snoozedOrders, cancelledOrders }
}

/** Build the ordered, visible groups plus the hidden count. */
function buildGroups(
  entries: OverviewEntry[],
  today: string,
  includePastPaid: boolean,
): HiddenSplit {
  const map = new Map<string, OverviewGroup>()
  for (const { view } of entries) {
    if (view.status !== 'active') continue
    foldView(map, view)
  }
  const all = [...map.values()]
  markDeparted(all, today)
  all.sort(compareGroups)
  return filterVisible(all, includePastPaid)
}

/** Aggregate the overview: groups, totals and cross-group notes. */
export function summariseOverview(
  entries: OverviewEntry[],
  today: string,
  includePastPaid: boolean,
): OverviewSummary {
  const split = buildGroups(entries, today, includePastPaid)
  return {
    groups: split.visible,
    totals: sumTotals(split.visible),
    hiddenGroupCount: split.hiddenGroupCount,
    hiddenOrders: split.hiddenOrders,
    hiddenOfflineOnlyGroups: split.hiddenOfflineOnlyGroups,
    notes: countNotes(entries, today),
  }
}
