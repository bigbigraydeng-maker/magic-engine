/**
 * Read-only catalog price text for a deal amount.
 *
 * Departure override wins when it is non-blank. A blank override is absent,
 * so the caller can fall through to the tour's display price. This module
 * only selects those two columns and never writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const TOURS = 'tour_catalog_tours'
const DEPARTURES = 'tour_catalog_departures'
export const DEAL_PRICE_TOUR_COLUMNS = 'id, display_price_text'
export const DEAL_PRICE_DEPARTURE_COLUMNS = 'id, price_text_override'

export type DealPriceTexts = {
  departurePriceText: string | null
  tourPriceText: string | null
}

export async function loadDealPriceTexts(
  db: SupabaseClient,
  clientId: string,
  tourId: string | null,
  departureId: string | null,
): Promise<DealPriceTexts> {
  const tourPriceText = await readTourPrice(db, clientId, tourId)
  const override = await readDeparturePrice(db, clientId, departureId)
  const departurePriceText = override != null && override.trim() !== '' ? override : null
  return { departurePriceText, tourPriceText }
}

async function readTourPrice(db: SupabaseClient, clientId: string, id: string | null): Promise<string | null> {
  if (!id) return null
  const { data, error } = await db.from(TOURS).select(DEAL_PRICE_TOUR_COLUMNS).eq('id', id).eq('client_id', clientId).maybeSingle()
  if (error) throw new Error('deal_price_read_failed')
  const value = rowOf(data)?.display_price_text
  return typeof value === 'string' ? value : null
}

async function readDeparturePrice(db: SupabaseClient, clientId: string, id: string | null): Promise<string | null> {
  if (!id) return null
  const { data, error } = await db.from(DEPARTURES).select(DEAL_PRICE_DEPARTURE_COLUMNS).eq('id', id).eq('client_id', clientId).maybeSingle()
  if (error) throw new Error('deal_price_read_failed')
  const value = rowOf(data)?.price_text_override
  return typeof value === 'string' ? value : null
}

function rowOf(data: unknown): Record<string, unknown> | null {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
  return null
}
