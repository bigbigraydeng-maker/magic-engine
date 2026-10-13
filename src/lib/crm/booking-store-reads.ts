/**
 * CRM booking payment tracker — read/write data access for bookings, milestones,
 * catalog facts, nudge candidates and booking members.
 *
 * Every query filters by client_id (tenant rule). The Supabase client is always
 * passed in; this module never imports a client. Types live in ./booking-types.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { loadBookingDepartureFacts, loadBookingTourFacts } from '@/lib/tour-catalog/booking-facts'
import { isDoNotContact } from './dnc'
import type { DncTouch } from './dnc'
import type {
  BookingMember,
  BookingRow,
  BookingStatus,
  BookingWithMilestones,
  CatalogFacts,
  MilestoneKind,
  MilestoneRow,
} from './booking-types'

const CHUNK_SIZE = 100

// --- tiny private type guards -------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function bool(value: unknown): boolean {
  return value === true
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rowsOf(data: unknown): unknown[] {
  return Array.isArray(data) ? data : []
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids))
}

// --- row mappers --------------------------------------------------------------

function isBookingStatus(value: string): value is BookingStatus {
  return value === 'active' || value === 'cancelled'
}

function isMilestoneKind(value: string): value is MilestoneKind {
  return value === 'deposit' || value === 'balance'
}

export function toBookingRow(raw: unknown): BookingRow | null {
  if (!isRecord(raw)) {
    return null
  }
  const id = str(raw.id)
  const contactId = str(raw.contact_id)
  const tourId = str(raw.tour_id)
  const bookedOn = str(raw.booked_on)
  const status = str(raw.status)
  const updatedAt = str(raw.updated_at)
  if (id === null || contactId === null || tourId === null) {
    return null
  }
  if (bookedOn === null || status === null || updatedAt === null) {
    return null
  }
  if (!isBookingStatus(status)) {
    return null
  }
  return {
    id,
    contactId,
    tourId,
    departureId: nullableStr(raw.departure_id),
    departureDepartOn: nullableStr(raw.departure_depart_on),
    bookedOn,
    partySize: nullableNum(raw.party_size),
    isCruise: bool(raw.is_cruise),
    status,
    cancelNote: nullableStr(raw.cancel_note),
    note: nullableStr(raw.note),
    createdAt: str(raw.created_at) ?? '',
    updatedAt,
  }
}

export function toMilestoneRow(raw: unknown): MilestoneRow | null {
  if (!isRecord(raw)) {
    return null
  }
  const id = str(raw.id)
  const bookingId = str(raw.booking_id)
  const kind = str(raw.kind)
  const state = str(raw.state)
  const updatedAt = str(raw.updated_at)
  if (id === null || bookingId === null || updatedAt === null) {
    return null
  }
  if (kind === null || !isMilestoneKind(kind)) {
    return null
  }
  if (state !== 'unpaid' && state !== 'paid') {
    return null
  }
  const paidSource = str(raw.paid_source)
  return {
    id,
    bookingId,
    kind,
    state,
    paidOn: nullableStr(raw.paid_on),
    paidSource: paidSource === 'staff' || paidSource === 'email' ? paidSource : null,
    dueOverrideOn: nullableStr(raw.due_override_on),
    dueOverrideDepartOn: nullableStr(raw.due_override_depart_on),
    remindAfter: nullableStr(raw.remind_after),
    nudgedOn: nullableStr(raw.nudged_on),
    quiet: bool(raw.quiet),
    updatedAt,
  }
}

// --- contacts -----------------------------------------------------------------

export async function contactBelongsToClient(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<boolean> {
  const res = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (res.error) {
    throw new Error(res.error.message)
  }
  return res.data !== null && res.data !== undefined
}

// --- bookings + milestones ----------------------------------------------------

function sortMilestones(milestones: MilestoneRow[]): MilestoneRow[] {
  const order: Record<MilestoneKind, number> = { deposit: 0, balance: 1 }
  return [...milestones].sort((a, b) => order[a.kind] - order[b.kind])
}

export async function listBookingsForContact(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<BookingWithMilestones[]> {
  const res = await db
    .from('crm_bookings')
    .select(
      'id, contact_id, tour_id, departure_id, departure_depart_on, booked_on, party_size, is_cruise, status, cancel_note, note, created_at, updated_at',
    )
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
  if (res.error) {
    throw new Error(res.error.message)
  }

  const bookings: BookingRow[] = []
  for (const raw of rowsOf(res.data)) {
    const booking = toBookingRow(raw)
    if (booking !== null) {
      bookings.push(booking)
    }
  }
  if (bookings.length === 0) {
    return []
  }

  const milestones = await listMilestonesForBookings(
    db,
    clientId,
    bookings.map((booking) => booking.id),
  )
  const byBooking = new Map<string, MilestoneRow[]>()
  for (const milestone of milestones) {
    const list = byBooking.get(milestone.bookingId)
    if (list === undefined) {
      byBooking.set(milestone.bookingId, [milestone])
    } else {
      list.push(milestone)
    }
  }

  return bookings.map((booking) => ({
    booking,
    milestones: sortMilestones(byBooking.get(booking.id) ?? []),
  }))
}

export async function getBookingWithMilestones(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
): Promise<BookingWithMilestones | null> {
  const res = await db
    .from('crm_bookings')
    .select(
      'id, contact_id, tour_id, departure_id, departure_depart_on, booked_on, party_size, is_cruise, status, cancel_note, note, created_at, updated_at',
    )
    .eq('id', bookingId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (res.error) {
    throw new Error(res.error.message)
  }
  if (res.data === null || res.data === undefined) {
    return null
  }
  const booking = toBookingRow(res.data)
  if (booking === null) {
    return null
  }
  const milestones = await listMilestonesForBookings(db, clientId, [booking.id])
  return { booking, milestones: sortMilestones(milestones) }
}

export async function listMilestonesForBookings(
  db: SupabaseClient,
  clientId: string,
  bookingIds: string[],
): Promise<MilestoneRow[]> {
  const ids = unique(bookingIds)
  if (ids.length === 0) {
    return []
  }
  const out: MilestoneRow[] = []
  for (const group of chunk(ids, CHUNK_SIZE)) {
    const res = await db
      .from('crm_booking_milestones')
      .select(
        'id, booking_id, kind, state, paid_on, paid_source, due_override_on, due_override_depart_on, remind_after, nudged_on, quiet, updated_at',
      )
      .eq('client_id', clientId)
      .in('booking_id', group)
    if (res.error) {
      throw new Error(res.error.message)
    }
    for (const raw of rowsOf(res.data)) {
      const milestone = toMilestoneRow(raw)
      if (milestone !== null) {
        out.push(milestone)
      }
    }
  }
  return out
}

// --- catalog facts ------------------------------------------------------------
// The tour/departure queries live in the catalog module
// (`@/lib/tour-catalog/booking-facts`) because only the catalog folder may name
// its tables.

export async function loadCatalogFacts(
  db: SupabaseClient,
  clientId: string,
  tourIds: string[],
  departureIds: string[],
): Promise<CatalogFacts> {
  const [tours, departures] = await Promise.all([
    loadBookingTourFacts(db, clientId, tourIds),
    loadBookingDepartureFacts(db, clientId, departureIds),
  ])
  return { tours, departures }
}

// --- nudge candidates ---------------------------------------------------------

const BOOKING_COLUMNS =
  'id, contact_id, tour_id, departure_id, departure_depart_on, booked_on, party_size, is_cruise, status, cancel_note, note, created_at, updated_at'

const MILESTONE_COLUMNS =
  'id, booking_id, kind, state, paid_on, paid_source, due_override_on, due_override_depart_on, remind_after, nudged_on, quiet, updated_at'

/** Every unpaid, non-quiet milestone for the client, paged past the 1000-row cap. */
export async function listUnpaidMilestonesForClient(
  db: SupabaseClient,
  clientId: string,
): Promise<MilestoneRow[]> {
  const raw = await fetchAll(
    (from, to) =>
      db
        .from('crm_booking_milestones')
        .select(MILESTONE_COLUMNS)
        .eq('client_id', clientId)
        .eq('state', 'unpaid')
        .eq('quiet', false)
        .order('id', { ascending: true })
        .range(from, to),
    20000,
  )
  const out: MilestoneRow[] = []
  for (const row of raw) {
    const milestone = toMilestoneRow(row)
    if (milestone !== null) {
      out.push(milestone)
    }
  }
  return out
}

