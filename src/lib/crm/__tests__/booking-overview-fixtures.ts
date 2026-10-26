/**
 * Fixture builders for the 付款总览 (payment overview) tests.
 *
 * NOT a test file. One spec describes one booking; helpers turn specs into
 * camelCase domain items (pure tests) or snake_case table rows (fake-db tests).
 * Due dates are pinned with `due` (dueOverrideOn) so no test depends on the holiday table,
 * except the few that deliberately exercise the deposit-only fallback.
 */

import type {
  BookingRow,
  BookingWithMilestones,
  CatalogFacts,
  MilestoneKind,
  MilestoneRow,
} from '../booking-types'
import type { OverviewEntry } from '../booking-overview-types'
import { buildOverviewEntries } from '../booking-overview'
import type { Row } from './booking-fake-db'
import { CLIENT_A, TEST_RULE, TOUR_A1, UPDATED_AT, bookingRow, milestoneRow } from './booking-fixtures'

export const TODAY = '2026-10-12'

export function pad(n: number): string {
  return String(n).padStart(12, '0')
}
export const bid = (n: number): string => `30000000-0000-4000-8000-${pad(n)}`
export const cid = (n: number): string => `c1a1a1a1-0000-4000-8000-${pad(n)}`
export const depId = (n: number): string => `20000000-0000-4000-8000-${pad(n)}`
export const tourId = (n: number): string => `10000000-0000-4000-8000-${pad(n)}`

export interface MsSpec {
  state?: 'paid' | 'unpaid'
  quiet?: boolean
  /** Manual due date (due_override_on). Pinning it keeps tests off the holiday table. */
  due?: string | null
  remindAfter?: string | null
  nudgedOn?: string | null
}

export interface BookingSpec {
  n: number
  departureId?: string | null
  /** The snapshot stored on the booking (departure_depart_on). */
  snapshot?: string | null
  tourId?: string
  bookedOn?: string
  status?: 'active' | 'cancelled'
  contactN?: number
  partySize?: number | null
  deposit?: MsSpec | null
  balance?: MsSpec | null
  note?: string | null
}

const DEFAULT_DEP = depId(1)

function milestoneOf(spec: BookingSpec, kind: MilestoneKind, ms: MsSpec): MilestoneRow {
  const state = ms.state ?? 'unpaid'
  const due = ms.due ?? null
  return {
    id: `40000000-0000-4000-8000-${kind === 'deposit' ? 'd' : 'e'}${pad(spec.n).slice(1)}`,
    bookingId: bid(spec.n),
    kind,
    state,
    paidOn: state === 'paid' ? '2026-09-30' : null,
    paidSource: state === 'paid' ? 'staff' : null,
    dueOverrideOn: due,
    dueOverrideDepartOn: due === null ? null : (spec.snapshot ?? null),
    remindAfter: ms.remindAfter ?? null,
    nudgedOn: ms.nudgedOn ?? null,
    quiet: ms.quiet ?? false,
    updatedAt: UPDATED_AT,
  }
}

export function bookingOf(spec: BookingSpec): BookingRow {
  return {
    id: bid(spec.n),
    contactId: cid(spec.contactN ?? spec.n),
    tourId: spec.tourId ?? TOUR_A1,
    departureId: spec.departureId === undefined ? DEFAULT_DEP : spec.departureId,
    departureDepartOn: spec.snapshot === undefined ? '2027-03-12' : spec.snapshot,
    bookedOn: spec.bookedOn ?? '2026-09-01',
    partySize: spec.partySize === undefined ? null : spec.partySize,
    isCruise: false,
    status: spec.status ?? 'active',
    cancelNote: spec.status === 'cancelled' ? 'changed plans' : null,
    note: spec.note ?? null,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
  }
}

/** Both milestones are created by default (deposit and balance, unpaid). Pass `null` to omit one. */
export function itemOf(spec: BookingSpec): BookingWithMilestones {
  const milestones: MilestoneRow[] = []
  if (spec.deposit !== null) milestones.push(milestoneOf(spec, 'deposit', spec.deposit ?? {}))
  if (spec.balance !== null) milestones.push(milestoneOf(spec, 'balance', spec.balance ?? {}))
  return { booking: bookingOf(spec), milestones }
}

export interface DepFact {
  id: string
  tourId?: string
  departOn: string
  /** A return date before departOn makes the due-date computation unavailable (fallback path). */
  returnOn?: string | null
  status?: string
}

export function factsOf(deps: DepFact[], tourIds: string[] = [TOUR_A1]): CatalogFacts {
  const tours = new Map(tourIds.map((id) => [id, { id, name: `Tour ${id.slice(-2)}`, durationText: '10 Days 9 Nights' }]))
  const departures = new Map(
    deps.map((d) => [
      d.id,
      { id: d.id, tourId: d.tourId ?? TOUR_A1, departOn: d.departOn, returnOn: d.returnOn ?? null, status: d.status ?? 'open' },
    ]),
  )
  return { tours, departures }
}

export function entriesOf(specs: BookingSpec[], facts: CatalogFacts, today: string = TODAY): OverviewEntry[] {
  return buildOverviewEntries(specs.map(itemOf), facts, TEST_RULE, today)
}

// --- table rows (fake db) -----------------------------------------------------

export function rowsOf(spec: BookingSpec, clientId: string = CLIENT_A): Row[] {
  const item = itemOf(spec)
  const booking = bookingRow({
    id: item.booking.id,
    client_id: clientId,
    contact_id: item.booking.contactId,
    tour_id: item.booking.tourId,
    departure_id: item.booking.departureId,
    departure_depart_on: item.booking.departureDepartOn,
    booked_on: item.booking.bookedOn,
    status: item.booking.status,
    cancel_note: item.booking.cancelNote,
    note: item.booking.note,
  })
  const ms = item.milestones.map((m) =>
    milestoneRow({
      id: m.id,
      booking_id: m.bookingId,
      client_id: clientId,
      kind: m.kind,
      state: m.state,
      paid_on: m.paidOn,
      paid_source: m.paidSource,
      due_override_on: m.dueOverrideOn,
      due_override_depart_on: m.dueOverrideDepartOn,
      remind_after: m.remindAfter,
      nudged_on: m.nudgedOn,
      quiet: m.quiet,
    }),
  )
  return [booking, ...ms]
}
