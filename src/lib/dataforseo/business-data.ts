/**
 * DataForSEO Business Data API — GMB + Google Reviews + Tripadvisor.
 *
 * Reference: ROADMAP.md P8.13.C.1
 *
 * Replaces the SerpAPI google_maps engine in local-reviews/client.ts:
 *   - getGmbInfo:           GMB place card (rating, review count, address, phone)
 *   - getGoogleReviews:     Individual Google reviews (text + rating + author)
 *   - getTripadvisorInfo:   Tripadvisor listing (rating, review count, URL)
 *
 * All functions return null on "not found" — non-fatal for 张骞.
 * Authentication: Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD).
 *
 * Estimated cost:
 *   - getGmbInfo:         ~$0.002 per call
 *   - getGoogleReviews:   ~$0.005 per call (1 depth unit = 10 reviews)
 *   - getTripadvisorInfo: ~$0.002 per call
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// ─── Return types ─────────────────────────────────────────────────────────────

export interface GmbInfo {
  /** Google Maps place_id (used for review lookups). null if not found. */
  place_id:     string | null
  name:         string
  address:      string | null
  phone:        string | null
  website:      string | null
  /** Overall star rating (1–5). null if no reviews. */
  rating:       number | null
  /** Total review count. null if unavailable. */
  review_count: number | null
  /** Google Maps URL for this listing. */
  maps_url:     string | null
}

export interface GoogleReview {
  rating: number
  text:   string
  date:   string | null
  author: string | null
}

export interface TripadvisorInfo {
  name:         string | null
  url:          string | null
  rating:       number | null
  review_count: number | null
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader(): string {
  const login    = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch a Google My Business place card for a business keyword.
 *
 * DataForSEO endpoint: /business_data/google/my_business_info/live
 *
 * @param keyword  Business search term, e.g. "Oztop Building Supplies Slacks Creek QLD"
 * @returns        GMB place card, or null if no match found.
 */
export async function getGmbInfo(keyword: string): Promise<GmbInfo | null> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/business_data/google/my_business_info/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, language_code: 'en' }]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO GMB info error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      status_code?: number
      result?: Array<{
        items?: Array<{
          place_id?:  string | null
          title?:     string | null
          address?:   string | null
          phone?:     string | null
          url?:       string | null
          maps_url?:  string | null
          rating?: {
            value?:       number | null
            votes_count?: number | null
          } | null
        }>
      }>
    }>
  }

  const item = json.tasks?.[0]?.result?.[0]?.items?.[0]
  if (!item) return null

  return {
    place_id:     item.place_id     ?? null,
    name:         item.title        ?? keyword,
    address:      item.address      ?? null,
    phone:        item.phone        ?? null,
    website:      item.url          ?? null,
    rating:       item.rating?.value       ?? null,
    review_count: item.rating?.votes_count ?? null,
    maps_url:     item.maps_url     ?? null,
  }
}

/**
 * Fetch individual Google reviews for a business keyword.
 *
 * DataForSEO endpoint: /business_data/google/reviews/live
 *
 * @param keyword  Same business search term as getGmbInfo
 * @param limit    Max reviews to return (default 10; each 10 = 1 depth unit)
 * @returns        Parsed review list, or null if not found.
 */
export async function getGoogleReviews(
  keyword: string,
  limit: number = 10,
): Promise<GoogleReview[] | null> {
  const depth = Math.max(1, Math.ceil(limit / 10))

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/business_data/google/reviews/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, depth, language_code: 'en', sort_by: 'newest' }]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO Google reviews error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          rating?: {
            value?: number | null
          } | null
          review_text?: string | null
          timestamp?:   string | null
          author_name?: string | null
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items
  if (!items || items.length === 0) return null

  return items
    .filter(it => typeof it.rating?.value === 'number')
    .slice(0, limit)
    .map(it => ({
      rating: it.rating!.value as number,
      text:   it.review_text?.trim() ?? '',
      date:   it.timestamp ?? null,
      author: it.author_name ?? null,
    }))
}

/**
 * Search for a Tripadvisor listing by keyword.
 * Intended for tourism-sector clients (CTS Tours).
 *
 * DataForSEO endpoint: /business_data/tripadvisor/search/live
 *
 * @param keyword  Business or attraction name, e.g. "CTS Tours New Zealand"
 * @returns        First matching Tripadvisor result, or null if not found.
 */
export async function getTripadvisorInfo(keyword: string): Promise<TripadvisorInfo | null> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/business_data/tripadvisor/search/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, language_name: 'English' }]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO Tripadvisor error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          title?:        string | null
          url?:          string | null
          rating?:       number | null
          reviews_count?: number | null
        }>
      }>
    }>
  }

  const item = json.tasks?.[0]?.result?.[0]?.items?.[0]
  if (!item) return null

  return {
    name:         item.title         ?? null,
    url:          item.url           ?? null,
    rating:       item.rating        ?? null,
    review_count: item.reviews_count ?? null,
  }
}
