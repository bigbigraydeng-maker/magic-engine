/**
 * GA4 property picker.
 *
 *   GET   → which property is bound today + the choices under this client's
 *           connected Google account (live from Google; nothing to store).
 *   PATCH → bind a specific property.
 *
 * Mirrors /api/clients/[id]/gbp/locations/route.ts. No cross-client
 * exclusivity check here — see ga4/property.ts for why.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { getValidToken, PlatformConnectionNotFoundError } from '@/lib/platform-oauth/token-manager'
import { supabaseAdmin } from '@/lib/supabase'
import { listGa4Properties } from '@/lib/ga4/admin'
import { setGa4Property } from '@/lib/ga4/property'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data: conn } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('account_id')
    .eq('client_id', clientId)
    .eq('provider', 'google_ga4')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!conn) {
    return NextResponse.json({ connected: false, current: null, options: [] })
  }

  let accessToken: string
  try {
    accessToken = await getValidToken(clientId, 'google_ga4')
  } catch (err) {
    const reauth = err instanceof PlatformConnectionNotFoundError
    return NextResponse.json({
      connected: true,
      current: (conn as { account_id: string }).account_id,
      options: [],
      error: reauth ? 'needs_reauth' : 'google_unavailable',
    })
  }

  const result = await listGa4Properties(accessToken)
  if (!result.ok) {
    return NextResponse.json({
      connected: true,
      current: (conn as { account_id: string }).account_id,
      options: [],
      error: 'google_unavailable',
    })
  }

  return NextResponse.json({
    connected: true,
    current: (conn as { account_id: string }).account_id,
    options: result.properties.map((p) => ({
      property: p.property,
      display_name: p.displayName,
    })),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { property?: unknown }
  try {
    body = (await req.json()) as { property?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.property !== 'string' || !body.property.trim()) {
    return NextResponse.json({ error: '`property` is required' }, { status: 400 })
  }

  const result = await setGa4Property(clientId, body.property.trim())
  if (!result.ok) {
    const message =
      result.reason === 'not_connected'
        ? '这个客户还没连上 Google 网站数据。'
        : 'Property 编号格式不对。'
    return NextResponse.json({ error: message, reason: result.reason }, { status: 400 })
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({ success: true, property: body.property.trim() })
}
