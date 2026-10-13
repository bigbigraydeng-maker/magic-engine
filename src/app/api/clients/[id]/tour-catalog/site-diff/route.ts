import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { fetchFirstPartyFeed, normalizeDomain } from '@/lib/tour-catalog/seed'
import { getClientDomain, loadDraftCatalog } from '@/lib/tour-catalog/store'
import { diffWebsiteVsCatalog, feedReadNotes } from '@/lib/tour-catalog/site-diff'
import { toWebsiteTours } from '@/lib/tour-catalog/website-output'
import { todayIso } from '@/lib/tour-catalog/dates'
import { firstPartyTourSourceUrl } from '@/lib/web-intelligence/first-party-tours'
import { supabaseAdmin } from '@/lib/supabase'
import type { SiteDiffErrorCode, SiteDiffResponse } from '@/lib/tour-catalog/catalog-contract'

export const dynamic = 'force-dynamic'

function fail(error: SiteDiffErrorCode, status: number): NextResponse {
  return NextResponse.json({ error }, { status })
}

/**
 * GET: "compare with what the website shows now" (design §6.11.1 item 11). Reads the client's own
 * website feed — the address comes from the client's registered domain, never from the request —
 * and compares it field by field with the DRAFT catalog in website shape. Read-only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'manage_settings')
  if (!access.ok) return access.response

  let feedUrl: string | null
  try {
    const stored = await getClientDomain(supabaseAdmin, clientId)
    const domain = stored === null ? '' : normalizeDomain(stored)
    feedUrl = domain === '' ? null : firstPartyTourSourceUrl(domain)
  } catch (error) {
    console.error('tour_catalog_site_diff_domain_failed', error)
    return fail('diff_failed', 500)
  }
  if (feedUrl === null) return fail('no_domain', 400)

  let feed
  try {
    feed = await fetchFirstPartyFeed(feedUrl)
  } catch (error) {
    console.error('tour_catalog_site_diff_feed_failed', error instanceof Error ? error.message : 'unknown_error')
    return fail('feed_unavailable', 502)
  }

  try {
    const snapshot = await loadDraftCatalog(supabaseAdmin, clientId)
    const today = todayIso(new Date())
    const catalogTours = toWebsiteTours(snapshot.tours, snapshot.departures, today)
    const diff = diffWebsiteVsCatalog(feed.products, catalogTours, today)
    return NextResponse.json<SiteDiffResponse>({
      websiteTours: feed.products.length,
      catalogTours: catalogTours.length,
      ...diff,
      notes: feedReadNotes(feed),
    })
  } catch (error) {
    console.error('tour_catalog_site_diff_failed', error)
    return fail('diff_failed', 500)
  }
}
