/**
 * Read-only brand / non-brand split of the stored (query, page) history.
 *
 * Which words count as "brand" is NOT decided here: it comes from the client's own configuration
 * (`clients.seo_config.brand_terms` / `brand_ambiguous_terms`, see brand-split.ts), so no client name or
 * industry judgement lives in shared code. A client without valid brand terms gets
 * `brand_terms_not_configured`, never a guessed split. A client that has no `brand_terms` but already maintains
 * `clients.brand_aliases` (the Settings alias panel) is split with those aliases instead of being asked twice.
 *
 * Reads only: `clients`, `client_connectors`, `gsc_query_page_daily`, `gsc_page_daily`. Writes nothing, calls no
 * paid or external API. It pulls the whole window into memory, so it is for batch use (reports, checks), not for
 * a request path.
 *
 * `unattributed` = page-level total − query-level total for the same days. Google hides anonymised queries, so
 * the query-level total is normally the smaller one; the difference is reported rather than hidden, and must not
 * be folded into `non_brand` by callers without saying so.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { gscSiteUrlFromConfig } from './connected-clients'
import { readBrandConfig, splitQueryRows, type BrandSplitResult, type QueryRow } from './brand-split'
import { PAGE_DAILY_TABLE } from './page-daily-store'
import { QUERY_PAGE_DAILY_TABLE } from './query-page-daily-store'

/** Safety valve for fetchAll: 16 months of one client is far below this; hitting it throws instead of truncating. */
const QUERY_ROWS_HARD_CAP = 1_000_000

export interface BrandSplitWindow {
  readonly startDay: string
  readonly endDay: string
}

export type BrandSplitReport =
  | { readonly status: 'brand_terms_not_configured'; readonly start_day: string; readonly end_day: string }
  | {
      readonly status: 'ok'
      readonly start_day: string
      readonly end_day: string
      readonly buckets: BrandSplitResult
      readonly query_level: { readonly clicks: number; readonly impressions: number; readonly rows: number }
      readonly page_level: { readonly clicks: number; readonly impressions: number }
      readonly unattributed: { readonly clicks: number; readonly impressions: number }
      /** Distinct days that have rows in each table: while a backfill is incomplete the two differ, and the gap shows up as "unattributed". */
      readonly coverage: { readonly days_with_query_rows: number; readonly days_with_page_rows: number }
      /** Things a reader must know before trusting the numbers (negative gap, incomplete coverage). */
      readonly warnings: readonly string[]
      readonly notes: readonly string[]
    }

interface QueryPageRow {
  readonly day: string
  readonly query: string
  readonly clicks: number
  readonly impressions: number
  readonly position: number
}

interface PageRow {
  readonly day: string
  readonly clicks: number
  readonly impressions: number
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** The GSC property URL of one client, or null when it has no connected one. */
async function loadSiteUrl(supabase: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('client_connectors')
    .select('config')
    .eq('client_id', clientId)
    .eq('anchor', 'gsc')
    .eq('status', 'connected')
  if (error) throw new Error(`[db] client_connectors read failed: ${error.message}`)
  const row = (data ?? [])[0] as { config?: unknown } | undefined
  return row ? gscSiteUrlFromConfig(row.config) : null
}

async function loadBrandSources(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ seoConfig: unknown; brandAliases: unknown }> {
  const { data, error } = await supabase
    .from('clients')
    .select('seo_config, brand_aliases')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new Error(`[db] clients read failed: ${error.message}`)
  const row = data as { seo_config?: unknown; brand_aliases?: unknown } | null
  return { seoConfig: row?.seo_config ?? null, brandAliases: row?.brand_aliases ?? null }
}

/** Split one client's stored queries over [startDay, endDay] into brand / ambiguous / non-brand. */
export async function getBrandSplit(
  supabase: SupabaseClient,
  clientId: string,
  window: BrandSplitWindow,
): Promise<BrandSplitReport> {
  const base = { start_day: window.startDay, end_day: window.endDay }
  const [sources, siteUrl] = await Promise.all([loadBrandSources(supabase, clientId), loadSiteUrl(supabase, clientId)])
  const config = readBrandConfig(sources.seoConfig, siteUrl, sources.brandAliases)
  if (config.status !== 'ok') return { status: 'brand_terms_not_configured', ...base }

  const queryRows = await fetchAll<QueryPageRow>(
    (from, to) =>
      supabase
        .from(QUERY_PAGE_DAILY_TABLE)
        .select('day, query, clicks, impressions, position')
        .eq('client_id', clientId)
        .gte('day', window.startDay)
        .lte('day', window.endDay)
        .order('day', { ascending: true })
        .order('query', { ascending: true })
        .order('page_url', { ascending: true })
        .range(from, to),
    QUERY_ROWS_HARD_CAP,
  )
  const pageRows = await fetchAll<PageRow>(
    (from, to) =>
      supabase
        .from(PAGE_DAILY_TABLE)
        .select('day, clicks, impressions')
        .eq('client_id', clientId)
        .gte('day', window.startDay)
        .lte('day', window.endDay)
        .order('day', { ascending: true })
        .order('page_url', { ascending: true })
        .range(from, to),
    QUERY_ROWS_HARD_CAP,
  )

  const rows: QueryRow[] = queryRows.map((r) => ({
    query: String(r.query ?? ''),
    clicks: num(r.clicks),
    impressions: num(r.impressions),
    position: num(r.position),
  }))
  const queryClicks = rows.reduce((a, r) => a + r.clicks, 0)
  const queryImpressions = rows.reduce((a, r) => a + r.impressions, 0)
  const pageClicks = pageRows.reduce((a, r) => a + num(r.clicks), 0)
  const pageImpressions = pageRows.reduce((a, r) => a + num(r.impressions), 0)

  const queryDays = new Set(queryRows.map((r) => String(r.day))).size
  const pageDays = new Set(pageRows.map((r) => String(r.day))).size
  const unattributedClicks = pageClicks - queryClicks
  const warnings: string[] = []
  if (queryDays !== pageDays) {
    warnings.push(
      `query rows cover ${queryDays} day(s) but page rows cover ${pageDays}: days missing from one table are counted as unattributed — wait for the backfill or narrow the window.`,
    )
  }
  if (unattributedClicks < 0) {
    warnings.push('query-level clicks exceed page-level clicks (negative unattributed): the page table is missing days the query table has, or the data changed after it was stored.')
  }

  return {
    status: 'ok',
    ...base,
    buckets: splitQueryRows(rows, config.matcher),
    query_level: { clicks: queryClicks, impressions: queryImpressions, rows: rows.length },
    page_level: { clicks: pageClicks, impressions: pageImpressions },
    unattributed: { clicks: unattributedClicks, impressions: pageImpressions - queryImpressions },
    coverage: { days_with_query_rows: queryDays, days_with_page_rows: pageDays },
    warnings,
    notes: [
      'Anonymised queries are long-tail and mostly non-brand, so brand / (brand + non_brand) overstates the brand share; use unattributed too.',
      'Google hides anonymised queries, so query-level totals are normally below page-level totals; the gap is "unattributed", not lost data.',
      'Impressions are counted per page result, so a search that shows several of the site\'s pages counts once per page; do not compare them with site-wide totals from Google\'s dashboard.',
      'Non-Latin brand terms match as substrings and can over-match; check suspect_missed_brand and the buckets before relying on them.',
    ],
  }
}
