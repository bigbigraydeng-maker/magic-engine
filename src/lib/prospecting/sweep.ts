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

/**
 * First-wave focus list. The full catalogue in INDUSTRY_SEARCH_LABEL stays
 * intact; the sweep only *discovers* from these until we widen it. This is the
 * visual / renovation / local-trade cluster where our fastest SOP levers
 * (leak-fix + review engine + GBP + Meta video) all land, so the first
 * outreach wave has the strongest, fastest-to-results story.
 *
 * cosmetic_clinics added 2026-07-09; hvac / dentists / commercial_cleaning
 * added 2026-07-10 (PM go): all high-value Auckland local businesses that fit
 * the $990 fast-results playbook (trade search + GBP, or personal-brand nurture).
 *
 * Deliberately excluded here (present in the catalogue but not swept):
 *   - education_consultants / travel_agencies — skew to foreign / non-English
 *     markets, failing the "must serve NZ local English customers" rule.
 *   - lawyers / mortgage_brokers / accountants / solar — longer-consideration
 *     professional services; held for a later wave with a tailored authority
 *     angle. Widen via SWEEP_INDUSTRIES when ready.
 */
export const FOCUS_INDUSTRIES = [
  'kitchen_renovation', 'bathroom_renovation', 'builders', 'landscaping',
  'roofing', 'flooring', 'electricians', 'plumbers', 'cosmetic_clinics',
  'hvac', 'dentists', 'commercial_cleaning',
] as const

/**
 * First-wave city list. The $990 founding offer is Auckland-only (in-person
 * visits), so we stay inside Auckland — but search by AREA rather than one
 * Auckland-wide query. This (a) surfaces far more distinct local businesses
 * (each area returns its own top results) and (b) tags every prospect with the
 * area it was found in, so the outreach can name it ("...plumbers in West
 * Auckland..."), which lands better with a local operator. Still all Auckland,
 * so the visit promise holds. Widen via SWEEP_CITIES if the offer ever expands.
 */
export const FOCUS_CITIES = [
  'north_shore', 'west_auckland', 'south_auckland', 'east_auckland', 'central_auckland',
] as const

function envList(name: string, valid: (key: string) => boolean, fallback: readonly string[]): string[] {
  const raw = process.env[name]
  if (raw) {
    const picked = raw.split(',').map(s => s.trim()).filter(Boolean).filter(valid)
    if (picked.length > 0) return picked
  }
  return [...fallback]
}

/**
 * Active discover allow-lists: the SWEEP_INDUSTRIES / SWEEP_CITIES envs
 * (comma-separated keys) override the focus lists, so a second wave opens up
 * with an env change and no deploy. Unknown keys are dropped; an
 * empty/all-invalid override falls back to the focus list rather than
 * sweeping nothing.
 */
export function sweepIndustries(): string[] {
  return envList('SWEEP_INDUSTRIES', k => k in INDUSTRY_SEARCH_LABEL, FOCUS_INDUSTRIES)
}

export function sweepCities(): string[] {
  return envList('SWEEP_CITIES', k => k in CITY_COORDS, FOCUS_CITIES)
}

/**
 * Every active industry × active city seed pair. Both default to the
 * env-resolved allow-lists; tests pass explicit lists to stay deterministic.
 * Unknown keys are skipped so a stale env value can't inject a seed with no
 * Places search label / no city coordinates.
 */
export function buildCombos(
  industries: string[] = sweepIndustries(),
  cities: string[] = sweepCities(),
): Combo[] {
  const combos: Combo[] = []
  for (const industry of industries) {
    if (!(industry in INDUSTRY_SEARCH_LABEL)) continue
    for (const city of cities) {
      if (!(city in CITY_COORDS)) continue
      combos.push({ industry, city })
    }
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

/**
 * Pick the seed to discover next by LEAST-RECENTLY-ATTEMPTED (round-robin over
 * `lastAttempt`, epoch-ms per "industry|city"), not fewest-rows. This is the
 * 2026-07-10 stuck-loop fix: coverage-by-row-count fixates on a saturated seed
 * (Places returns the same ~20 already-inserted businesses) and never rotates,
 * burning a Places call every fire. Never-attempted combos (time 0) sort first.
 *
 * Returns null when even the least-recently-attempted combo was discovered
 * within `cooldownMs` — the whole universe was swept recently, so the cron
 * idles instead of re-hammering a saturated seed. It re-sweeps each combo once
 * the cooldown elapses, catching genuinely-new businesses without daily burn.
 */
export function pickDiscoverCombo(
  combos: Combo[],
  lastAttempt: Record<string, number>,
  nowMs: number,
  cooldownMs: number,
): Combo | null {
  if (combos.length === 0) return null
  let best = combos[0]
  let bestT = lastAttempt[`${best.industry}|${best.city}`] ?? 0
  for (const c of combos) {
    const t = lastAttempt[`${c.industry}|${c.city}`] ?? 0
    if (t < bestT) { best = c; bestT = t }
  }
  // Every combo attempted within the cooldown → idle (no Places spend).
  if (bestT > 0 && nowMs - bestT < cooldownMs) return null
  return best
}
