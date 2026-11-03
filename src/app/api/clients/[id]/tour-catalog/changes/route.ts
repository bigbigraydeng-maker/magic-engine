import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { listChanges, listChangesForTour, listRecentChanges } from '@/lib/tour-catalog/store-edit'
import type { ChangeLogEntry } from '@/lib/tour-catalog/store-edit'
import { listMemberEmails } from '@/lib/tour-catalog/store-access'
import { loadDraftCatalog } from '@/lib/tour-catalog/store'
import {
  buildChangeViews,
  makeActorLabeler,
  redactEntryForEditor,
  type ActorLabeler,
} from '@/lib/tour-catalog/changes-view'
import { supabaseAdmin } from '@/lib/supabase'
import type { ChangesResponse } from '@/lib/tour-catalog/api-contract'
import type { CatalogChangesResponse, CatalogRole } from '@/lib/tour-catalog/catalog-contract'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDS = 50
/** Raw rows read for the whole-catalog view; one import can be hundreds of rows before collapsing. */
const RECENT_ROW_LIMIT = 1000

/** Admins see emails as they are; client editors see only their own colleagues' emails. */
async function labelerFor(clientId: string, role: CatalogRole, viewerEmail: string): Promise<ActorLabeler> {
  const members = role === 'me_admin' ? new Set<string>() : await listMemberEmails(supabaseAdmin, clientId)
  return makeActorLabeler(role, members, viewerEmail)
}

async function catalogWideChanges(clientId: string, label: ActorLabeler): Promise<CatalogChangesResponse> {
  const entries = await listRecentChanges(supabaseAdmin, clientId, RECENT_ROW_LIMIT)
  const snapshot = await loadDraftCatalog(supabaseAdmin, clientId)
  const tourNames = new Map(snapshot.tours.map((tour) => [tour.id, tour.name]))
  return { changes: buildChangeViews(entries, { tourNames, label }) }
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'view')
  if (!access.ok) {
    return access.response
  }
  const role = access.viewer.role

  const search = req.nextUrl.searchParams
  const ids = search
    .getAll('entityId')
    .filter((id) => UUID_RE.test(id))
    .slice(0, MAX_IDS)

  // tourId (one uuid) returns the tour's whole history, including deleted departures.
  const tourId = search.get('tourId')
  const validTourId = tourId !== null && UUID_RE.test(tourId) ? tourId : null

  try {
    const label = await labelerFor(clientId, role, access.viewer.email)
    // Neither tourId nor entityId: the whole catalog, newest first, an import collapsed into one line.
    if (tourId === null && !search.has('entityId')) {
      return NextResponse.json<CatalogChangesResponse>(await catalogWideChanges(clientId, label))
    }
    const raw: ChangeLogEntry[] = validTourId
      ? await listChangesForTour(supabaseAdmin, clientId, validTourId, 50)
      : await listChanges(supabaseAdmin, clientId, ids, 50)
    const changes = role === 'me_admin' ? raw : raw.map((entry) => redactEntryForEditor(entry, label))
    return NextResponse.json<ChangesResponse>({ changes })
  } catch (err) {
    console.error('tour-catalog changes failed:', err)
    return NextResponse.json({ error: 'changes_failed' }, { status: 500 })
  }
}
