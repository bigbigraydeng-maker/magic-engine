/**
 * Database helpers for the client_site_pages table.
 *
 * countSitePages      — total page count for a client (throws on error)
 * countGeoDetectedPages — count of pages with has_geo_block=true (returns 0 on error,
 *                         non-fatal so it never breaks the status endpoint)
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface TenantSitePageRow {
  readonly id: string
  readonly client_id: string
  readonly url: string
}

/** Read one exact page ledger row with the tenant filter in the database query. */
export async function getSitePageForClient(
  clientId: string,
  pageId: string,
): Promise<TenantSitePageRow | null> {
  if (!clientId.trim() || !pageId.trim()) return null
  const { data, error } = await supabaseAdmin
    .from('client_site_pages')
    .select('id, client_id, url')
    .eq('id', pageId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`client_site_pages tenant-bound select failed: ${error.message}`)
  if (!data) return null
  return data as TenantSitePageRow
}

/**
 * Returns the total number of crawled pages for the given client.
 * Throws if the DB query fails (use for metrics where accuracy matters).
 */
export async function countSitePages(clientId: string): Promise<number> {
  if (!clientId) return 0
  const { count, error } = await supabaseAdmin
    .from('client_site_pages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if (error) throw error
  if (count === null) {
    // Null count with no error would silently understate the page count.
    // Throw instead of coercing to 0 — this helper is for metrics where accuracy matters.
    throw new Error(`countSitePages(${clientId}) returned null count with no error`)
  }
  return count
}

/**
 * Returns the number of pages that have a GEO block detected.
 * Returns 0 on any DB error — non-fatal by design so callers don't need try/catch.
 */
export async function countGeoDetectedPages(clientId: string): Promise<number> {
  if (!clientId) return 0
  const { count, error } = await supabaseAdmin
    .from('client_site_pages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('has_geo_block', true)
  if (error) return 0
  return count ?? 0
}
