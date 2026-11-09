/**
 * CRM 付款总览 (payment overview) — read-only data access.
 *
 * Four readers, all read-only, all tenant-scoped (every query filters by
 * client_id). The Supabase client is always passed in; this module never
 * imports a client. Row mappers and the tiny type guards live in
 * ./booking-store-reads and ./booking-types.
 *
 * Nothing here touches contact_touchpoints: the overview page counts orders,
 * not conversations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { toBookingRow, toMilestoneRow } from './booking-store-reads'
import { OVERVIEW_HARD_CAP, PAID_WITHOUT_BOOKING_ROW_CAP } from './booking-overview-types'
import type { BookingRow, MilestoneRow } from './booking-types'

const CHUNK_SIZE = 100

const BOOKING_COLUMNS =
  'id, contact_id, tour_id, departure_id, departure_depart_on, booked_on, party_size, is_cruise, status, cancel_note, note, created_at, updated_at'

const MILESTONE_COLUMNS =
  'id, booking_id, kind, state, paid_on, paid_source, due_override_on, due_override_depart_on, remind_after, nudged_on, quiet, updated_at'

// --- tiny private helpers -----------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
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

// --- bookings -----------------------------------------------------------------

/**
 * Every booking of the client, active AND cancelled (no status filter).
 *
 * A hard-cap breach makes fetchAll throw; that error is deliberately allowed to
 * propagate so the page refuses to render numbers rather than show half a book.
 */
export async function listBookingsForOverview(
  db: SupabaseClient,
  clientId: string,
): Promise<BookingRow[]> {
  const raw = await fetchAll(
    (from, to) =>
      db
        .from('crm_bookings')
        .select(BOOKING_COLUMNS)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    OVERVIEW_HARD_CAP,
  )
  const out: BookingRow[] = []
  for (const row of raw) {
    const booking = toBookingRow(row)
    // A row the mapper cannot read must fail the whole page, never vanish from the counts.
    if (booking === null) {
      throw new Error('unmappable booking row')
    }
    out.push(booking)
  }
  return out
}

// --- milestones ---------------------------------------------------------------

/**
 * Every milestone of the client: no state filter, no quiet filter. The overview
 * needs paid and unpaid, quiet and loud, to count orders correctly.
 */
export async function listMilestonesForClient(
  db: SupabaseClient,
  clientId: string,
): Promise<MilestoneRow[]> {
  const raw = await fetchAll(
    (from, to) =>
      db
        .from('crm_booking_milestones')
        .select(MILESTONE_COLUMNS)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    OVERVIEW_HARD_CAP,
  )
  const out: MilestoneRow[] = []
  for (const row of raw) {
    const milestone = toMilestoneRow(row)
    if (milestone === null) {
      throw new Error('unmappable milestone row')
    }
    out.push(milestone)
  }
  return out
}

// --- contact names ------------------------------------------------------------

/**
 * id -> display_name for the given contacts. Reads the contacts table only —
 * never contact_touchpoints, never any column beyond id and display_name.
 */
export async function listContactNamesForClient(
  db: SupabaseClient,
  clientId: string,
  ids: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const uniqueIds = unique(ids)
  if (uniqueIds.length === 0) {
    return out
  }
  for (const group of chunk(uniqueIds, CHUNK_SIZE)) {
    const res = await db
      .from('contacts')
      .select('id, display_name')
      .eq('client_id', clientId)
      .in('id', group)
    if (res.error) {
      throw new Error(res.error.message)
    }
    for (const raw of rowsOf(res.data)) {
      if (!isRecord(raw)) {
        continue
      }
      const id = str(raw.id)
      if (id === null) {
        continue
      }
      out.set(id, str(raw.display_name))
    }
  }
  return out
}

// --- paid-stage contacts with no booking --------------------------------------

/**
 * The three stages that mean money has changed hands.
 *
 *   deposit_paid   = 已付定金 — written by the stage advance in
 *                    agent-customer-stages and by the payment email detector.
 *   paid_full      = 已付全款 — written by
 *                    src/lib/conversions/payment-email-detect-run.ts and
 *                    src/lib/crm/stage-from-conversation.ts.
 *   traveling_soon = 即将出行 — written by src/lib/crm/stage-from-conversation.ts.
 *
 * These are listed explicitly rather than derived from agent-customer-stages.ts:
 * that file only knows deposit_paid, so deriving from it would count 16 instead
 * of 29 on the live data.
 */
export const PAID_STAGES = ['deposit_paid', 'paid_full', 'traveling_soon'] as const

/**
 * Contacts sitting in a paid stage with NO row at all in crm_bookings.
 *
 * A cancelled booking still counts as a booking, so those contacts are excluded.
 * `total` is the full count and is never capped; `rows` is the first
 * PAID_WITHOUT_BOOKING_ROW_CAP of them, sorted by display_name then id.
 */
export async function listPaidStageContactsWithoutBooking(
  db: SupabaseClient,
  clientId: string,
  /** The bookings already loaded by listBookingsForOverview (active AND cancelled): one source, so the figures cannot disagree. */
  bookings: BookingRow[],
): Promise<{ total: number; rows: Array<{ id: string; name: string | null; stage: string }> }> {
  const contactRows = await fetchAll(
    (from, to) =>
      db
        .from('contacts')
        .select('id, display_name, stage')
        .eq('client_id', clientId)
        .in('stage', [...PAID_STAGES])
        .order('id', { ascending: true })
        .range(from, to),
    OVERVIEW_HARD_CAP,
  )

  const booked = new Set<string>(bookings.map((b) => b.contactId))

  const missing: Array<{ id: string; name: string | null; stage: string }> = []
  for (const raw of contactRows) {
    if (!isRecord(raw)) {
      continue
    }
    const id = str(raw.id)
    const stage = str(raw.stage)
    if (id === null || stage === null || booked.has(id)) {
      continue
    }
    missing.push({ id, name: str(raw.display_name), stage })
  }

  missing.sort((a, b) => {
    const an = a.name ?? ''
    const bn = b.name ?? ''
    if (an !== bn) {
      return an < bn ? -1 : 1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return { total: missing.length, rows: missing.slice(0, PAID_WITHOUT_BOOKING_ROW_CAP) }
}
