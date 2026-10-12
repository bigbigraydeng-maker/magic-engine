/**
 * Travel adapter: turns tours + departures into the generic SalesUnit shape.
 * This is the ONLY module allowed to know about table names, tours or departures.
 * Reads only; the Supabase client is always passed in, never created here.
 * From the `internal` jsonb we read ONLY the `capacity` key (via readInternalCapacity).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '../../supabase-paginate'
import { effectiveCapacity, readInternalCapacity } from './capacity'
import type { SalesUnit } from './types'

/** The only thing the page shell knows about "what can be sold": a source that lists sales units. */
export interface SalesUnitSource {
  listSalesUnits(clientId: string): Promise<SalesUnit[]>
}

interface DepartureRow {
  id: string
  tour_id: string
  depart_on: string
  status: string | null
  internal: unknown
}

interface TourRow {
  id: string
  name: string | null
  max_group_size: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function mapDepartureRow(raw: unknown): DepartureRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (!isNonEmptyString(row.id)) return null
  if (!isNonEmptyString(row.tour_id)) return null
  if (!isNonEmptyString(row.depart_on)) return null
  return {
    id: row.id,
    tour_id: row.tour_id,
    depart_on: row.depart_on,
    status: typeof row.status === 'string' ? row.status : null,
    internal: row.internal,
  }
}

function mapTourRow(raw: unknown): TourRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (!isNonEmptyString(row.id)) return null
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : null,
    max_group_size: row.max_group_size,
  }
}

async function loadDepartures(db: SupabaseClient, clientId: string): Promise<DepartureRow[]> {
  const rows = await fetchAll<unknown>(
    (from, to) =>
      db
        .from('tour_catalog_departures')
        .select('id, tour_id, depart_on, status, internal')
        .eq('client_id', clientId)
        .order('depart_on', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    5000,
  )
  const out: DepartureRow[] = []
  for (const raw of rows) {
    const mapped = mapDepartureRow(raw)
    if (mapped !== null) out.push(mapped)
  }
  return out
}

async function loadTours(db: SupabaseClient, clientId: string): Promise<Map<string, TourRow>> {
  const rows = await fetchAll<unknown>(
    (from, to) =>
      db
        .from('tour_catalog_tours')
        .select('id, name, max_group_size')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    2000,
  )
  const map = new Map<string, TourRow>()
  for (const raw of rows) {
    const mapped = mapTourRow(raw)
    if (mapped !== null) map.set(mapped.id, mapped)
  }
  return map
}

export function createDepartureUnitSource(db: SupabaseClient): SalesUnitSource {
  return {
    async listSalesUnits(clientId: string): Promise<SalesUnit[]> {
      const [departures, tours] = await Promise.all([
        loadDepartures(db, clientId),
        loadTours(db, clientId),
      ])

      return departures.map((departure) => {
        const tour = tours.get(departure.tour_id)
        const tourName = tour?.name ?? '未知团'
        const { capacity, note } = effectiveCapacity({
          internalCapacity: readInternalCapacity(departure.internal),
          tourMaxGroupSize: tour?.max_group_size,
        })
        return {
          unitId: departure.id,
          groupId: departure.tour_id,
          label: `${tourName} · ${departure.depart_on}`,
          date: departure.depart_on,
          capacity,
          capacityNote: note,
          unitStatus: departure.status ?? 'open',
        }
      })
    },
  }
}
