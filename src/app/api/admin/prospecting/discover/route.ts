/**
 * POST /api/admin/prospecting/discover
 *
 * Admin-only. Step 1 of the outbound pipeline: pull local business listings
 * for one industry × city seed and insert new rows into outbound_prospects.
 *
 * Body: { industry: string, city: string, limit?: number, offset?: number }
 *   - industry: key of INDUSTRY_CATEGORIES (e.g. "flooring")
 *   - city:     key of CITY_COORDS (e.g. "brisbane")
 *   - offset:   pagination into the seed's result set (results are ordered
 *               by review count desc, so page deeper to go beyond the top 100)
 *
 * Async: the DataForSEO business_listings query can take longer than the
 * edge/gateway HTTP timeout (Cloudflare 502 at ~100s), so the route returns
 * 202 immediately and runs the pull + insert in the background — the same
 * fire-and-forget pattern the project uses for the Zhangqian scan. The
 * console polls the list for new rows.
 *
 * Dedup: within the batch and against existing rows (by place_id, falling
 * back to domain), so re-running a seed is safe and only tops up new
 * listings. Cost: ~$0.006 per call (up to 100 listings).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import {
  searchBusinessListings,
  INDUSTRY_CATEGORIES,
  CITY_COORDS,
  type BusinessListing,
} from '@/lib/dataforseo/business-listings'

/**
 * In-batch dedup: the same business can appear under several categories
 * (same place_id) or several branches can share one website (same domain).
 * Inserting such duplicates in one batch would trip the unique index and
 * fail the whole insert.
 */
function dedupeBatch(listings: BusinessListing[]): { unique: BusinessListing[]; unidentifiable: number } {
  const seenPlaceIds = new Set<string>()
  const seenDomains  = new Set<string>()
  const unique: BusinessListing[] = []
  let unidentifiable = 0

  for (const l of listings) {
    if (!l.place_id && !l.domain) { unidentifiable++; continue }
    if (l.place_id && seenPlaceIds.has(l.place_id)) continue
    if (l.domain && seenDomains.has(l.domain)) continue
    if (l.place_id) seenPlaceIds.add(l.place_id)
    if (l.domain) seenDomains.add(l.domain)
    unique.push(l)
  }
  return { unique, unidentifiable }
}

/** Background worker: pull listings, dedup against the table, insert new rows. */
async function runDiscovery(params: {
  categories: string[]
  coord: string
  country: 'AU' | 'NZ'
  industry: string
  city: string
  limit: number
  offset: number
}): Promise<void> {
  const { categories, coord, country, industry, city, limit, offset } = params

  const listings = await searchBusinessListings({ categories, coord, limit, offset })
  const { unique } = dedupeBatch(listings)
  if (unique.length === 0) return

  const placeIds = unique.map(l => l.place_id).filter((v): v is string => v !== null)
  const domains  = unique.map(l => l.domain).filter((v): v is string => v !== null)

  const [byPlace, byDomain] = await Promise.all([
    placeIds.length
      ? supabaseAdmin.from('outbound_prospects').select('place_id').in('place_id', placeIds)
      : Promise.resolve({ data: [], error: null }),
    domains.length
      ? supabaseAdmin.from('outbound_prospects').select('domain').in('domain', domains)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (byPlace.error) throw new Error(byPlace.error.message)
  if (byDomain.error) throw new Error(byDomain.error.message)

  const knownPlaceIds = new Set((byPlace.data ?? []).map(r => r.place_id as string))
  const knownDomains  = new Set((byDomain.data ?? []).map(r => r.domain as string))

  const fresh = unique.filter(l =>
    !(l.place_id && knownPlaceIds.has(l.place_id)) &&
    !(l.domain && knownDomains.has(l.domain)),
  )
  if (fresh.length === 0) return

  const rows = fresh.map(l => ({
    business_name: l.name,
    industry,
    city,
    country,
    domain:       l.domain,
    website_url:  l.website_url,
    phone:        l.phone,
    place_id:     l.place_id,
    rating:       l.rating,
    review_count: l.review_count,
    raw_listing:  l.raw,
    status:       'discovered',
  }))

  const { error } = await supabaseAdmin.from('outbound_prospects').insert(rows)
  if (error) throw new Error(error.message)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const body = await req.json().catch(() => null) as
    { industry?: string; city?: string; limit?: number; offset?: number } | null

  const industry = body?.industry ?? ''
  const city     = body?.city ?? ''
  const categories = INDUSTRY_CATEGORIES[industry]
  const location   = CITY_COORDS[city]

  if (!categories || !location) {
    return NextResponse.json(
      {
        error: 'Unknown industry or city seed',
        valid_industries: Object.keys(INDUSTRY_CATEGORIES),
        valid_cities: Object.keys(CITY_COORDS),
      },
      { status: 400 },
    )
  }

  // Fire-and-forget so a slow business_listings query cannot exceed the
  // gateway timeout. The console polls the list for the new rows.
  void runDiscovery({
    categories,
    coord:    location.coord,
    country:  location.country,
    industry,
    city,
    limit:    Math.max(1, body?.limit ?? 100),
    offset:   Math.max(0, body?.offset ?? 0),
  }).catch(err => console.error('[prospecting/discover] background failure', err))

  return NextResponse.json({ started: true }, { status: 202 })
}
