/**
 * /api/clients/[id]/gbp/reviews
 *
 * Fetch and archive Google Business Profile reviews for a client.
 *
 *   GET → pulls GBP reviews from Google Places API using the client's
 *         businessName + city + country fields, returns structured review
 *         objects with full review text ready for content generation.
 *
 * The response includes an `archived_at` ISO timestamp so callers can
 * treat this as a point-in-time snapshot (screenshots / downstream prompts).
 *
 * Auth: requireDashboardClientAccess
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getBusinessReviewDetails } from '@/lib/places/client'
import type { GBPReview } from '@/lib/places/client'

interface RouteContext {
  params: { id: string }
}

export interface GBPReviewsResponse {
  placeId: string
  businessName: string
  rating: number
  totalReviews: number
  reviews: GBPReview[]
  archived_at: string
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Fetch client name/city/country to build a rich GBP query
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('name, city, country')
    .eq('id', clientId)
    .single()

  if (clientErr || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json(
      { error: 'GOOGLE_PLACES_API_KEY not configured' },
      { status: 503 },
    )
  }

  // Build rich query: "CTS Tours Auckland NZ" style
  const parts: string[] = [client.name]
  if (client.city) parts.push(client.city)
  if (client.country) parts.push(client.country)
  const query = parts.join(' ')

  let details
  try {
    details = await getBusinessReviewDetails(query)
  } catch (err) {
    console.error('[gbp/reviews] Places API error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch GBP reviews. Check GOOGLE_PLACES_API_KEY.' },
      { status: 502 },
    )
  }

  if (!details) {
    return NextResponse.json(
      { error: `No GBP listing found for query: "${query}"` },
      { status: 404 },
    )
  }

  const response: GBPReviewsResponse = {
    placeId: details.placeId,
    businessName: details.name,
    rating: details.rating,
    totalReviews: details.totalReviews,
    reviews: details.reviews,
    archived_at: new Date().toISOString(),
  }

  return NextResponse.json(response)
}
