/**
 * POST /api/admin/prospecting/discover
 *
 * Admin-only. Step 1 of the outbound pipeline: pull local business listings
 * for one industry × city seed and insert new rows into outbound_prospects.
 *
 * Body: { industry: string, city: string, limit?: number }
 *   - industry: key of INDUSTRY_CATEGORIES (e.g. "flooring")
 *   - city:     key of CITY_COORDS (e.g. "brisbane")
 *   - limit:    max businesses to pull (default 40, cap 60)
 *
 * Source: Google Places (see lib/places/business-discovery.ts). Results are
 * Google's relevance order, not review count.
 *
 * Async: the discovery query (text search + one Place Details per result)
 * can exceed the edge/gateway HTTP timeout (Cloudflare 502 at ~100s), so the
 * route returns 202 immediately and runs the pull + insert in the background
 * — the same fire-and-forget pattern the project uses for the Zhangqian scan.
 * The console polls the list for new rows; the background run writes a
 * cron_run_logs breadcrumb (job_name=prospecting_discover).
 *
 * Dedup: within the batch and against existing rows (by place_id, falling
 * back to domain), so re-running a seed is safe and only tops up new
 * listings. Cost: ~$0.5–$1 per seed (Places Details is billed per result).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import {
  INDUSTRY_CATEGORIES,
  CITY_COORDS,
  type BusinessListing,
} from '@/lib/dataforseo/business-listings'
// Discovery source: Google Places (no DataForSEO dependency, so it keeps
// working when the DataForSEO balance is exhausted). The DataForSEO
// business_listings wrapper stays available for a future switch-back.
import { discoverBusinessesViaPlaces } from '@/lib/places/business-discovery'

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

async function pullAndInsert(params: {
  coord: string
  country: 'AU' | 'NZ'
  industry: string
  city: string
  limit: number
}): Promise<{ discovered: number; inserted: number; noWebsite: number }> {
  const { coord, country, industry, city, limit } = params

  const listings = await discoverBusinessesViaPlaces({ industry, city, coord, country, limit })
  // Surface how many came back without a website — a spike here signals a
  // Places Details quota problem, not a genuine "no site" population.
  const noWebsite = listings.filter(l => !l.website_url && !l.domain).length
  const { unique } = dedupeBatch(listings)
  if (unique.length === 0) return { discovered: listings.length, inserted: 0, noWebsite }

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
  if (fresh.length === 0) return { discovered: listings.length, inserted: 0, noWebsite }

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
  return { discovered: listings.length, inserted: rows.length, noWebsite }
}

/**
 * Background worker with a diagnostic breadcrumb. A fire-and-forget worker's
 * errors otherwise only reach the platform console (invisible from here). The
 * cron_run_logs row distinguishes: no row = never ran (platform killed the
 * background task) / status=failed+error_message = ran but upstream failed /
 * stuck at running = killed mid-flight.
 */
async function runDiscovery(params: Parameters<typeof pullAndInsert>[0]): Promise<void> {
  const startedAt = Date.now()
  const { industry, city, limit } = params

  const { data: logRow } = await supabaseAdmin
    .from('cron_run_logs')
    .insert({
      job_name:   'prospecting_discover',
      status:     'running',
      started_at: new Date().toISOString(),
      summary:    { industry, city, limit },
    })
    .select('id')
    .single<{ id: string }>()
  const logId = logRow?.id ?? null

  const finish = (status: string, extra: Record<string, unknown>): Promise<void> =>
    logId
      ? supabaseAdmin.from('cron_run_logs')
          .update({ status, finished_at: new Date().toISOString(), duration_ms: Date.now() - startedAt, ...extra })
          .eq('id', logId)
          .then(() => undefined, () => undefined)
      : Promise.resolve()

  try {
    const { discovered, inserted, noWebsite } = await pullAndInsert(params)
    await finish('completed', {
      processed: discovered, completed_count: inserted,
      summary: { industry, city, discovered, inserted, no_website: noWebsite },
    })
  } catch (err) {
    await finish('failed', { error_message: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

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

  // Fire-and-forget so a slow discovery query cannot exceed the gateway
  // timeout. The console polls the list for the new rows.
  void runDiscovery({
    coord:    location.coord,
    country:  location.country,
    industry,
    city,
    limit:    Math.max(1, body?.limit ?? 40),
  }).catch(err => console.error('[prospecting/discover] background failure', err))

  return NextResponse.json({ started: true }, { status: 202 })
}
