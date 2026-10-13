/**
 * Tour-catalog facts for the CRM booking tracker — the only place the tracker
 * may read tour-catalog data from.
 *
 * A booking must point at a real departure the staff picked, so the tracker
 * needs the tour name, the duration text and the departure's date and status.
 * These are operational facts, shown only to that client's own staff (ME admins
 * or the booking member list) — never to customers, the website, ads or email.
 *
 * Reading the published snapshot instead is not possible, because the tracker
 * must follow the CURRENT departure date (that is what powers the
 * 「出发日变了，请确认」 warning) and the catalog may not be published at all.
 *
 * This module therefore only ever selects columns from `tour_catalog_tours` and
 * `tour_catalog_departures`; it never inserts, updates, upserts, deletes or
 * calls an rpc, and it never imports from `@/lib/crm` (the boundary guard in
 * `__tests__/boundary.test.ts` pins all of that down).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'

export const BOOKING_FACT_TOUR_COLUMNS = 'id, name, duration_text'
export const BOOKING_FACT_DEPARTURE_COLUMNS = 'id, tour_id, depart_on, return_on, status'
export const BOOKING_OPTION_TOUR_COLUMNS = 'id, name, duration_text, is_active'
export const BOOKING_OPTION_DEPARTURE_COLUMNS = 'id, tour_id, depart_on, return_on, status'

export interface BookingTourFacts {
  id: string
  name: string
  durationText: string | null
}

export interface BookingDepartureFacts {
  id: string
  tourId: string
  departOn: string
  returnOn: string | null
  status: string
}

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

// --- fact reads (by id) -------------------------------------------------------

export async function loadBookingTourFacts(
  db: SupabaseClient,
  clientId: string,
  tourIds: string[],
): Promise<Map<string, BookingTourFacts>> {
  const tours = new Map<string, BookingTourFacts>()
  const uniqueTours = unique(tourIds)
  for (const group of chunk(uniqueTours, CHUNK_SIZE)) {
    const res = await db
      .from('tour_catalog_tours')
      .select(BOOKING_FACT_TOUR_COLUMNS)
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
      const name = str(raw.name)
      if (id === null || name === null) {
        continue
      }
      tours.set(id, { id, name, durationText: nullableStr(raw.duration_text) })
    }
  }
  return tours
}

export async function loadBookingDepartureFacts(
  db: SupabaseClient,
  clientId: string,
  departureIds: string[],
): Promise<Map<string, BookingDepartureFacts>> {
  const departures = new Map<string, BookingDepartureFacts>()
  const uniqueDepartures = unique(departureIds)
  for (const group of chunk(uniqueDepartures, CHUNK_SIZE)) {
    const res = await db
      .from('tour_catalog_departures')
      .select(BOOKING_FACT_DEPARTURE_COLUMNS)
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
      const tourId = str(raw.tour_id)
      const departOn = str(raw.depart_on)
      if (id === null || tourId === null || departOn === null) {
        continue
      }
      departures.set(id, {
        id,
        tourId,
        departOn,
        returnOn: nullableStr(raw.return_on),
        status: str(raw.status) ?? '',
      })
    }
  }
  return departures
}

// --- option reads (whole catalog, paged) --------------------------------------

async function loadOptionTours(
  db: SupabaseClient,
  clientId: string,
): Promise<BookingTourFacts[]> {
  const raw = await fetchAll(
    (from, to) =>
      db
        .from('tour_catalog_tours')
        .select(BOOKING_OPTION_TOUR_COLUMNS)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    20000,
  )
  const out: BookingTourFacts[] = []
  for (const row of raw) {
    if (!isRecord(row)) {
      continue
    }
    // Skip tours explicitly marked inactive.
    if (row.is_active === false) {
      continue
    }
    const id = str(row.id)
    const name = str(row.name)
    if (id === null || name === null) {
      continue
    }
    out.push({ id, name, durationText: nullableStr(row.duration_text) })
  }
  return out
}

async function loadOptionDepartures(
  db: SupabaseClient,
  clientId: string,
): Promise<BookingDepartureFacts[]> {
  const raw = await fetchAll(
    (from, to) =>
      db
        .from('tour_catalog_departures')
        .select(BOOKING_OPTION_DEPARTURE_COLUMNS)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    20000,
  )
  const out: BookingDepartureFacts[] = []
  for (const row of raw) {
    if (!isRecord(row)) {
      continue
    }
    const id = str(row.id)
    const tourId = str(row.tour_id)
    const departOn = str(row.depart_on)
    if (id === null || tourId === null || departOn === null) {
      continue
    }
    out.push({
      id,
      tourId,
      departOn,
      returnOn: nullableStr(row.return_on),
      status: str(row.status) ?? '',
    })
  }
  return out
}

/**
 * Load the whole bookable catalog for the client: every tour (minus inactive
 * ones) and every departure, each read paged past the 1000-row cap.
 *
 * The booking-side filters (today cut-off, bookable status, tour membership,
 * grouping and sorting) deliberately stay in the CRM module.
 */
export async function loadBookingTourOptions(
  db: SupabaseClient,
  clientId: string,
): Promise<{ tours: BookingTourFacts[]; departures: BookingDepartureFacts[] }> {
  const tours = await loadOptionTours(db, clientId)
  const departures = await loadOptionDepartures(db, clientId)
  return { tours, departures }
}
