/**
 * Google Business Profile storefront picker.
 *
 *   GET   → which storefront is bound today + the choices under this client's
 *           Google account (live from Google; nothing to store).
 *   PATCH → bind a specific storefront.
 *
 * WHY THIS EXISTS
 * ---------------
 * Auto-resolution deliberately refuses to guess when several storefronts sit
 * under one Google account. Without this route the only fix would be editing
 * the database by hand — which CLAUDE.md forbids for FDE/PM config. This is
 * the UI-backed write path for `platform_oauth_connections.location_name`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getGbpAccessToken, loadGbpConnection } from '@/lib/gbp/auth'
import { listGbpLocations, composeLocationResource, setGbpLocation } from '@/lib/gbp/location'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const connection = await loadGbpConnection(clientId)
  if (!connection) {
    return NextResponse.json({ connected: false, current: null, options: [] })
  }

  const auth = await getGbpAccessToken(clientId)
  if (!auth.ok) {
    return NextResponse.json({
      connected: true,
      current: connection.location_name,
      options: [],
      error: 'needs_reauth',
    })
  }

  const candidates = await listGbpLocations(auth.connection.account_id, auth.accessToken)
  if (candidates === null) {
    return NextResponse.json({
      connected: true,
      current: connection.location_name,
      options: [],
      error: 'google_unavailable',
    })
  }

  // Storefronts already bound to a different ME client are shown but locked —
  // seeing why an option is unavailable beats it silently missing.
  const { data: taken } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('client_id, location_name')
    .eq('provider', 'google_gbp')
    .neq('client_id', clientId)
    .not('location_name', 'is', null)

  const takenSet = new Set(
    ((taken ?? []) as Array<{ location_name: string }>).map((t) => t.location_name),
  )

  return NextResponse.json({
    connected: true,
    current: connection.location_name,
    options: candidates.map((c) => {
      const resource = composeLocationResource(auth.connection.account_id, c.name)
      return {
        location_name: resource,
        title: c.title,
        website: c.websiteUri,
        taken_by_other_client: takenSet.has(resource),
      }
    }),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  // Which storefront a client's public posts land on is an ME operations
  // decision, not a client-side one (same rule as the monitoring gates).
  if (access.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: { location_name?: unknown }
  try {
    body = (await req.json()) as { location_name?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.location_name !== 'string' || !body.location_name.trim()) {
    return NextResponse.json({ error: '`location_name` is required' }, { status: 400 })
  }

  const result = await setGbpLocation(clientId, body.location_name.trim())
  if (!result.ok) {
    const message =
      result.reason === 'taken_by_other'
        ? '这家门店已经绑给另一个客户了，不能共用。'
        : result.reason === 'not_connected'
          ? '这个客户还没连上 Google 商家页。'
          : '门店编号格式不对。'
    return NextResponse.json({ error: message, reason: result.reason }, { status: 400 })
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({ success: true, location_name: body.location_name.trim() })
}
