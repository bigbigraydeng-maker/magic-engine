/**
 * client_site_pages — DNZ (Domain Network Zone) page snapshots (Phase 8.D.0)
 *
 * Stores the result of crawling a client's website so the strategy layer
 * can answer "what does the client already have?" before generating new content.
 *
 * Reference: ARCHITECTURE.md §3.6, ROADMAP.md P8.D.0.1
 */

import { supabaseAdmin } from '@/lib/supabase'
import type {
  SitePage,
  SitePageUpsert,
  ListSitePagesFilter,
} from '@/types/magic-engine'

const TABLE = 'client_site_pages'

function derivePath(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url.startsWith('/') ? url : '/'
  }
}

export async function listSitePages(
  clientId: string,
  filter: ListSitePagesFilter = {}
): Promise<SitePage[]> {
  let query: any = supabaseAdmin.from(TABLE).select('*').eq('client_id', clientId)

  if (filter.page_type) query = query.eq('page_type', filter.page_type)
  if (filter.crawl_status) query = query.eq('crawl_status', filter.crawl_status)
  if (filter.topic) query = query.contains('topics', [filter.topic])

  const { data, error } = await query.order('updated_at', { ascending: false })
  if (error) throw new Error(`Failed to list site pages: ${error.message}`)
  return (data || []) as SitePage[]
}

export async function upsertSitePage(input: SitePageUpsert): Promise<SitePage> {
  const path = input.path || derivePath(input.url)
  const payload = {
    ...input,
    path,
    page_type: input.page_type ?? 'other',
    crawl_status: input.crawl_status ?? 'pending',
    has_geo_block: input.has_geo_block ?? false,
    topics: input.topics ?? [],
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .upsert(payload, { onConflict: 'client_id,url' })
    .select()
    .single()

  if (error) throw new Error(`Failed to upsert site page: ${error.message}`)
  return data as SitePage
}

export async function getSitePageByUrl(
  clientId: string,
  url: string
): Promise<SitePage | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .eq('url', url)
    .maybeSingle()

  if (error) throw new Error(`Failed to get site page: ${error.message}`)
  return (data as SitePage | null) ?? null
}

export async function markCrawlFailed(
  clientId: string,
  url: string,
  errorMessage: string
): Promise<SitePage> {
  return upsertSitePage({
    client_id: clientId,
    url,
    path: derivePath(url),
    crawl_status: 'failed',
    crawl_error: errorMessage,
    last_crawled_at: new Date().toISOString(),
  })
}

export async function countSitePages(clientId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)

  if (error) throw new Error(`Failed to count site pages: ${error.message}`)
  return count ?? 0
}
