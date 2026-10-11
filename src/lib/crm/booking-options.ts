/**
 * CRM booking options — read-only catalog of bookable tours and their future
 * departures, used to populate the booking form's tour/departure pickers.
 *
 * Every query filters by client_id (tenant rule). The Supabase client is always
 * passed in; this module never imports a client.
 *
 * Privacy: we deliberately select only the columns the picker needs. The
 * `internal` flag and any price columns on departures are never read here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'

export interface BookingOptionDeparture {
  id: string
  departOn: string
  returnOn: string | null
  status: string
}

export interface BookingOptionTour {
  id: string
  name: string
  durationText: string | null
  departures: BookingOptionDeparture[]
}

const TOUR_COLUMNS = 'id, name, duration_text, is_active'
const DEPARTURE_COLUMNS = 'id, tour_id, depart_on, return_on, status'

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

// --- tours --------------------------------------------------------------------

interface RawTour {
  id: string
  name: string
  durationText: string | null
}

function toRawTour(raw: unknown): RawTour | null {
  if (!isRecord(raw)) {
    return null
  }
  // Skip tours explicitly marked inactive.
  if (raw.is_active === false) {
    return null
  }
  const id = str(raw.id)
  const name = str(raw.name)
  if (id === null || name === null) {
    return null
  }
  return { id, name, durationText: nullableStr(raw.duration_text) }
}

async function loadTours(db: SupabaseClient, clientId: string): Promise<RawTour[]> {
  const raw = await fetchAll(
    (from, to) =>
      db
        .from('tour_catalog_tours')
        .select(TOUR_COLUMNS)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    20000,
  )
  const out: RawTour[] = []
  for (const row of raw) {
    const tour = toRawTour(row)
    if (tour !== null) {
      out.push(tour)
    }
  }
  return out
}

// --- departures ---------------------------------------------------------------

interface RawDeparture {
  id: string
  tourId: string
  departOn: string
  returnOn: string | null
  status: string
}

function isBookableStatus(status: string): boolean {
  return status !== 'cancelled' && status !== 'closed'
}

function toRawDeparture(raw: unknown, today: string, tourIds: Set<string>): RawDeparture | null {
  if (!isRecord(raw)) {
    return null
  }
  const id = str(raw.id)
  const tourId = str(raw.tour_id)
  const departOn = str(raw.depart_on)
  if (id === null || tourId === null || departOn === null) {
    return null
  }
  if (!tourIds.has(tourId)) {
    return null
  }
  if (departOn < today) {
    return null
  }
  const status = str(raw.status) ?? ''
  if (!isBookableStatus(status)) {
    return null
  }
  return { id, tourId, departOn, returnOn: nullableStr(raw.return_on), status }
}

async function loadDepartures(
  db: SupabaseClient,
  clientId: string,
  today: string,
  tourIds: Set<string>,
): Promise<RawDeparture[]> {
  const raw = await fetchAll(
    (from, to) =>
      db
        .from('tour_catalog_departures')
        .select(DEPARTURE_COLUMNS)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    20000,
  )
  const out: RawDeparture[] = []
  for (const row of raw) {
    const departure = toRawDeparture(row, today, tourIds)
    if (departure !== null) {
      out.push(departure)
    }
  }
  return out
}

// --- assembly -----------------------------------------------------------------

function groupByTour(departures: RawDeparture[]): Map<string, BookingOptionDeparture[]> {
  const byTour = new Map<string, BookingOptionDeparture[]>()
  for (const departure of departures) {
    const option: BookingOptionDeparture = {
      id: departure.id,
      departOn: departure.departOn,
      returnOn: departure.returnOn,
      status: departure.status,
    }
    const list = byTour.get(departure.tourId)
    if (list === undefined) {
      byTour.set(departure.tourId, [option])
    } else {
      list.push(option)
    }
  }
  for (const list of byTour.values()) {
    list.sort((a, b) => (a.departOn < b.departOn ? -1 : a.departOn > b.departOn ? 1 : 0))
  }
  return byTour
}

/**
 * Load every bookable tour for the client, each with its future departures.
 *
 * @param today ISO date (YYYY-MM-DD); departures before it are dropped.
 */
export async function loadBookingOptions(
  db: SupabaseClient,
  clientId: string,
  today: string,
): Promise<BookingOptionTour[]> {
  const tours = await loadTours(db, clientId)
  const tourIds = new Set(tours.map((tour) => tour.id))
  const departures = await loadDepartures(db, clientId, today, tourIds)
  const byTour = groupByTour(departures)

  const options: BookingOptionTour[] = tours.map((tour) => ({
    id: tour.id,
    name: tour.name,
    durationText: tour.durationText,
    departures: byTour.get(tour.id) ?? [],
  }))

  return options.sort((a, b) => a.name.localeCompare(b.name))
}