/** Active bookings for the given ids, merged and sorted by bookedOn then id. */
export async function listActiveBookingsByIds(
  db: SupabaseClient,
  clientId: string,
  bookingIds: string[],
): Promise<BookingRow[]> {
  const ids = unique(bookingIds)
  if (ids.length === 0) {
    return []
  }
  const out: BookingRow[] = []
  for (const group of chunk(ids, CHUNK_SIZE)) {
    const res = await db
      .from('crm_bookings')
      .select(BOOKING_COLUMNS)
      .eq('client_id', clientId)
      .eq('status', 'active')
      .in('id', group)
      .order('booked_on', { ascending: true })
    if (res.error) {
      throw new Error(res.error.message)
    }
    for (const raw of rowsOf(res.data)) {
      const booking = toBookingRow(raw)
      if (booking !== null) {
        out.push(booking)
      }
    }
  }
  return out.sort((a, b) =>
    a.bookedOn === b.bookedOn
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.bookedOn < b.bookedOn
        ? -1
        : 1,
  )
}

/** DNC-relevant touchpoints per contact, newest first. */
async function listDncTouches(
  db: SupabaseClient,
  clientId: string,
  contactIds: string[],
): Promise<Map<string, DncTouch[]>> {
  const out = new Map<string, DncTouch[]>()
  const ids = unique(contactIds)
  if (ids.length === 0) {
    return out
  }
  for (const group of chunk(ids, CHUNK_SIZE)) {
    const raw = await fetchAll(
      (from, to) =>
        db
          .from('contact_touchpoints')
          .select('contact_id, occurred_at, metadata')
          .eq('client_id', clientId)
          .in('contact_id', group)
          .order('occurred_at', { ascending: false })
          .range(from, to),
      20000,
    )
    for (const row of raw) {
      if (!isRecord(row)) {
        continue
      }
      const contactId = str(row.contact_id)
      const occurredAt = str(row.occurred_at)
      if (contactId === null || occurredAt === null) {
        continue
      }
      const metadata = isRecord(row.metadata) ? row.metadata : {}
      const touch: DncTouch = {
        outcome: str(metadata.outcome),
        flagged: metadata.do_not_contact === true,
        occurredAt,
      }
      const list = out.get(contactId)
      if (list === undefined) {
        out.set(contactId, [touch])
      } else {
        list.push(touch)
      }
    }
  }
  return out
}

