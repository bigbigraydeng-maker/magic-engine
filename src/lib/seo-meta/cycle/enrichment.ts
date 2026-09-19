/**
 * SEO Meta-Cycle v1 — step 2 enrichment.
 *
 * PM 2026-09-20 精简拍板: search volume + difficulty no longer cost a live
 * DataForSEO call — they're read from `keyword_snapshots`, which the
 * existing weekly patrol/snapshot job has already paid for
 * (getLatestKeywordSnapshotForClient). SERP (for competitor titles) is the
 * only remaining DataForSEO call, and it now runs ONLY for the final,
 * already-selected ≤maxPagesPerRun candidates — not the wide candidate
 * pool — so spend is structurally capped by config, not by a cross-client
 * circuit breaker (budget-guard.ts was deleted for exactly this reason).
 */

import { getLatestKeywordSnapshotForClient } from '@/lib/seo-intelligence/keyword-snapshots'
import { getSerpPage } from '@/lib/dataforseo/serp'
import type { MetaCycleCandidate } from './types'

/**
 * Fills searchVolume/keywordDifficulty from the client's latest keyword
 * snapshot for any candidate missing them (best-effort case-insensitive
 * keyword match — a miss just leaves the field null, same degrade as every
 * other keyword-matching path in this codebase). No network call: reads a
 * table the weekly snapshot job already populated.
 */
export async function enrichWithSnapshots(
  candidates: MetaCycleCandidate[],
  client: { id: string; domain: string; semrush_db: string | null },
): Promise<MetaCycleCandidate[]> {
  if (candidates.length === 0) return candidates
  const snapshot = await getLatestKeywordSnapshotForClient(client).catch(() => ({ keywords: [] as Array<{ keyword: string; search_volume: number | null; keyword_difficulty: number | null }> }))
  const byKeyword = new Map(snapshot.keywords.map((k) => [k.keyword.toLowerCase(), k]))

  return candidates.map((c) => {
    if (c.searchVolume !== null && c.keywordDifficulty !== null) return c
    const match = byKeyword.get(c.keyword.toLowerCase())
    if (!match) return c
    return {
      ...c,
      searchVolume: c.searchVolume ?? match.search_volume ?? null,
      keywordDifficulty: c.keywordDifficulty ?? match.keyword_difficulty ?? null,
    }
  })
}

/**
 * One SERP call per candidate — callers MUST pass only the final,
 * already-selected set (≤ config.maxPagesPerRun), never the wide pool.
 * Returns top-3 competitor page titles keyed by candidate keyword, for
 * step 4's AI prompt.
 */
export async function fetchCompetitorTitles(
  candidates: MetaCycleCandidate[],
  locationCode: number,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  for (const candidate of candidates) {
    try {
      const serp = await getSerpPage(candidate.keyword, locationCode === 2554 ? 'nz' : 'au')
      result.set(candidate.keyword, serp.organic_results.slice(0, 3).map((r) => r.title).filter((t): t is string => Boolean(t)))
    } catch (err) {
      console.warn(`[seo-meta-cycle] SERP enrichment failed for "${candidate.keyword}":`, err instanceof Error ? err.message : String(err))
      result.set(candidate.keyword, [])
    }
  }
  return result
}
