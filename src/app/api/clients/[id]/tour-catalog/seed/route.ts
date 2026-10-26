import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { fetchFirstPartyFeed, normalizeDomain, seedCatalog } from '@/lib/tour-catalog/seed'
import { getClientDomain } from '@/lib/tour-catalog/store'
import { firstPartyTourSourceUrl } from '@/lib/web-intelligence/first-party-tours'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'seed')
  if (!access.ok) return access.response

  // The site to read is the client's own configured domain, never a value from the request.
  let domain: string | null
  try {
    const stored = await getClientDomain(supabaseAdmin, clientId)
    domain = stored === null ? null : normalizeDomain(stored)
  } catch (error) {
    console.error('tour_catalog_client_domain_failed', error)
    return NextResponse.json({ error: 'seed_failed' }, { status: 500 })
  }
  if (domain === null || domain === '') {
    return NextResponse.json({ error: 'client_domain_missing' }, { status: 400 })
  }

  const feedUrl = firstPartyTourSourceUrl(domain)
  if (feedUrl === null) {
    return NextResponse.json({ error: 'feed_not_configured' }, { status: 400 })
  }

  let feed
  try {
    feed = await fetchFirstPartyFeed(feedUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    console.error('tour_catalog_feed_fetch_failed', message)
    if (message === 'feed_too_large') {
      return NextResponse.json({ error: 'feed_too_large' }, { status: 502 })
    }
    return NextResponse.json({ error: 'feed_unavailable' }, { status: 502 })
  }

  try {
    const result = await seedCatalog(supabaseAdmin, clientId, feed)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    // Refusals decided before anything is written: an old-shape feed, or a catalog that already has tours.
    const message = error instanceof Error ? error.message : ''
    if (message === 'feed_missing_content_fields') {
      return NextResponse.json({ error: 'feed_missing_content_fields' }, { status: 400 })
    }
    if (message === 'catalog_not_empty') {
      return NextResponse.json({ error: 'catalog_not_empty' }, { status: 409 })
    }
    console.error('tour_catalog_seed_failed', error)
    return NextResponse.json({ error: 'seed_failed' }, { status: 500 })
  }
}
