/**
 * Weekly competitor ranked-keyword collection.
 *
 * Before this existed the only way competitor keyword data entered the system
 * was a human clicking POST /api/keyword-intelligence/competitor-keywords by
 * hand — there was no cron, and `competitor_snapshots` held 2 rows in total.
 * That table is a per-run usage/summary log whose `top_keywords` JSON carries
 * no positions, so it cannot answer "who ranks where". This module writes
 * per-keyword competitor positions instead, which is what the head-to-head and
 * opportunity-gap tables need.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getRankedKeywords } from '@/lib/dataforseo/labs'
import type { RankedKeyword } from './comparisons'

/** Keep parity with keyword_snapshots so both sides of a comparison match. */
const SNAPSHOT_LIMIT = 200

/**
 * Cap on competitor domains fetched per client per week.
 *
 * Each domain is one paid DataForSEO call. CTS alone has 19 competitors
 * configured; fetching every one weekly for every client would multiply the
 * bill without improving the gap list, which is dominated by the closest few
 * rivals. Domains beyond the cap are skipped and reported.
 */
export const MAX_COMPETITORS_PER_CLIENT = 4

export interface CompetitorSnapshotClient {
  id: string
  domain: string
  semrush_db: string | null
  competitor_domains: string[] | null
}

export interface CompetitorSnapshotRow {
  client_id: string
  competitor_domain: string
  keyword: string
  position: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  cpc: number | null
  competition: number | null
  intent: string | null
  source: 'dataforseo'
  location_code: number
  semrush_db: string | null
  snapshot_date: string
  measured_at: string
}

export interface CompetitorSnapshotResult {
  client_id: string
  competitors_attempted: number
  competitors_succeeded: number
  keywords_seen: number
  snapshots_written: number
  skipped_domains: string[]
  errors: Array<{ domain: string; message: string }>
  /** Fresh rankings keyed by competitor domain, for in-memory comparison. */
  rankings: Record<string, RankedKeyword[]>
}

export function buildCompetitorSnapshotRows(
  clientId: string,
  competitorDomain: string,
  keywords: readonly RankedKeyword[],
  locationCode: number,
  semrushDb: string | null,
  measuredAt = new Date(),
): CompetitorSnapshotRow[] {
  const measuredAtIso = measuredAt.toISOString()
  const snapshotDate = measuredAtIso.slice(0, 10)

  const seen = new Set<string>()
  const rows: CompetitorSnapshotRow[] = []

  for (const kw of keywords) {
    const keyword = kw.keyword?.trim()
    if (!keyword) continue
    // The unique key is (client, competitor, keyword, location, date); a domain
    // ranking twice for one keyword would otherwise blow up the upsert.
    const dedupeKey = keyword.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    rows.push({
      client_id: clientId,
      competitor_domain: competitorDomain,
      keyword,
      position: kw.position ?? null,
      search_volume: kw.search_volume ?? null,
      keyword_difficulty: kw.keyword_difficulty ?? null,
      cpc: (kw as { cpc?: number | null }).cpc ?? null,
      competition: (kw as { competition?: number | null }).competition ?? null,
      intent: kw.intent ?? null,
      source: 'dataforseo',
      location_code: locationCode,
      semrush_db: semrushDb,
      snapshot_date: snapshotDate,
      measured_at: measuredAtIso,
    })
  }

  return rows
}

export async function snapshotCompetitorsForClient(
  client: CompetitorSnapshotClient,
  locationCode: number,
  maxCompetitors = MAX_COMPETITORS_PER_CLIENT,
): Promise<CompetitorSnapshotResult> {
  const configured = (client.competitor_domains ?? [])
    .map(d => (typeof d === 'string' ? d.trim().toLowerCase() : ''))
    .filter(Boolean)

  // De-duplicate: CTS has inspiringvacations.com listed twice.
  const unique = Array.from(new Set(configured))
  const selected = unique.slice(0, maxCompetitors)
  const skipped = unique.slice(maxCompetitors)

  const result: CompetitorSnapshotResult = {
    client_id: client.id,
    competitors_attempted: selected.length,
    competitors_succeeded: 0,
    keywords_seen: 0,
    snapshots_written: 0,
    skipped_domains: skipped,
    errors: [],
    rankings: {},
  }

  for (const domain of selected) {
    try {
      const keywords = await getRankedKeywords(domain, locationCode, SNAPSHOT_LIMIT)
      result.keywords_seen += keywords.length
      result.rankings[domain] = keywords

      const rows = buildCompetitorSnapshotRows(
        client.id, domain, keywords, locationCode, client.semrush_db,
      )
      if (rows.length === 0) {
        // A domain that genuinely ranks for nothing is a real answer, not a
        // failure — record it so the gap list does not silently shrink.
        result.competitors_succeeded += 1
        continue
      }

      const { data, error } = await supabaseAdmin
        .from('competitor_keyword_snapshots')
        .upsert(rows, {
          onConflict: 'client_id,competitor_domain,keyword,location_code,snapshot_date',
        })
        .select('id')

      if (error) throw new Error(error.message)

      result.competitors_succeeded += 1
      result.snapshots_written += data?.length ?? rows.length
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      result.errors.push({ domain, message })
    }
  }

  return result
}
