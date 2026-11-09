import { NextRequest, NextResponse } from 'next/server'
import { extractBearer, verifyApiKey } from '@/lib/auth/api-key-access'
import { supabaseAdmin } from '@/lib/supabase'
import { todayIso } from '@/lib/tour-catalog/dates'
import { loadPublished } from '@/lib/tour-catalog/store-publish'
import { toWebsiteTours } from '@/lib/tour-catalog/website-output'
import { META_ADS_SCOPE } from '@/lib/meta/ai/contract'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }

interface RouteContext {
  params: Promise<{ clientId: string }>
}

/**
 * Authenticated, read-only website projection of one client's latest published snapshot.
 * Draft data and internal departure fields never cross this boundary. The API key must
 * be locked to the same client in the path and use the existing read scope.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { clientId } = await params
  const bearer = extractBearer(request.headers.get('authorization'))
  const verification = await verifyApiKey(bearer, { expectedKind: 'client' })
  if (!verification.ok || verification.auth.kind !== 'client' || verification.auth.clientId !== clientId) {
    return NextResponse.json({ published: false, version: null, products: [] }, { status: 401, headers: NO_STORE_HEADERS })
  }
  if (!verification.auth.scopes.includes('read:all') || verification.auth.scopes.includes(META_ADS_SCOPE)) {
    return NextResponse.json({ published: false, version: null, products: [] }, { status: 403, headers: NO_STORE_HEADERS })
  }

  try {
    const catalog = await loadPublished(supabaseAdmin, clientId)
    if (!catalog.published) {
      return NextResponse.json(
        { published: false, version: null, products: [] },
        { status: 503, headers: NO_STORE_HEADERS },
      )
    }

    return NextResponse.json(
      {
        published: true,
        version: catalog.version,
        published_at: catalog.createdAt,
        products: toWebsiteTours(catalog.tours, catalog.departures, todayIso(new Date())),
      },
      { headers: { 'Cache-Control': 'private, max-age=0, must-revalidate', Vary: 'Authorization' } },
    )
  } catch (error) {
    console.error('public_tour_catalog_failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json(
      { published: false, version: null, products: [] },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