export async function listContactsForNudge(
  db: SupabaseClient,
  clientId: string,
  contactIds: string[],
): Promise<Map<string, { name: string | null; doNotContact: boolean }>> {
  const out = new Map<string, { name: string | null; doNotContact: boolean }>()
  const ids = unique(contactIds)
  if (ids.length === 0) {
    return out
  }
  // The touchpoint read and the contact read do not depend on each other.
  const [touches, rows] = await Promise.all([
    listDncTouches(db, clientId, ids),
    fetchContactRowsForNudge(db, clientId, ids),
  ])
  for (const raw of rows) {
    if (!isRecord(raw)) {
      continue
    }
    const id = str(raw.id)
    if (id === null) {
      continue
    }
    out.set(id, {
      name: nullableStr(raw.display_name),
      doNotContact: isDoNotContact(raw.do_not_contact === true, touches.get(id) ?? []),
    })
  }
  return out
}

async function fetchContactRowsForNudge(
  db: SupabaseClient,
  clientId: string,
  ids: string[],
): Promise<unknown[]> {
  const rows: unknown[] = []
  for (const group of chunk(ids, CHUNK_SIZE)) {
    const res = await db
      .from('contacts')
      .select('id, display_name, do_not_contact')
      .eq('client_id', clientId)
      .in('id', group)
    if (res.error) {
      throw new Error(res.error.message)
    }
    rows.push(...rowsOf(res.data))
  }
  return rows
}

// --- booking members ----------------------------------------------------------

export async function listBookingMembers(
  db: SupabaseClient,
  clientId: string,
): Promise<BookingMember[]> {
  const res = await db
    .from('crm_booking_members')
    .select('email, granted_by, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
  if (res.error) {
    throw new Error(res.error.message)
  }
  const members: BookingMember[] = []
  for (const raw of rowsOf(res.data)) {
    if (!isRecord(raw)) {
      continue
    }
    const email = str(raw.email)
    if (email === null) {
      continue
    }
    members.push({
      email: email.trim().toLowerCase(),
      grantedBy: str(raw.granted_by) ?? '',
      createdAt: str(raw.created_at) ?? '',
    })
  }
  return members
}

export async function addBookingMember(
  db: SupabaseClient,
  clientId: string,
  email: string,
  grantedBy: string,
): Promise<void> {
  const res = await db
    .from('crm_booking_members')
    .upsert(
      { client_id: clientId, email, granted_by: grantedBy },
      { onConflict: 'client_id,email', ignoreDuplicates: true },
    )
  if (res.error) {
    throw new Error(res.error.message)
  }
}

export async function removeBookingMember(
  db: SupabaseClient,
  clientId: string,
  email: string,
): Promise<void> {
  const res = await db
    .from('crm_booking_members')
    .delete()
    .eq('client_id', clientId)
    .eq('email', email)
  if (res.error) {
    throw new Error(res.error.message)
  }
}
