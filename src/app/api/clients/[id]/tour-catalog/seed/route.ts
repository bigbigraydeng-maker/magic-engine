import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { fetchFirstPartyFeed, seedCatalog } from '@/lib/tour-catalog/seed'
import { firstPartyTourSourceUrl } from '@/lib/web-intelligence/first-party-tours'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/** Extract a non-empty string field from an unknown JSON body. */
function readStringField(body: unknown, field: string): string | null {
  if (body === null || typeof body !== 'object') return null
  const value = (body as Record<string, unknown>)[field]
  if (typeof value !== 'string' || value.trim() === '') return null
  return value
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params

  const access = await requireCatalogAdmin(clientId)
  if (!access.ok) return access.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'domain_required' }, { status: 400 })
  }

  const domain = readStringField(body, 'domain')
  if (domain === null) {
    return NextResponse.json({ error: 'domain_required' }, { status: 400 })
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
    console.error('tour_catalog_seed_failed', error)
    return NextResponse.json({ error: 'seed_failed' }, { status: 500 })
  }
}
