import { NextResponse, type NextRequest } from 'next/server'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { getClientDomain, loadDraftCatalog, listRecentBatches } from '@/lib/tour-catalog/store'
import {
  getClientName,
  getPendingPublishRequest,
  getSettings,
  listMemberEmails,
} from '@/lib/tour-catalog/store-access'
import { makeActorLabeler, trimDepartureForViewer } from '@/lib/tour-catalog/changes-view'
import { normalizeDomain } from '@/lib/tour-catalog/seed'
import { collectImagePool, imageHostSuggestions } from '@/lib/tour-catalog/image-rules'
import { supabaseAdmin } from '@/lib/supabase'
import type { CatalogAccessEnvelope, PublishRequestView } from '@/lib/tour-catalog/catalog-contract'

export const dynamic = 'force-dynamic'

/** A client editor sees who asked only when it is one of their own colleagues. */
async function pendingRequestFor(
  clientId: string,
  role: CatalogAccessEnvelope['viewer']['role'],
  viewerEmail: string,
): Promise<PublishRequestView | null> {
  const pending = await getPendingPublishRequest(supabaseAdmin, clientId)
  if (pending === null || role === 'me_admin') return pending
  const label = makeActorLabeler(role, await listMemberEmails(supabaseAdmin, clientId), viewerEmail)
  return { ...pending, requestedBy: label(pending.requestedBy.trim().toLowerCase()) }
}

/**
 * GET: the working copy plus who is looking and what they may do.
 * Trimmed on the server by permission: import batches and name aliases only for those who may use
 * them, and operational `internal` facts on departures never reach a client editor.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'view')
  if (!access.ok) {
    return access.response
  }
  const { permissions, viewer } = access

  try {
    const snapshot = await loadDraftCatalog(supabaseAdmin, clientId)
    const batches = permissions.import ? await listRecentBatches(supabaseAdmin, clientId, 20) : []
    const storedDomain = await getClientDomain(supabaseAdmin, clientId)
    const settings = await getSettings(supabaseAdmin, clientId)
    const envelope: CatalogAccessEnvelope = {
      clientName: await getClientName(supabaseAdmin, clientId),
      viewer,
      permissions,
      settings,
      pendingPublishRequest: await pendingRequestFor(clientId, viewer.role, viewer.email),
    }
    const departures = snapshot.departures.map((departure) => trimDepartureForViewer(viewer.role, departure))
    return NextResponse.json({
      tours: snapshot.tours,
      departures,
      aliases: permissions.aliases ? snapshot.aliases : [],
      batches,
      domain: storedDomain === null ? null : normalizeDomain(storedDomain),
      // Every image address the draft already uses: client editors may only pick from these.
      imagePool: collectImagePool(snapshot.tours),
      ...(permissions.manage_settings
        ? { imageHostSuggestions: imageHostSuggestions(snapshot.tours, settings.imageHosts, storedDomain) }
        : {}),
      ...envelope,
    })
  } catch (error) {
    console.error('catalog_load_failed', error)
    return NextResponse.json({ error: 'catalog_load_failed' }, { status: 500 })
  }
}
