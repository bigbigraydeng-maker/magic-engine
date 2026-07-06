/**
 * Prospecting auto-sweep decision logic — pure, testable.
 *
 * Reference: ROADMAP.md Phase 35. The sweep cron fires often and advances the
 * outbound conveyor by ONE bounded step per fire (so a single fire never
 * outlives the cron timeout or over-spends). This module decides WHICH step to
 * run next and WHICH industry×city seed to discover, with no I/O.
 *
 * Priority: drain what's already in the pipeline before pulling more in —
 * audit → analyze → draft → discover. Sending is never automated (a human
 * approves every outreach email in the review queue).
 */

import { CITY_COORDS } from '@/lib/dataforseo/business-listings'
import { INDUSTRY_SEARCH_LABEL } from '@/lib/places/business-discovery'

export type SweepStage = 'audit' | 'analyze' | 'draft' | 'discover'

export interface QueueCounts {
  /** rows in `discovered` awaiting the rule audit */
  discovered: number
  /** rows in `qualified` awaiting AI analysis */
  qualified: number
  /** rows in `analyzed` (no error) awaiting an email draft */
  draftable: number
}

/**
 * Pick the next conveyor step. Drains existing work first so we don't keep
 * discovering thousands of businesses that never get audited.
 *
 * @param analyzeAllowed  false when the per-day AI budget is spent — the
 *                        analyze step is skipped so the conveyor still moves
 *                        (draft / discover) without further spend.
 */
export function pickStage(counts: QueueCounts, analyzeAllowed = true): SweepStage {
  if (counts.discovered > 0) return 'audit'
  if (counts.qualified > 0 && analyzeAllowed) return 'analyze'
  if (counts.draftable > 0) return 'draft'
  return 'discover'
}

export interface Combo { industry: string; city: string }

/** Every industry × NZ-city seed pair (NZ market first). */
export function buildCombos(): Combo[] {
  const cities = Object.keys(CITY_COORDS).filter(c => CITY_COORDS[c].country === 'NZ')
  const combos: Combo[] = []
  for (const industry of Object.keys(INDUSTRY_SEARCH_LABEL)) {
    for (const city of cities) combos.push({ industry, city })
  }
  return combos
}

/**
 * Pick the seed to discover next: the one with the FEWEST prospects already in
 * the DB, so coverage spreads evenly across all industry×city pairs instead of
 * hammering one. Ties break by declaration order (stable). `coverage` maps
 * `"industry|city"` → row count.
 */
export function leastCoveredCombo(combos: Combo[], coverage: Record<string, number>): Combo | null {
  if (combos.length === 0) return null
  let best = combos[0]
  let bestCount = coverage[`${best.industry}|${best.city}`] ?? 0
  for (const c of combos) {
    const n = coverage[`${c.industry}|${c.city}`] ?? 0
    if (n < bestCount) { best = c; bestCount = n }
  }
  return best
}
