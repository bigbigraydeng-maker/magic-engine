/**
 * CRM booking options — read-only catalog of bookable tours and their future
 * departures, used to populate the booking form's tour/departure pickers.
 *
 * Every query filters by client_id (tenant rule). The Supabase client is always
 * passed in; this module never imports a client.
 *
 * Privacy: the two catalog reads live in `@/lib/tour-catalog/booking-facts`,
 * which selects only the columns the picker needs — the `internal` flag and any
 * price columns are never read.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadBookingTourOptions } from '@/lib/tour-catalog/booking-facts'
import type { BookingDepartureFacts } from '@/lib/tour-catalog/booking-facts'

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

// --- bookable filter ----------------------------------------------------------

function isBookableStatus(status: string): boolean {
  return status !== 'cancelled' && status !== 'closed'
}

function isBookableDeparture(
  departure: BookingDepartureFacts,
  today: string,
  tourIds: Set<string>,
): boolean {
  if (!tourIds.has(departure.tourId)) {
    return false
  }
  if (departure.departOn < today) {
    return false
  }
  return isBookableStatus(departure.status)
}

// --- assembly -----------------------------------------------------------------

function groupByTour(departures: BookingDepartureFacts[]): Map<string, BookingOptionDeparture[]> {
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
  const { tours, departures } = await loadBookingTourOptions(db, clientId)
  const tourIds = new Set(tours.map((tour) => tour.id))
  const bookable = departures.filter((departure) =>
    isBookableDeparture(departure, today, tourIds),
  )
  const byTour = groupByTour(bookable)

  const options: BookingOptionTour[] = tours.map((tour) => ({
    id: tour.id,
    name: tour.name,
    durationText: tour.durationText,
    departures: byTour.get(tour.id) ?? [],
  }))

  return options.sort((a, b) => a.name.localeCompare(b.name))
}
