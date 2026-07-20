/**
 * Location + industry normalisation for job-signal prospecting.
 *
 * BLOCKER B2 (魏征 review): outbound_prospects.city is a controlled CITY_COORDS
 * seed key downstream, NOT free text. A job posting's location ("Manurewa,
 * Auckland") must be mapped to the nearest seed key before insert, or it
 * pollutes coverageByCombo's industry|city buckets. The raw string is kept
 * only in raw_listing.hiring_signal.location_raw.
 *
 * BLOCKER B1 (魏征 review): outbound_prospects.industry feeds the GEO probe
 * label (analyze.ts INDUSTRY_LABELS[industry] ?? industry.replace(/_/g,' ')).
 * We must never write raw Google Places `types` (e.g. "point_of_interest").
 * deriveIndustrySlug returns a clean, human-readable slug or the readable
 * fallback 'local_business' → "local business".
 */

import { CITY_COORDS } from '@/lib/dataforseo/business-listings'

/** Fallback industry slug — readable via the analyze.ts `.replace(/_/g,' ')` path. */
export const JOB_SIGNAL_INDUSTRY_FALLBACK = 'local_business'

/**
 * NZ region (the part after the comma in a Seek location) → the CITY_COORDS
 * seed key we file the prospect under. Auckland is split by area downstream,
 * so Auckland-region postings map to central_auckland unless a finer suburb
 * hint is present (see AUCKLAND_AREA_HINTS).
 */
const REGION_TO_SEED: Record<string, string> = {
  auckland:        'central_auckland',
  wellington:      'wellington',
  canterbury:      'christchurch',
  waikato:         'hamilton',
  'bay of plenty': 'tauranga',
  otago:           'dunedin',
  'hawkes bay':    'napier',
  "hawke's bay":   'napier',
  manawatu:        'palmerston_north',
  'manawatu-whanganui': 'palmerston_north',
  tasman:          'nelson',
  nelson:          'nelson',
  taranaki:        'new_plymouth',
}

/** Suburb/area keyword → finer Auckland seed key (only within the Auckland region). */
const AUCKLAND_AREA_HINTS: Array<[RegExp, string]> = [
  [/manurewa|manukau|papakura|otahuhu|mangere|papatoetoe|takanini|south auckland/i, 'south_auckland'],
  [/henderson|west auckland|new lynn|te atatu|massey|glen eden/i, 'west_auckland'],
  [/takapuna|albany|north shore|devonport|glenfield|browns bay|rosedale/i, 'north_shore'],
  [/botany|howick|pakuranga|east tamaki|east auckland|flat bush/i, 'east_auckland'],
  [/cbd|central|newmarket|ponsonby|grey lynn|parnell|mount eden|grafton/i, 'central_auckland'],
]

/**
 * Map a free-text job location to a CITY_COORDS seed key, or null if it can't
 * be resolved to a known metro (caller drops or parks those — no free text in
 * the city column).
 */
export function normaliseLocationToSeedKey(locationRaw: string): string | null {
  const text = locationRaw.toLowerCase().trim()
  if (!text) return null

  // Region = the token after the last comma ("Manurewa, Auckland" → "auckland").
  const region = (text.includes(',') ? text.slice(text.lastIndexOf(',') + 1) : text).trim()
  const seed = REGION_TO_SEED[region]

  // Auckland: refine to a sub-area from the suburb hint when we have one.
  if (seed === 'central_auckland' || region === 'auckland') {
    for (const [pattern, areaSeed] of AUCKLAND_AREA_HINTS) {
      if (pattern.test(text)) return areaSeed
    }
    return 'central_auckland'
  }
  if (seed && seed in CITY_COORDS) return seed

  // Last resort: the whole string might itself be a known seed metro name.
  const direct = region.replace(/\s+/g, '_')
  return direct in CITY_COORDS ? direct : null
}

// Google Places `types` that carry no industry meaning — never used as a slug.
const GENERIC_PLACE_TYPES = new Set([
  'point_of_interest', 'establishment', 'store', 'food', 'health',
  'general_contractor', 'finance', 'premise', 'political',
])

/**
 * Derive a clean, human-readable industry slug for the GEO probe. Prefers the
 * first meaningful Google Places type; falls back to 'local_business'. Never
 * returns a raw generic Places type (B1).
 */
export function deriveIndustrySlug(placeTypes: string[] | null | undefined): string {
  for (const t of placeTypes ?? []) {
    const slug = t.toLowerCase().trim()
    if (slug && !GENERIC_PLACE_TYPES.has(slug)) return slug
  }
  return JOB_SIGNAL_INDUSTRY_FALLBACK
}
