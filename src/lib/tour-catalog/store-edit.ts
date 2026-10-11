/**
 * Tour catalog — admin editing (tours, departures) and the change log.
 * Split from store.ts to keep each file under the 800-line limit; same conventions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { asRecord, asString, mapDepartureRow, mapTourRow, rowsOf } from './store'
import type { CatalogDeparture, CatalogTour } from './types'

// ---------------------------------------------------------------------------
// Admin editing (RPCs from 20261010150000_tour_catalog_edit.sql)
// ---------------------------------------------------------------------------

export type EditResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'conflict' | 'not_found' | 'invalid' | 'duplicate' | 'error'; message: string }

/** Map a raw RPC error message to a coarse code. `message` is always the raw text. */
export function mapEditError(message: string): EditResult<never> {
  if (message.startsWith('conflict:stale')) {
    return { ok: false, code: 'conflict', message }
  }
  if (message.startsWith('conflict:duplicate_departure')) {
    return { ok: false, code: 'duplicate', message }
  }
  if (message === 'tour_not_found' || message === 'departure_not_found') {
    return { ok: false, code: 'not_found', message }
  }
  if (
    message.startsWith('field_not_editable') ||
    message.startsWith('invalid_null') ||
    message.startsWith('invalid_value') ||
    message === 'depart_on_not_editable' ||
    message === 'depart_on_required' ||
    message === 'invalid_dates' ||
    message === 'invalid_price_text'
  ) {
    return { ok: false, code: 'invalid', message }
  }
  return { ok: false, code: 'error', message }
}

export async function updateTour(
  db: SupabaseClient,
  clientId: string,
  tourId: string,
  expectedUpdatedAt: string,
  dbPatch: Record<string, unknown>,
  actor: string,
): Promise<EditResult<CatalogTour>> {
  const res = await db.rpc('tour_catalog_update_tour', {
    p_client_id: clientId,
    p_tour_id: tourId,
    p_expected_updated_at: expectedUpdatedAt,
    p_patch: dbPatch,
    p_actor: actor,
  })
  if (res.error) {
    return mapEditError(res.error.message)
  }
  return { ok: true, value: mapTourRow(asRecord(res.data)) }
}

export async function saveDeparture(
  db: SupabaseClient,
  clientId: string,
  tourId: string,
  departureId: string | null,
  expectedUpdatedAt: string | null,
  dbFields: Record<string, unknown>,
  actor: string,
): Promise<EditResult<CatalogDeparture>> {
  const res = await db.rpc('tour_catalog_save_departure', {
    p_client_id: clientId,
    p_tour_id: tourId,
    p_departure_id: departureId,
    p_expected_updated_at: expectedUpdatedAt,
    p_fields: dbFields,
    p_actor: actor,
  })
  if (res.error) {
    return mapEditError(res.error.message)
  }
  return { ok: true, value: mapDepartureRow(asRecord(res.data)) }
}

export interface ChangeLogEntry {
  id: string
  entity: 'tour' | 'departure'
  entityId: string
  action: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  actor: string
  createdAt: string
}

function asEntity(value: unknown): 'tour' | 'departure' {
  return value === 'departure' ? 'departure' : 'tour'
}

function asAction(value: unknown): 'insert' | 'update' | 'delete' {
  if (value === 'insert' || value === 'delete') {
    return value
  }
  return 'update'
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function mapChangeLogRow(row: Record<string, unknown>): ChangeLogEntry {
  return {
    id: asString(row.id),
    entity: asEntity(row.entity),
    entityId: asString(row.entity_id),
    action: asAction(row.action),
    before: asNullableRecord(row.before),
    after: asNullableRecord(row.after),
    actor: asString(row.actor),
    createdAt: asString(row.created_at),
  }
}

export async function listChanges(
  db: SupabaseClient,
  clientId: string,
  entityIds: string[],
  limit = 50,
): Promise<ChangeLogEntry[]> {
  if (entityIds.length === 0) {
    return []
  }
  const res = await db
    .from('tour_catalog_change_log')
    .select('*')
    .eq('client_id', clientId)
    .in('entity_id', entityIds)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (res.error) {
    throw new Error(res.error.message)
  }
  return rowsOf(res.data).map(mapChangeLogRow)
}

/**
 * Everything that happened to one tour: the tour row itself plus every departure that belongs
 * (or belonged) to it — including departures that were later deleted, which no longer have an id
 * on the page.
 */
export async function listChangesForTour(
  db: SupabaseClient,
  clientId: string,
  tourId: string,
  limit = 50,
): Promise<ChangeLogEntry[]> {
  const res = await db
    .from('tour_catalog_change_log')
    .select('*')
    .eq('client_id', clientId)
    .or(`entity_id.eq.${tourId},after->>tour_id.eq.${tourId},before->>tour_id.eq.${tourId}`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (res.error) {
    throw new Error(res.error.message)
  }
  return rowsOf(res.data).map(mapChangeLogRow)
}

/** The newest rows of the whole catalog's change log (all tours and departures of one client). */
export async function listRecentChanges(
  db: SupabaseClient,
  clientId: string,
  limit = 1000,
): Promise<ChangeLogEntry[]> {
  const res = await db
    .from('tour_catalog_change_log')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (res.error) {
    throw new Error(res.error.message)
  }
  return rowsOf(res.data).map(mapChangeLogRow)
}

export interface DepartureLabel {
  tourName: string
  departOn: string
}

export async function getDepartureLabel(
  db: SupabaseClient,
  clientId: string,
  departureId: string,
): Promise<DepartureLabel | null> {
  const depRes = await db
    .from('tour_catalog_departures')
    .select('depart_on, tour_id')
    .eq('id', departureId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (depRes.error || depRes.data === null || depRes.data === undefined) {
    return null
  }
  const dep = asRecord(depRes.data)
  const tourId = asString(dep.tour_id)
  if (tourId === '') {
    return null
  }

  const tourRes = await db
    .from('tour_catalog_tours')
    .select('name')
    .eq('id', tourId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (tourRes.error || tourRes.data === null || tourRes.data === undefined) {
    return null
  }

  return {
    tourName: asString(asRecord(tourRes.data).name),
    departOn: asString(dep.depart_on),
  }
}
