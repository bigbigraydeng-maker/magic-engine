/**
 * Daily index-status rotation (22.E.S15 后半 · R5 收录检查).
 *
 * For each focus client with a GSC connector, inspect up to
 * URLS_PER_CLIENT_PER_DAY crawled pages — OLDEST index_checked_at first,
 * never-checked (NULL) before everything (魏征 M6: newest-first would let
 * long-tail pages starve and R5 would be blind to exactly the pages it
 * exists for). Results land on client_site_pages:
 *
 *   index_verdict        ← Google coverageState (text, verbatim-ish)
 *   index_checked_at     ← now
 *   first_not_indexed_at ← set on first not-indexed sighting,
 *                          CLEARED when the page flips back to indexed
 *
 * A quota error (429) stops that client's batch for the day — the rotation
 * resumes where it left off tomorrow by construction.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { inspectUrl, InspectQuotaError } from '@/lib/gsc/inspect'
import { isHtmlPageUrl } from '@/lib/seo/url-kind'

const URLS_PER_CLIENT_PER_DAY = 20

export interface IndexCheckClientResult {
  client_id: string
  checked: number
  not_indexed: number
  quota_hit: boolean
  error?: string
}

export interface IndexCheckBatchResult {
  clients: number
  checked: number
  not_indexed: number
  results: IndexCheckClientResult[]
}

interface FocusClient {
  client_id: string
  site_url: string
}

/** Focus clients (seo_config.weekly_blog=true) that have a connected GSC. */
async function loadFocusClientsWithGsc(supabase: SupabaseClient): Promise<FocusClient[]> {
  const { data: focus, error: focusErr } = await supabase
    .from('clients')
    .select('id')
    .contains('seo_config', { weekly_blog: true })
  if (focusErr) throw new Error(`focus clients load failed: ${focusErr.message}`)

  const ids = ((focus ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return []

  const { data: connectors, error: connErr } = await supabase
    .from('client_connectors')
    .select('client_id, config')
    .eq('anchor', 'gsc')
    .eq('status', 'connected')
    .in('client_id', ids)
  if (connErr) throw new Error(`gsc connectors load failed: ${connErr.message}`)

  return ((connectors ?? []) as Array<{ client_id: string; config: { site_url?: string } | null }>)
    .filter((c) => typeof c.config?.site_url === 'string' && c.config.site_url.length > 0)
    .map((c) => ({ client_id: c.client_id, site_url: c.config!.site_url! }))
}

async function runForClient(
  supabase: SupabaseClient,
  client: FocusClient,
): Promise<IndexCheckClientResult> {
  const result: IndexCheckClientResult = {
    client_id: client.client_id,
    checked: 0,
    not_indexed: 0,
    quota_hit: false,
  }

  const { data: pages, error } = await supabase
    .from('client_site_pages')
    .select('id, url, first_not_indexed_at')
    .eq('client_id', client.client_id)
    .eq('crawl_status', 'crawled')
    .order('index_checked_at', { ascending: true, nullsFirst: true })
    // Over-fetch: asset URLs (images/PDFs the crawler picked up) are dropped
    // below, and each one would otherwise waste a day's inspection slot.
    .limit(URLS_PER_CLIENT_PER_DAY * 3)

  if (error) {
    result.error = `pages load failed: ${error.message}`
    return result
  }

  const pageRows = ((pages ?? []) as Array<{
    id: string
    url: string
    first_not_indexed_at: string | null
  }>)
    .filter((p) => isHtmlPageUrl(p.url))
    .slice(0, URLS_PER_CLIENT_PER_DAY)

  for (const page of pageRows) {
    try {
      const inspection = await inspectUrl(client.site_url, page.url, client.client_id)
      if (!inspection) {
        result.error = 'no GSC token'
        break
      }

      const nowIso = new Date().toISOString()
      const update: Record<string, unknown> = {
        index_verdict: inspection.coverageState,
        index_checked_at: nowIso,
      }
      if (inspection.indexed) {
        update.first_not_indexed_at = null
      } else {
        result.not_indexed += 1
        if (!page.first_not_indexed_at) update.first_not_indexed_at = nowIso
      }

      const { error: updateErr } = await supabase
        .from('client_site_pages')
        .update(update)
        .eq('id', page.id)
      if (updateErr) throw new Error(updateErr.message)

      result.checked += 1
    } catch (err) {
      if (err instanceof InspectQuotaError) {
        result.quota_hit = true
        break
      }
      // Per-URL failure: record once and keep rotating.
      result.error = err instanceof Error ? err.message : String(err)
    }
  }

  return result
}

export async function runIndexCheckBatch(
  supabase: SupabaseClient = supabaseAdmin,
): Promise<IndexCheckBatchResult> {
  const clients = await loadFocusClientsWithGsc(supabase)

  const results: IndexCheckClientResult[] = []
  for (const client of clients) {
    results.push(await runForClient(supabase, client))
  }

  return {
    clients: results.length,
    checked: results.reduce((s, r) => s + r.checked, 0),
    not_indexed: results.reduce((s, r) => s + r.not_indexed, 0),
    results,
  }
}
