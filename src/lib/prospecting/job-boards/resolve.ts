/**
 * Single-company resolution via Google Places (HIGH-confidence only).
 *
 * BLOCKER H2 (魏征 review): resolving "one named company" is semantically
 * different from the existing industry×city bulk sweep. Places Text Search will
 * happily return an UNRELATED business for a vague name ("Kiwi NZ Venture"),
 * and a wrong match means a cold email to an innocent company — an
 * accident-level, irreversible outward action. Red line: prefer a miss (drop)
 * over a mismatch. We only accept a result that clears a confidence bar, and
 * we reject ambiguous top-2 ties. Contact email is ALWAYS taken from Places /
 * the real website downstream — never from the job posting (板桥 guardrail #2).
 */

import type { BusinessListing } from '@/lib/dataforseo/business-listings'
import { deriveIndustrySlug } from './locations'

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place'

export interface ResolveResult {
  listing:    BusinessListing
  /** Human-readable slug for the GEO probe (B1) — never a raw Places type. */
  industry_slug: string
  confidence: 'high'
  reason:     string
}

const LEGAL_GENERIC = new Set([
  'the', 'and', 'ltd', 'limited', 'pty', 'co', 'company', 'group', 'nz',
  'new', 'zealand', 'holdings', 'services', 'service', 'inc',
])

function tokens(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
}

/** Distinctive tokens = name tokens minus legal/generic filler. */
function distinctiveTokens(name: string): string[] {
  return tokens(name).filter(t => !LEGAL_GENERIC.has(t) && t.length > 1)
}

/**
 * Name-match strength between the job's company and a Places result. "strong"
 * requires ALL of the company's distinctive tokens to appear in the Places
 * name (order-independent) — so "Downlow Burgers" matches "Downlow Burgers
 * Mount Wellington" but not "Downlow Cafe". Exported for tests.
 */
export function nameMatchStrength(company: string, placeName: string): 'strong' | 'weak' | 'none' {
  const want = distinctiveTokens(company)
  if (want.length === 0) return 'none'
  const have = new Set(distinctiveTokens(placeName))
  const hits = want.filter(t => have.has(t)).length
  if (hits === want.length) return 'strong'
  if (hits >= Math.ceil(want.length / 2) && hits >= 1) return 'weak'
  return 'none'
}

interface PlaceSearchResult {
  place_id?: string
  name?: string
  rating?: number
  user_ratings_total?: number
  formatted_address?: string
  types?: string[]
}

interface PlaceDetail {
  website?: string
  formatted_phone_number?: string
}

function toDomain(website: string | undefined): string | null {
  if (!website) return null
  try { return new URL(website).hostname.replace(/^www\./, '') } catch { return null }
}

async function placesTextSearch(query: string, key: string): Promise<PlaceSearchResult[]> {
  const res = await fetch(`${PLACES_BASE}/textsearch/json?query=${encodeURIComponent(query)}&region=nz&key=${key}`)
  if (!res.ok) throw new Error(`Places text search HTTP ${res.status}`)
  const data = await res.json() as { results?: PlaceSearchResult[]; status: string; error_message?: string }
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Places text search: ${data.status}${data.error_message ? ` — ${data.error_message}` : ''}`)
  }
  return data.results ?? []
}

async function placeDetails(placeId: string, key: string): Promise<PlaceDetail | null> {
  const res = await fetch(
    `${PLACES_BASE}/details/json?place_id=${encodeURIComponent(placeId)}&fields=website,formatted_phone_number&key=${key}`,
  )
  if (!res.ok) return null
  const data = await res.json() as { result?: PlaceDetail; status: string }
  return data.status === 'OK' ? (data.result ?? null) : null
}

/**
 * Resolve one hiring company to a real business, or null. HIGH-confidence gate:
 *  - the top result must be a STRONG name match, AND
 *  - it must not be ambiguous (the #2 result must not also strongly match a
 *    different place_id).
 * Everything else is dropped (returned null) — we do not guess.
 */
export async function resolveCompanyViaPlaces(
  company: string,
  cityLabel: string,
): Promise<ResolveResult | { rejected: string }> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not configured')

  if (distinctiveTokens(company).length === 0) {
    return { rejected: 'company_name_too_generic' }
  }

  const query = `${company} ${cityLabel} New Zealand`
  const results = await placesTextSearch(query, key)
  if (results.length === 0) return { rejected: 'no_places_result' }

  const top = results[0]
  if (!top.place_id || !top.name) return { rejected: 'top_result_incomplete' }
  if (nameMatchStrength(company, top.name) !== 'strong') {
    return { rejected: `weak_name_match:${top.name}` }
  }

  // Ambiguity guard: a different second result also strongly matching means the
  // name is not distinctive enough to trust the top pick.
  const second = results[1]
  if (second?.place_id && second.place_id !== top.place_id && second.name &&
      nameMatchStrength(company, second.name) === 'strong') {
    return { rejected: 'ambiguous_multiple_strong_matches' }
  }

  const detail = await placeDetails(top.place_id, key)
  const listing: BusinessListing = {
    place_id:     top.place_id,
    name:         top.name,
    category:     top.types?.[0] ?? null,
    address:      top.formatted_address ?? null,
    city:         cityLabel,
    country_code: 'NZ',
    phone:        detail?.formatted_phone_number ?? null,
    website_url:  detail?.website ?? null,
    domain:       toDomain(detail?.website),
    rating:       top.rating ?? null,
    review_count: top.user_ratings_total ?? null,
    is_claimed:   false,
    raw:          { ...top, ...(detail ?? {}) },
  }
  return {
    listing,
    industry_slug: deriveIndustrySlug(top.types),
    confidence: 'high',
    reason: `strong_name_match:${top.name}`,
  }
}
