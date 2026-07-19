/**
 * DataForSEO Business Listings API — bulk local business discovery.
 *
 * Reference: ROADMAP.md Phase 35 (司马徽 outbound prospecting, Step 1).
 *
 * Unlike business-data.ts (single-business GMB lookups), this endpoint
 * searches Google Business listings in bulk by category + geo radius,
 * which is the discovery source for the outbound prospecting pipeline.
 *
 * Endpoint: /business_data/business_listings/search/live
 * Estimated cost: ~$0.006 per request (up to 100 listings per call).
 *
 * Authentication: Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD).
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// ─── Return types ─────────────────────────────────────────────────────────────

export interface BusinessListing {
  place_id:     string | null
  name:         string
  category:     string | null
  address:      string | null
  city:         string | null
  country_code: string | null
  phone:        string | null
  /** Website URL as listed on the profile. null = no website (a key signal). */
  website_url:  string | null
  /** Bare domain extracted from website_url. */
  domain:       string | null
  rating:       number | null
  review_count: number | null
  is_claimed:   boolean
  /** Raw listing item for later enrichment; stored verbatim in raw_listing. */
  raw:          Record<string, unknown>
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader(): string {
  const login    = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

// ─── Seed data: priority industries × AU/NZ cities ────────────────────────────

/**
 * Priority industry → DataForSEO business listings category ids.
 * Category ids follow the Google Business Profile taxonomy used by the
 * Business Listings API (snake_case). Multiple ids widen recall for
 * industries Google splits across categories.
 */
export const INDUSTRY_CATEGORIES: Record<string, string[]> = {
  flooring:            ['flooring_store', 'flooring_contractor'],
  builders:            ['general_contractor', 'home_builder'],
  roofing:             ['roofing_contractor'],
  kitchen_renovation:  ['kitchen_remodeler'],
  bathroom_renovation: ['bathroom_remodeler'],
  electricians:        ['electrician'],
  plumbers:            ['plumber'],
  hvac:                ['hvac_contractor', 'air_conditioning_contractor'],
  solar:               ['solar_energy_company', 'solar_energy_contractor'],
  dentists:            ['dentist', 'dental_clinic'],
  cosmetic_clinics:    ['skin_care_clinic', 'medical_spa'],
  lawyers:             ['lawyer', 'law_firm'],
  mortgage_brokers:    ['mortgage_broker'],
  accountants:         ['accountant', 'accounting_firm'],
  education_consultants: ['educational_consultant'],
  travel_agencies:     ['travel_agency'],
  landscaping:         ['landscaper', 'landscape_designer'],
  commercial_cleaning: ['commercial_cleaning_service', 'janitorial_service'],
}

/** AU/NZ target city → "lat,long" coordinate for the geo radius search. */
export const CITY_COORDS: Record<string, { coord: string; country: 'AU' | 'NZ' }> = {
  sydney:       { coord: '-33.8688,151.2093', country: 'AU' },
  melbourne:    { coord: '-37.8136,144.9631', country: 'AU' },
  brisbane:     { coord: '-27.4698,153.0251', country: 'AU' },
  perth:        { coord: '-31.9505,115.8605', country: 'AU' },
  adelaide:     { coord: '-34.9285,138.6007', country: 'AU' },
  gold_coast:   { coord: '-28.0167,153.4000', country: 'AU' },
  canberra:     { coord: '-35.2809,149.1300', country: 'AU' },
  newcastle:    { coord: '-32.9283,151.7817', country: 'AU' },
  auckland:     { coord: '-36.8485,174.7633', country: 'NZ' },
  // Auckland sub-areas — the $990 sweep searches by area so each prospect
  // carries the local area it was found in (e.g. "West Auckland"), which the
  // outreach then names back to the owner. Local businesses respond better to
  // a message that knows their patch. Coords display-only (Text Search uses
  // the query text).
  north_shore:      { coord: '-36.7830,174.7500', country: 'NZ' },
  west_auckland:    { coord: '-36.9000,174.6300', country: 'NZ' },
  south_auckland:   { coord: '-37.0000,174.8800', country: 'NZ' },
  east_auckland:    { coord: '-36.9100,174.9000', country: 'NZ' },
  central_auckland: { coord: '-36.8600,174.7600', country: 'NZ' },
  wellington:   { coord: '-41.2866,174.7756', country: 'NZ' },
  christchurch: { coord: '-43.5321,172.6362', country: 'NZ' },
  hamilton:     { coord: '-37.7870,175.2793', country: 'NZ' },
  // NZ-wide expansion (P35.12, 2026-07-14): the top metros beyond Auckland,
  // for the remote-delivery offer. Auckland stays split by area (finer-grained);
  // these smaller metros are one query each.
  tauranga:        { coord: '-37.6878,176.1651', country: 'NZ' },
  // Napier & Hastings are twin cities ~18km apart — separate search seeds, not
  // a "Napier Hastings" combined string (which is not a real place name).
  napier:          { coord: '-39.4928,176.9120', country: 'NZ' },
  hastings:        { coord: '-39.6395,176.8380', country: 'NZ' },
  palmerston_north:{ coord: '-40.3523,175.6082', country: 'NZ' },
  nelson:          { coord: '-41.2706,173.2840', country: 'NZ' },
  dunedin:         { coord: '-45.8788,170.5028', country: 'NZ' },
  rotorua:         { coord: '-38.1368,176.2497', country: 'NZ' },
  new_plymouth:    { coord: '-39.0556,174.0752', country: 'NZ' },
}

const DEFAULT_RADIUS_KM = 25
const MAX_LIMIT = 100

// ─── Response parsing ─────────────────────────────────────────────────────────

interface RawListingItem {
  place_id?:     string | null
  title?:        string | null
  category?:     string | null
  address?:      string | null
  address_info?: { city?: string | null; country_code?: string | null } | null
  phone?:        string | null
  url?:          string | null
  domain?:       string | null
  is_claimed?:   boolean | null
  rating?:       { value?: number | null; votes_count?: number | null } | null
  [key: string]: unknown
}

/** Normalise one raw Business Listings item. Exported for tests. */
export function parseListingItem(item: RawListingItem): BusinessListing | null {
  const name = item.title?.trim()
  if (!name) return null

  let domain = item.domain ?? null
  if (!domain && item.url) {
    try { domain = new URL(item.url).hostname.replace(/^www\./, '') } catch { domain = null }
  }

  return {
    place_id:     item.place_id ?? null,
    name,
    category:     item.category ?? null,
    address:      item.address ?? null,
    city:         item.address_info?.city ?? null,
    country_code: item.address_info?.country_code ?? null,
    phone:        item.phone ?? null,
    website_url:  item.url ?? null,
    domain,
    rating:       item.rating?.value ?? null,
    review_count: item.rating?.votes_count ?? null,
    is_claimed:   item.is_claimed ?? false,
    raw:          item as Record<string, unknown>,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search Google Business listings by category within a geo radius.
 *
 * @param params.categories  DataForSEO category ids (see INDUSTRY_CATEGORIES)
 * @param params.coord       "lat,long" centre point (see CITY_COORDS)
 * @param params.radiusKm    Search radius in km (default 25)
 * @param params.limit       Max listings to return (default/max 100)
 * @param params.offset      Pagination offset
 */
export async function searchBusinessListings(params: {
  categories: string[]
  coord: string
  radiusKm?: number
  limit?: number
  offset?: number
}): Promise<BusinessListing[]> {
  const { categories, coord, radiusKm = DEFAULT_RADIUS_KM, offset = 0 } = params
  const limit = Math.min(params.limit ?? MAX_LIMIT, MAX_LIMIT)

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/business_data/business_listings/search/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        categories,
        location_coordinate: `${coord},${radiusKm}`,
        limit,
        offset,
        order_by: ['rating.votes_count,desc'],
      }]),
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`DataForSEO business listings HTTP ${res.status}: ${body.slice(0, 200)}`)
  }

  // Read as text first: an auth/gateway failure can return an HTML page with
  // a 200, and a bare res.json() would throw an opaque "Unexpected token '<'".
  const rawText = await res.text()
  let json: {
    tasks?: Array<{
      status_code?: number
      status_message?: string
      result?: Array<{ items?: RawListingItem[] | null }>
    }>
  }
  try {
    json = JSON.parse(rawText)
  } catch {
    throw new Error(`DataForSEO returned non-JSON (HTTP ${res.status}): ${rawText.slice(0, 200)}`)
  }

  // DataForSEO returns HTTP 200 with a task-level error (bad category id,
  // exhausted balance, …). Surface it — an empty [] here is indistinguishable
  // from "no businesses in this city" and silently kills a whole seed.
  const task = json.tasks?.[0]
  if (task?.status_code !== undefined && task.status_code !== 20000) {
    throw new Error(
      `DataForSEO business listings task error ${task.status_code}: ${task.status_message ?? 'unknown'}`,
    )
  }

  const items = task?.result?.[0]?.items ?? []
  return items
    .map(parseListingItem)
    .filter((l): l is BusinessListing => l !== null)
}
