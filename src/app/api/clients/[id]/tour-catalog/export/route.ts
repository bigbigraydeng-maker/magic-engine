import { NextResponse, type NextRequest } from 'next/server'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { loadDraftCatalog } from '@/lib/tour-catalog/store'
import { toursToCsv } from '@/lib/tour-catalog/export-csv'
import { todayIso } from '@/lib/tour-catalog/dates'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET: every tour of the working copy as an Excel-friendly CSV download.
 * Read-only and open to the same people who may view the catalog; departure `internal` facts are
 * never written to the file (see toursToCsv).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'view')
  if (!access.ok) return access.response

  try {
    const snapshot = await loadDraftCatalog(supabaseAdmin, clientId)
    const today = todayIso(new Date())
    const csv = toursToCsv(snapshot.tours, snapshot.departures, today)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tours-${today}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('tour_catalog_export_failed', error)
    return NextResponse.json({ error: 'export_failed' }, { status: 500 })
  }
}
