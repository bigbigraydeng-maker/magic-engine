/**
 * Page-level signals for the SEO patrol (22.E.S15).
 *
 * Builds the `pages` input that R2 (missing internal link) has waited for
 * since the MVP shipped with `pages: []`:
 *
 *   1. Load the client's crawled pages (client_site_pages with markdown) —
 *      refreshed weekly by the site-audit-weekly cron.
 *   2. Parse every page's markdown for same-origin links → inbound-link map.
 *   3. Join the latest GSC top_pages (impressions per URL).
 *   4. Emit a PageSignal per GSC page THAT WAS ALSO CRAWLED — pages missing
 *      from the crawl set are skipped, not treated as orphans (a maxPages
 *      cap or a failed fetch must not manufacture "no internal link" alarms).
 *
 * Known trade-off (documented, deliberate): Jina markdown includes nav and
 * footer links, so almost every reachable page has SOME inbound link. R2
 * therefore only fires for true orphan pages — rare but high-signal. A
 * template-link discount (nav appears on ~every page) can sharpen this later.
 *
 * R5 fields (discoveredNotIndexed/daysNotIndexed) stay false/null here —
 * they arrive with the URL-inspection collector (PR B).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { extractMarkdownLinks } from '@/lib/site-audit/crawler'
import type { PageSignal } from './types'

interface CrawledPage {
  url: string
  markdown_content: string | null
}

interface GscPageRow {
  page?: string
  url?: string
  clicks?: number
  impressions?: number
  position?: number
}

/**
 * Canonical form for cross-source URL comparison:
 * protocol dropped, leading www. dropped, host lowercased, trailing slash,
 * query and fragment dropped.
 */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    // Strip trailing slashes AND markdown residue the bare-URL regex drags
    // along (**, ., , etc.) — un-stripped residue makes cross-source URL
    // matching silently fail.
    const path = u.pathname.replace(/[*.,'")]+$/, '').replace(/\/+$/, '') || '/'
    return `${host}${path}`
  } catch {
    return null
  }
}

/**
 * Inbound-link map from crawled pages: canonical target URL → count of
 * DISTINCT source pages linking to it. Self-links don't count.
 */
export function buildInboundMap(pages: CrawledPage[], origin: string): Map<string, number> {
  const inbound = new Map<string, number>()

  for (const page of pages) {
    if (!page.markdown_content) continue
    const sourceCanonical = canonicalUrl(page.url)

    // Explicit high cap: the extractor's default (50) lets nav/footer links
    // crowd out deep in-content links, systematically under-counting inbound.
    // (Jina's 30k-char page truncation remains a known, accepted bias.)
    const links = extractMarkdownLinks(page.markdown_content, origin, 500)
    const targets = new Set<string>()
    for (const link of links) {
      const target = canonicalUrl(link)
      if (!target || target === sourceCanonical) continue
      targets.add(target)
    }
    for (const target of Array.from(targets)) {
      inbound.set(target, (inbound.get(target) ?? 0) + 1)
    }
  }

  return inbound
}

export interface PageSignalsMeta {
  crawled_pages: number
  gsc_pages: number
  matched: number
  /** True when the crawl set is empty/contentless — R2 silently off. */
  crawl_data_missing: boolean
}

export async function buildPageSignals(
  clientId: string,
  domain: string,
  supabase: SupabaseClient = supabaseAdmin,
): Promise<{ pages: PageSignal[]; meta: PageSignalsMeta }> {
  const origin = domain.startsWith('http') ? domain : `https://${domain}`

  const [{ data: crawled }, { data: gsc }] = await Promise.all([
    supabase
      .from('client_site_pages')
      .select('url, markdown_content')
      .eq('client_id', clientId)
      .eq('crawl_status', 'crawled'),
    supabase
      .from('gsc_performance_snapshots')
      .select('top_pages, period_end')
      .eq('client_id', clientId)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const pages = ((crawled ?? []) as CrawledPage[]).filter(
    (p) => (p.markdown_content ?? '').length > 100,
  )
  const gscPages = ((gsc as { top_pages?: GscPageRow[] } | null)?.top_pages ?? [])

  const meta: PageSignalsMeta = {
    crawled_pages: pages.length,
    gsc_pages: gscPages.length,
    matched: 0,
    crawl_data_missing: pages.length === 0,
  }

  if (pages.length === 0 || gscPages.length === 0) {
    return { pages: [], meta }
  }

  const inbound = buildInboundMap(pages, origin)
  const crawledSet = new Set(
    pages.map((p) => canonicalUrl(p.url)).filter((u): u is string => u !== null),
  )

  const signals: PageSignal[] = []
  for (const row of gscPages) {
    const rawUrl = row.page ?? row.url
    if (!rawUrl) continue
    const canonical = canonicalUrl(rawUrl)
    // Only evaluate pages we actually crawled — an un-crawled page has an
    // unknown link graph, not a missing one.
    if (!canonical || !crawledSet.has(canonical)) continue

    meta.matched += 1
    const impressions = row.impressions ?? 0
    const clicks = row.clicks ?? 0
    signals.push({
      url: rawUrl,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      position: row.position ?? 0,
      hasInternalLink: (inbound.get(canonical) ?? 0) > 0,
      discoveredNotIndexed: false,
      daysNotIndexed: null,
    })
  }

  return { pages: signals, meta }
}
