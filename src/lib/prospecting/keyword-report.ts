/**
 * "What your customers are searching" — the keyword deliverable for a $19.90
 * onboarding client (P35.12). Built ON DEMAND for a paying onboarding prospect,
 * never for every cold prospect, so DataForSEO spend stays tiny (~15 clients a
 * round, not thousands of audits).
 *
 * Returns a client-safe shape (plain phrase + monthly volume + an easy/medium/
 * hard band — never the raw 0–100 difficulty or CPC) and degrades to [] on any
 * failure (e.g. DataForSEO out of balance), so the delivery page simply omits
 * the section rather than breaking.
 */

import { getKeywordsForSite } from '@/lib/dataforseo/labs'

export interface KeywordReportItem {
  phrase:     string
  /** Monthly Google search volume in the business's country. */
  volume:     number
  difficulty: 'easy' | 'medium' | 'hard'
}

// AU=2036, NZ=2554 (matches dataforseo client.ts LOCATION_CODE_BY_DB).
const LOCATION_CODE: Record<string, number> = { NZ: 2554, AU: 2036 }

/** Client-safe band from DataForSEO's 0–100 keyword_difficulty (null → medium). */
export function difficultyBand(kd: number | null): KeywordReportItem['difficulty'] {
  if (kd == null) return 'medium'
  if (kd < 30) return 'easy'
  if (kd < 60) return 'medium'
  return 'hard'
}

/**
 * Top local search terms the business's own site already surfaces for, highest
 * volume first. `domain` null / no site → []. Never throws.
 */
export async function buildKeywordReport(
  domain: string | null,
  country: string,
  limit = 8,
): Promise<KeywordReportItem[]> {
  if (!domain) return []
  try {
    const kws = await getKeywordsForSite(domain, LOCATION_CODE[country] ?? LOCATION_CODE.AU, 40)
    return kws
      .filter(k => k.keyword && (k.search_volume ?? 0) > 0)
      .slice(0, limit)
      .map(k => ({
        phrase:     k.keyword,
        volume:     k.search_volume ?? 0,
        difficulty: difficultyBand(k.keyword_difficulty),
      }))
  } catch {
    return []
  }
}
