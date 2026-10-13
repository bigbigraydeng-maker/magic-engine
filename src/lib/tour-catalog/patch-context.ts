/**
 * Loads what the tour-patch validator needs to know about one client's catalog: the tour as it
 * is now, every image address the draft already uses, the image host allow-list and the client's
 * website domain (design §6.11.1 items 6–7). Server-side only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TourPatchContext } from './content-validation'
import { collectImagePool } from './image-rules'
import { getClientDomain, loadDraftCatalog } from './store'
import { getSettings } from './store-access'

/** Null when the tour does not exist in this client's draft catalog. */
export async function loadTourPatchContext(
  db: SupabaseClient,
  clientId: string,
  tourId: string,
  canEditSite: boolean,
): Promise<TourPatchContext | null> {
  const snapshot = await loadDraftCatalog(db, clientId)
  const existingTour = snapshot.tours.find((tour) => tour.id === tourId)
  if (existingTour === undefined) return null
  const settings = await getSettings(db, clientId)
  const clientDomain = await getClientDomain(db, clientId)
  return {
    canEditSite,
    imagePool: new Set(collectImagePool(snapshot.tours)),
    imageHosts: settings.imageHosts,
    clientDomain,
    existingTour,
  }
}
