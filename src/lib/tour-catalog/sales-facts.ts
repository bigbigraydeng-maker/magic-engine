/**
 * Tour-catalog facts for the CRM sales-progress page — the only place that page may read catalog data from.
 *
 * The page needs, per departure: its date and status, the tour name, the public tour-level group size, and the
 * INTERNAL seat number kept on the departure. The internal seat number is operational and never leaves the building
 * (it is not in the website feed, ads or email); this module therefore reduces the `internal` JSON to that ONE number
 * right here and never returns the JSON itself, so airline / route facts cannot travel with it.
 *
 * Reads only `tour_catalog_tours` and `tour_catalog_departures`, never writes, never calls an rpc, and never imports
 * from `@/lib/crm` (the boundary guard in `__tests__/boundary.test.ts` pins all of that down). A row that cannot be
 * read makes the whole read fail: silently dropping a departure would hide the real reason its orders look orphaned.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'

export const SALES_FACT_TOUR_COLUMNS = 'id, name, slug, max_group_size'
export const SALES_FACT_DEPARTURE_COLUMNS = 'id, tour_id, depart_on, status, internal'

export interface SalesDepartureFacts {
  departureId: string
  tourId: string
  tourName: string | null
  /** the tour's catalog slug, e.g. used by the local import preview to find a departure by tour + date */
  tourSlug: string | null
  departOn: string
  status: string | null
  /** raw value of the internal `capacity` key: undefined when the key is absent (never any other key) */
  internalCapacity: unknown
  /** raw public tour-level group size (null / number / anything else the column held) */
  tourMaxGroupSize: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Only the `capacity` key of the internal JSON; undefined when it is absent or the JSON is not a plain object. */
function internalCapacityOf(internal: unknown): unknown {
  if (typeof internal !== 'object' || internal === null || Array.isArray(internal)) return undefined
  return (internal as Record<string, unknown>).capacity
}

interface TourFact {
  name: string | null
  slug: string | null
  maxGroupSize: unknown
}

async function readTours(db: SupabaseClient, clientId: string): Promise<Map<string, TourFact>> {
  const rows = await fetchAll<unknown>(
    (from, to) =>
      db
        .from('tour_catalog_tours')
        .select(SALES_FACT_TOUR_COLUMNS)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    2000,
  )
  const tours = new Map<string, TourFact>()
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    if (!isNonEmptyString(row.id)) continue
    tours.set(row.id, {
      name: typeof row.name === 'string' ? row.name : null,
      slug: typeof row.slug === 'string' ? row.slug : null,
      maxGroupSize: row.max_group_size,
    })
  }
  return tours
}

/** Every departure of the client, oldest first, with the facts above. Any query error or unreadable row throws. */
export async function loadSalesDepartureFacts(db: SupabaseClient, clientId: string): Promise<SalesDepartureFacts[]> {
  const [departures, tours] = await Promise.all([
    fetchAll<unknown>(
      (from, to) =>
        db
          .from('tour_catalog_departures')
          .select(SALES_FACT_DEPARTURE_COLUMNS)
          .eq('client_id', clientId)
          .order('depart_on', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      5000,
    ),
    readTours(db, clientId),
  ])
  const out: SalesDepartureFacts[] = []
  for (const raw of departures) {
    if (typeof raw !== 'object' || raw === null) throw new Error('unmappable departure row')
    const row = raw as Record<string, unknown>
    if (!isNonEmptyString(row.id) || !isNonEmptyString(row.tour_id) || !isNonEmptyString(row.depart_on)) {
      throw new Error('unmappable departure row')
    }
    const tour = tours.get(row.tour_id)
    out.push({
      departureId: row.id,
      tourId: row.tour_id,
      tourName: tour?.name ?? null,
      tourSlug: tour?.slug ?? null,
      departOn: row.depart_on,
      status: typeof row.status === 'string' ? row.status : null,
      internalCapacity: internalCapacityOf(row.internal),
      tourMaxGroupSize: tour?.maxGroupSize,
    })
  }
  return out
}
