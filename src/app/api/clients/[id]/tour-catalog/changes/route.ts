import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { listChanges, listChangesForTour } from '@/lib/tour-catalog/store-edit'
import { supabaseAdmin } from '@/lib/supabase'
import type { ChangesResponse } from '@/lib/tour-catalog/api-contract'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDS = 50

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAdmin(clientId)
  if (!access.ok) {
    return access.response
  }

  const ids = req.nextUrl.searchParams
    .getAll('entityId')
    .filter((id) => UUID_RE.test(id))
    .slice(0, MAX_IDS)

  // tourId (one uuid) returns the tour's whole history, including deleted departures.
  const tourId = req.nextUrl.searchParams.get('tourId')
  const validTourId = tourId !== null && UUID_RE.test(tourId) ? tourId : null

  try {
    const changes = validTourId
      ? await listChangesForTour(supabaseAdmin, clientId, validTourId, 50)
      : await listChanges(supabaseAdmin, clientId, ids, 50)
    return NextResponse.json<ChangesResponse>({ changes })
  } catch (err) {
    console.error('tour-catalog changes failed:', err)
    return NextResponse.json({ error: 'changes_failed' }, { status: 500 })
  }
}
