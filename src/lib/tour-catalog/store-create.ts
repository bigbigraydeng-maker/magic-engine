/**
 * Tour catalog — inserting a new tour and its first departures into the draft.
 * No migration: the tour row is a plain insert (the change-log trigger records it as "system");
 * departures go through the existing RPC so they carry the signed-in person as actor.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { newTourToDbRow, type NewTourInput } from './new-tour'
import { asRecord, mapTourRow } from './store'
import { saveDeparture, type EditResult } from './store-edit'
import type { CatalogTour } from './types'

const UNIQUE_VIOLATION = '23505'

async function nextSortOrder(db: SupabaseClient, clientId: string): Promise<number> {
  const res = await db
    .from('tour_catalog_tours')
    .select('sort_order')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: false })
    .limit(1)
  if (res.error) throw new Error(res.error.message)
  const top = (res.data ?? [])[0] as { sort_order?: unknown } | undefined
  return typeof top?.sort_order === 'number' ? top.sort_order + 1 : 0
}

async function removeTour(db: SupabaseClient, clientId: string, tourId: string): Promise<void> {
  const res = await db.from('tour_catalog_tours').delete().eq('client_id', clientId).eq('id', tourId)
  if (res.error) console.error('tour_catalog_create_cleanup_failed', res.error.message)
}

export async function createTour(
  db: SupabaseClient,
  clientId: string,
  input: NewTourInput,
  actor: string,
): Promise<EditResult<CatalogTour>> {
  let sortOrder: number
  try {
    sortOrder = await nextSortOrder(db, clientId)
  } catch (error) {
    return { ok: false, code: 'error', message: error instanceof Error ? error.message : 'sort_order_failed' }
  }

  const inserted = await db.from('tour_catalog_tours').insert(newTourToDbRow(clientId, input, sortOrder)).select('*').single()
  if (inserted.error) {
    if (inserted.error.code === UNIQUE_VIOLATION) {
      return { ok: false, code: 'duplicate', message: inserted.error.message }
    }
    if (inserted.error.code === '23514') {
      return { ok: false, code: 'invalid', message: inserted.error.message }
    }
    return { ok: false, code: 'error', message: inserted.error.message }
  }
  const tour = mapTourRow(asRecord(inserted.data))

  for (const departure of input.departures) {
    const saved = await saveDeparture(
      db,
      clientId,
      tour.id,
      null,
      null,
      {
        depart_on: departure.departOn,
        return_on: departure.returnOn,
        status: departure.status,
        price_text_override: departure.priceTextOverride,
      },
      actor,
    )
    if (!saved.ok) {
      await removeTour(db, clientId, tour.id)
      return saved
    }
  }
  return { ok: true, value: tour }
}
