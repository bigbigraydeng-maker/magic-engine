/**
 * Google Places business discovery — DataForSEO-free source for Step 1 of
 * the outbound prospecting pipeline.
 *
 * Reference: ROADMAP.md Phase 35. Used when DataForSEO business_listings is
 * unavailable (e.g. HTTP 402 / no balance). Returns the same BusinessListing
 * shape so the discover route is source-agnostic.
 *
 * Cost: Text Search (~$0.032/page, up to 3 pages) + one Place Details call
 * per result (~$0.017) for website + phone — roughly $0.5–$1 per seed.
 * Uses the existing GOOGLE_PLACES_API_KEY.
 */

import type { BusinessListing } from '@/lib/dataforseo/business-listings'

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place'
const MAX_PAGES = 3
const MAX_LIMIT = 60
const PAGE_TOKEN_DELAY_MS = 2000   // Google requires a short wait before a page token activates
const SEARCH_RADIUS_M = 25_000

/**
 * Industry seed key → plain-language Places search term. Keys MUST stay in
 * sync with INDUSTRY_CATEGORIES in business-listings.ts (the dropdown source).
 */
export const INDUSTRY_SEARCH_LABEL: Record<string, string> = {
  flooring:            'flooring store',
  builders:            'home builder',
  roofing:             'roofing contractor',
  kitchen_renovation:  'kitchen renovation',
  bathroom_renovation: 'bathroom renovation',
  electricians:        'electrician',
  plumbers:            'plumber',
  hvac:                'air conditioning service',
  solar:               'solar installer',
  dentists:            'dentist',
  cosmetic_clinics:    'cosmetic clinic',
  lawyers:             'law firm',
  mortgage_brokers:    'mortgage broker',
  accountants:         'accountant',
  education_consultants: 'education consultant',
  travel_agencies:     'travel agency',
  landscaping:         'landscaping',
  commercial_cleaning: 'commercial cleaning',
}

const COUNTRY_NAME: Record<'AU' | 'NZ', string> = { AU: 'Australia', NZ: 'New Zealand' }

// Text Search only soft-biases by location, so national chains / big-box
// retailers leak in. Drop the obvious ones — they are never Digital
// Foundation prospects. (Coarse first-pass filter; finer category filtering
// is a follow-up.)
const CHAIN_BLOCKLIST =
  /\b(bunnings|ikea|beacon lighting|harvey norman|the good guys|officeworks|kmart|target|big ?w|freedom|amart|nick scali|carpet ?court|choices flooring|andersens)\b/i

// Google Places Details statuses that mean "stop, the whole run will fail"
// (quota / auth) rather than "this one business has no detail".
const FATAL_DETAIL_STATUSES = new Set(['OVER_QUERY_LIMIT', 'REQUEST_DENIED'])

/** "gold_coast" → "Gold Coast" */
function cityDisplay(key: string): string {
  return key.split('_').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}

function toDomain(website: string | undefined | null): string | null {
  if (!website) return null
  try { return new URL(website).hostname.replace(/^www\./, '') } catch { return null }
}

interface PlaceSearchResult {
  place_id?: string
  name?: string
  rating?: number
  user_ratings_total?: number
  formatted_address?: string
  types?: string[]
  [key: string]: unknown
}

interface PlaceDetail {
  website?: string
  formatted_phone_number?: string
  business_status?: string
}

/** Normalise one Places result + optional detail into a BusinessListing. Exported for tests. */
export function toListing(
  place: PlaceSearchResult,
  detail: PlaceDetail | null,
  cityLabel: string,
  country: 'AU' | 'NZ',
  fallbackCategory: string,
): BusinessListing | null {
  if (!place.place_id || !place.name) return null
  return {
    place_id:     place.place_id,
    name:         place.name,
    category:     place.types?.[0] ?? fallbackCategory,
    address:      place.formatted_address ?? null,
    city:         cityLabel,
    country_code: country,
    phone:        detail?.formatted_phone_number ?? null,
    website_url:  detail?.website ?? null,
    domain:       toDomain(detail?.website),
    rating:       place.rating ?? null,
    review_count: place.user_ratings_total ?? null,
    // The Places free tier does not expose real GBP claim status —
    // business_status means "operating", not "claimed". Don't fake it.
    is_claimed:   false,
    raw:          { ...place, ...(detail ?? {}) },
  }
}

