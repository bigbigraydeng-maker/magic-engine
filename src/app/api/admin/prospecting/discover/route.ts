/**
 * POST /api/admin/prospecting/discover
 *
 * Admin-only. Step 1 of the outbound pipeline: pull local business listings
 * for one industry × city seed and insert new rows into outbound_prospects.
 *
 * Body: { industry: string, city: string, limit?: number }
 *   - industry: key of INDUSTRY_CATEGORIES (e.g. "flooring")
 *   - city:     key of CITY_COORDS (e.g. "brisbane")
 *
 * Dedup: listings already present (by place_id, falling back to domain)
 * are skipped, so re-running a seed is safe and only tops up new listings.
 * Cost: ~$0.006 per call (up to 100 listings).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import {
  searchBusinessListings,
  INDUSTRY_CATEGORIES,
  CITY_COORDS,
} from '@/lib/dataforseo/business-listings'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const body = await req.json().catch(() => null) as
    { industry?: string; city?: string; limit?: number } | null

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

  const listings = await searchBusinessListings({
    categories,
    coord: location.coord,
    limit: body?.limit,
  })

  if (listings.length === 0) {
    return NextResponse.json({ discovered: 0, inserted: 0, skipped: 0 })
  }

  // Dedup against existing rows. place_id is the primary identity; domain
  // catches re-listings under a new place_id.
  const placeIds = listings.map(l => l.place_id).filter((v): v is string => v !== null)
  const domains  = listings.map(l => l.domain).filter((v): v is string => v !== null)

  const [byPlace, byDomain] = await Promise.all([
    placeIds.length
      ? supabaseAdmin.from('outbound_prospects').select('place_id').in('place_id', placeIds)
      : Promise.resolve({ data: [], error: null }),
    domains.length
      ? supabaseAdmin.from('outbound_prospects').select('domain').in('domain', domains)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (byPlace.error)  return NextResponse.json({ error: byPlace.error.message }, { status: 500 })
  if (byDomain.error) return NextResponse.json({ error: byDomain.error.message }, { status: 500 })

  const knownPlaceIds = new Set((byPlace.data ?? []).map(r => r.place_id as string))
  const knownDomains  = new Set((byDomain.data ?? []).map(r => r.domain as string))

  const fresh = listings.filter(l =>
    !(l.place_id && knownPlaceIds.has(l.place_id)) &&
    !(l.domain && knownDomains.has(l.domain)),
  )

  const rows = fresh.map(l => ({
    business_name: l.name,
    industry,
    city,
    country:      location.country,
    domain:       l.domain,
    website_url:  l.website_url,
    phone:        l.phone,
    place_id:     l.place_id,
    rating:       l.rating,
    review_count: l.review_count,
    raw_listing:  l.raw,
    status:       'discovered',
  }))

  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from('outbound_prospects').insert(rows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    discovered: listings.length,
    inserted:   rows.length,
    skipped:    listings.length - rows.length,
  })
}
