/**
 * SEO Meta-Cycle v1 — step 2 DataForSEO enrichment (search volume,
 * difficulty, top-3 SERP competitor domains).
 *
 * Bounded call shape per client per week:
 *   1 batched search-volume call (all candidate keywords together)
 * + up to `candidates.length` SERP calls (one per candidate — spec §4 step 2
 *   explicitly asks for per-candidate SERP, this is the call the global
 *   budget guard in budget-guard.ts is watching).
 *
 * `bulkKeywordVolume` (dataforseo/labs.ts) is a known-broken endpoint (404,
 * see that file's header comment) — this uses search-volume.ts's
 * `getSearchVolume` instead, which is the working endpoint.
 */

import { getSearchVolume } from '@/lib/dataforseo/search-volume'
import { getSerpPage } from '@/lib/dataforseo/serp'
import type { MetaCycleCandidate } from './types'

export interface EnrichedCandidate {
  candidate: MetaCycleCandidate
  top3CompetitorDomains: string[]
  /** Same top-3 SERP results' page titles — carried through to step 4's AI title generation so the competitive context this call already paid for actually gets used, not just the skip-check in step 3. */
  top3CompetitorTitles: string[]
}

export interface EnrichmentResult {
  enriched: EnrichedCandidate[]
  dataforseoCallsMade: number
}

/**
 * Mutates nothing — returns enriched copies. `budgetRemaining` caps how many
 * SERP calls this client may make this run (the cross-client circuit
 * breaker in budget-guard.ts); candidates beyond the remaining budget are
 * returned with an empty competitor list rather than dropped, so the
 * prescription step still sees them (as `skip`-eligible if difficulty data
 * is present from the batched volume call, or as a lower-confidence
 * title_rewrite otherwise) instead of silently vanishing.
 */
export async function enrichCandidates(
  candidates: MetaCycleCandidate[],
  locationCode: number,
  budgetRemaining: number,
): Promise<EnrichmentResult> {
  if (candidates.length === 0) return { enriched: [], dataforseoCallsMade: 0 }

  let callsMade = 0
  const volumeByKeyword = new Map<string, number | null>()
  try {
    const volumes = await getSearchVolume(
      candidates.map((c) => c.keyword),
      locationCode,
    )
    callsMade += 1
    for (const v of volumes) volumeByKeyword.set(v.keyword.toLowerCase(), v.searchVolume)
  } catch (err) {
    console.warn('[seo-meta-cycle] search volume enrichment failed, continuing without it:', err instanceof Error ? err.message : String(err))
  }

  const enriched: EnrichedCandidate[] = []
  let serpCallsRemaining = Math.max(0, budgetRemaining - callsMade)

  for (const candidate of candidates) {
    const searchVolume = candidate.searchVolume ?? volumeByKeyword.get(candidate.keyword.toLowerCase()) ?? null

    let top3CompetitorDomains: string[] = []
    let top3CompetitorTitles: string[] = []
    if (serpCallsRemaining > 0) {
      try {
        const serp = await getSerpPage(candidate.keyword, locationCode === 2554 ? 'nz' : 'au')
        callsMade += 1
        serpCallsRemaining -= 1
        const top3 = serp.organic_results.slice(0, 3)
        top3CompetitorDomains = top3.map((r) => {
          try {
            return new URL(r.url).hostname
          } catch {
            return r.url
          }
        })
        top3CompetitorTitles = top3.map((r) => r.title).filter((t): t is string => Boolean(t))
      } catch (err) {
        console.warn(`[seo-meta-cycle] SERP enrichment failed for "${candidate.keyword}":`, err instanceof Error ? err.message : String(err))
      }
    }

    enriched.push({
      candidate: { ...candidate, searchVolume },
      top3CompetitorDomains,
      top3CompetitorTitles,
    })
  }

  return { enriched, dataforseoCallsMade: callsMade }
}