/**
 * Fetch website + phone for one place.
 * - null       → this business genuinely has no detail (NOT_FOUND etc.)
 * - throws      → quota/auth failure: the whole run should fail loudly, not
 *                 silently mark every remaining business as "no website"
 */
async function fetchDetails(placeId: string, key: string): Promise<PlaceDetail | null> {
  const fields = 'website,formatted_phone_number,business_status'
  const res = await fetch(
    `${PLACES_BASE}/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${key}`,
  )
  if (!res.ok) return null   // transient network blip — skip this one, keep going
  const data = await res.json() as { result?: PlaceDetail; status: string; error_message?: string }
  if (data.status === 'OK') return data.result ?? null
  if (FATAL_DETAIL_STATUSES.has(data.status)) {
    throw new Error(`Places details ${data.status}${data.error_message ? ` — ${data.error_message}` : ''}`)
  }
  return null
}

/**
 * Discover local businesses for one industry × city seed via Google Places.
 *
 * @param params.industry  seed key (must be in INDUSTRY_SEARCH_LABEL)
 * @param params.city       seed key (e.g. "brisbane")
 * @param params.coord      "lat,long" centre for the location bias
 * @param params.country    'AU' | 'NZ'
 * @param params.limit      max businesses (default 20, cap 60)
 */
export async function discoverBusinessesViaPlaces(params: {
  industry: string
  city: string
  coord: string
  country: 'AU' | 'NZ'
  limit?: number
}): Promise<BusinessListing[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not configured')

  const label = INDUSTRY_SEARCH_LABEL[params.industry]
  if (!label) throw new Error(`No Places search label for industry: ${params.industry}`)

  const limit = Math.min(params.limit ?? 20, MAX_LIMIT)
  const cityLabel = cityDisplay(params.city)
  const query = `${label} in ${cityLabel}, ${COUNTRY_NAME[params.country]}`

  const results: PlaceSearchResult[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES && results.length < limit; page++) {
    const url = pageToken
      ? `${PLACES_BASE}/textsearch/json?pagetoken=${encodeURIComponent(pageToken)}&key=${key}`
      : `${PLACES_BASE}/textsearch/json?query=${encodeURIComponent(query)}&location=${encodeURIComponent(params.coord)}&radius=${SEARCH_RADIUS_M}&key=${key}`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Places text search HTTP ${res.status}`)
    const data = await res.json() as {
      results?: PlaceSearchResult[]
      status: string
      error_message?: string
      next_page_token?: string
    }
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Places text search: ${data.status}${data.error_message ? ` — ${data.error_message}` : ''}`)
    }
    results.push(...(data.results ?? []))
    if (!data.next_page_token) break
    pageToken = data.next_page_token
    await new Promise(r => setTimeout(r, PAGE_TOKEN_DELAY_MS))
  }

  const sliced = results.slice(0, limit)
  const listings: BusinessListing[] = []
  for (const place of sliced) {
    if (!place.place_id || !place.name) continue
    if (CHAIN_BLOCKLIST.test(place.name)) continue   // drop national chains / big-box
    // No .catch here: a quota/auth failure from fetchDetails must abort the
    // run (→ cron_run_logs failed) instead of silently producing website-less
    // rows that all fail qualification.
    const detail = await fetchDetails(place.place_id, key)
    const listing = toListing(place, detail, cityLabel, params.country, label)
    if (listing) listings.push(listing)
  }
  return listings
}
