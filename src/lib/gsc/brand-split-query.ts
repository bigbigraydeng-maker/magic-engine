/**
 * Read-only brand / non-brand split of the stored (query, page) history.
 *
 * Which words count as "brand" is NOT decided here: it comes from the client's own configuration
 * (`clients.seo_config.brand_terms` / `brand_ambiguous_terms`, see brand-split.ts), so no client name or
 * industry judgement lives in shared code. A client without valid brand terms gets
 * `brand_terms_not_configured`, never a guessed split.
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
      readonly notes: readonly string[]
    }

interface QueryPageRow {
  readonly query: string
  readonly clicks: number
  readonly impressions: number
  readonly position: number
}

interface PageRow {
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

async function loadSeoConfig(supabase: SupabaseClient, clientId: string): Promise<unknown> {
  const { data, error } = await supabase.from('clients').select('seo_config').eq('id', clientId).maybeSingle()
  if (error) throw new Error(`[db] clients read failed: ${error.message}`)
  return (data as { seo_config?: unknown } | null)?.seo_config ?? null
}

/** Split one client's stored queries over [startDay, endDay] into brand / ambiguous / non-brand. */
export async function getBrandSplit(
  supabase: SupabaseClient,
  clientId: string,
  window: BrandSplitWindow,
): Promise<BrandSplitReport> {
  const base = { start_day: window.startDay, end_day: window.endDay }
  const [seoConfig, siteUrl] = await Promise.all([loadSeoConfig(supabase, clientId), loadSiteUrl(supabase, clientId)])
  const config = readBrandConfig(seoConfig, siteUrl)
  if (config.status !== 'ok') return { status: 'brand_terms_not_configured', ...base }

  const queryRows = await fetchAll<QueryPageRow>(
    (from, to) =>
      supabase
        .from(QUERY_PAGE_DAILY_TABLE)
        .select('query, clicks, impressions, position')
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
        .select('clicks, impressions')
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

  return {
    status: 'ok',
    ...base,
    buckets: splitQueryRows(rows, config.matcher),
    query_level: { clicks: queryClicks, impressions: queryImpressions, rows: rows.length },
    page_level: { clicks: pageClicks, impressions: pageImpressions },
    unattributed: { clicks: pageClicks - queryClicks, impressions: pageImpressions - queryImpressions },
    notes: [
      'Google hides anonymised queries, so query-level totals are normally below page-level totals; the gap is "unattributed", not lost data.',
      'Impressions are counted per page result, so a search that shows several of the site\'s pages counts once per page; do not compare them with site-wide totals from Google\'s dashboard.',
      'Non-Latin brand terms match as substrings and can over-match; check suspect_missed_brand and the buckets before relying on them.',
    ],
  }
}
