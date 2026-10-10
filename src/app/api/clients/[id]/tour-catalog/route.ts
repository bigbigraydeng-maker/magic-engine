import { NextResponse, type NextRequest } from 'next/server'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { getClientDomain, loadDraftCatalog, listRecentBatches } from '@/lib/tour-catalog/store'
import { normalizeDomain } from '@/lib/tour-catalog/seed'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/** GET: return the full catalog snapshot plus recent import batches. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params

  const access = await requireCatalogAdmin(clientId)
  if (!access.ok) {
    return access.response
  }

  try {
    const snapshot = await loadDraftCatalog(supabaseAdmin, clientId)
    const batches = await listRecentBatches(supabaseAdmin, clientId, 20)
    const storedDomain = await getClientDomain(supabaseAdmin, clientId)
    return NextResponse.json({
      tours: snapshot.tours,
      departures: snapshot.departures,
      aliases: snapshot.aliases,
      batches,
      domain: storedDomain === null ? null : normalizeDomain(storedDomain),
    })
  } catch (error) {
    console.error('catalog_load_failed', error)
    return NextResponse.json({ error: 'catalog_load_failed' }, { status: 500 })
  }
}
