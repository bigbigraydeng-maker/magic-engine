/**
 * Watch-keyword rank snapshots.
 *
 * Some clients have a handful of "watch keywords" that the weekly ranked_keywords
 * snapshot cannot see (the domain does not appear in DataForSEO's ranked list for
 * them). For each watch keyword we run ONE live Google organic SERP at depth 100
 * and record the best rank of the client's own domain. If the domain is absent
 * from the first 100 results we record position = null ("not in top 100") — never
 * a fake number, and never a row for a failed fetch.
 *
 * Rows reuse the existing keyword_snapshots table and KeywordSnapshotRow shape so
 * the weekly snapshot and the watch snapshot stay comparable.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getOrganicRanks, type OrganicRankSnapshot } from '@/lib/dataforseo/serp'
import { hostOf } from '@/lib/seo-meta/cycle/rank-check'
import { locationCodeForDb, type KeywordSnapshotClient, type KeywordSnapshotRow } from './keyword-snapshots'

/** SERP depth for every watch reading: the first ten result pages. */
export const WATCH_RANK_DEPTH = 100

/** Hard cap on watch keywords per client — each one is a paid live SERP. */
export const MAX_WATCH_KEYWORDS = 10

/**
 * Read `rank_watch_keywords` out of clients.seo_config (jsonb, may be null or a
 * non-object). Anything malformed yields []. Strings are trimmed, lowercased and
 * inner whitespace collapsed; empties dropped; duplicates removed keeping order.
 */
export function parseWatchKeywords(seoConfig: unknown): string[] {
  if (seoConfig === null || typeof seoConfig !== 'object' || Array.isArray(seoConfig)) return []
  const raw = (seoConfig as Record<string, unknown>).rank_watch_keywords
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const keyword = entry.trim().toLowerCase().replace(/\s+/g, ' ')
    if (keyword.length === 0 || seen.has(keyword)) continue
    seen.add(keyword)
    out.push(keyword)
    if (out.length >= MAX_WATCH_KEYWORDS) break
  }
  return out
}

export type WatchRankStatus = 'ranked' | 'not_in_top_100' | 'fetch_failed'

export interface WatchRankReading {
  keyword: string
  status: WatchRankStatus
  /** Organic rank_group of the best own-domain result. Non-null only when status === 'ranked'. */
  position: number | null
  url: string | null
  /** DataForSEO per-task cost in USD when reported. */
  cost: number | null
  error?: string
}

/**
 * Pure: read the client's own-domain rank out of an organic SERP snapshot.
 *
 * Uses rank_group (organic position), never rank_absolute — the latter counts AI
 * Overview / People-also-ask / video blocks and shifts when Google adds a block.
 * Absent from the first `depth` results is a STATUS, not a number.
 */
export function readOwnDomainRank(snapshot: OrganicRankSnapshot, domain: string, keyword: string): WatchRankReading {
  const ownHost = hostOf(domain)
  const own = snapshot.items.filter((it) => hostOf(it.domain ?? it.url) === ownHost)

  if (own.length > 0) {
    const best = own.reduce((a, b) => (b.rankGroup < a.rankGroup ? b : a))
    return { keyword, status: 'ranked', position: best.rankGroup, url: best.url, cost: snapshot.cost }
  }
  return { keyword, status: 'not_in_top_100', position: null, url: null, cost: snapshot.cost }
}

/**
 * One row per reading that actually produced a result. A `fetch_failed` reading is
 * skipped: a failed fetch must never become a fake "not ranked" row.
 */
export function buildWatchSnapshotRows(
  client: KeywordSnapshotClient,
  readings: WatchRankReading[],
  measuredAt: Date,
): KeywordSnapshotRow[] {
  const measuredAtIso = measuredAt.toISOString()
  const snapshotDate = measuredAtIso.slice(0, 10)
  const locationCode = locationCodeForDb(client.semrush_db)

  return readings
    .filter((r) => r.status !== 'fetch_failed')
    .map((r) => ({
      client_id: client.id,
      domain: client.domain,
      keyword: r.keyword,
      position: r.position,
      search_volume: null,
      keyword_difficulty: null,
      cpc: null,
      competition: null,
      intent: null,
      source: 'dataforseo' as const,
      location_code: locationCode,
      semrush_db: client.semrush_db,
      snapshot_date: snapshotDate,
      measured_at: measuredAtIso,
      local_pack_rank: null,
    }))
}

export interface WatchSnapshotResult {
  client_id: string
  dry_run: boolean
  keywords_requested: number
  skipped_already_snapshotted: string[]
  readings: WatchRankReading[]
  rows_written: number
  cost_usd: number
}

/**
 * Run one live SERP per watch keyword and persist the readings.
 *
 * Keywords already present in today's snapshot are skipped — the main weekly
 * snapshot already recorded them, so re-fetching would be a wasted paid call.
 * Dry run performs no DB access at all.
 */
export async function snapshotWatchedKeywordsForClient(
  client: KeywordSnapshotClient,
  keywords: string[],
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<WatchSnapshotResult> {
  const dryRun = options.dryRun ?? false
  const now = options.now ?? new Date()
  const locationCode = locationCodeForDb(client.semrush_db)
  const countryCode: 'au' | 'nz' = locationCode === 2554 ? 'nz' : 'au'
  const today = now.toISOString().slice(0, 10)

  const empty: WatchSnapshotResult = {
    client_id: client.id,
    dry_run: dryRun,
    keywords_requested: keywords.length,
    skipped_already_snapshotted: [],
    readings: [],
    rows_written: 0,
    cost_usd: 0,
  }
  if (keywords.length === 0) return empty

  const skipped: string[] = []
  let pending = keywords
  if (!dryRun) {
    const { data, error } = await supabaseAdmin
      .from('keyword_snapshots')
      .select('keyword')
      .eq('client_id', client.id)
      .eq('location_code', locationCode)
      .eq('snapshot_date', today)
      .in('keyword', keywords)

    if (error) {
      throw new Error(`keyword_snapshots watch pre-read failed: ${error.message}`)
    }

    const already = new Set(((data ?? []) as Array<{ keyword: string }>).map((row) => row.keyword))
    for (const keyword of keywords) {
      if (already.has(keyword)) skipped.push(keyword)
    }
    pending = keywords.filter((keyword) => !already.has(keyword))
  }

  const readings: WatchRankReading[] = []
  for (const keyword of pending) {
    try {
      const snap = await getOrganicRanks(keyword, countryCode, { depth: WATCH_RANK_DEPTH })
      readings.push(readOwnDomainRank(snap, client.domain, keyword))
    } catch (err) {
      readings.push({
        keyword,
        status: 'fetch_failed',
        position: null,
        url: null,
        cost: null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const cost_usd = readings.reduce((sum, r) => sum + (r.cost ?? 0), 0)
  const rows = buildWatchSnapshotRows(client, readings, now)

  let rows_written = 0
  if (!dryRun && rows.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('keyword_snapshots')
      .upsert(rows, { onConflict: 'client_id,keyword,location_code,snapshot_date' })
      .select('id')

    if (error) {
      throw new Error(`keyword_snapshots watch upsert failed: ${error.message}`)
    }
    rows_written = data?.length ?? rows.length
  }

  return {
    client_id: client.id,
    dry_run: dryRun,
    keywords_requested: keywords.length,
    skipped_already_snapshotted: skipped,
    readings,
    rows_written,
    cost_usd,
  }
}
