/**
 * /api/clients/[id]/platform/google-ads
 *
 *   GET → return the client's Google Ads platform_oauth_connection if any.
 *
 * Returns `{ connection: PlatformConnectionSummary | null }`. Frontend
 * settings panel renders connected / disconnected / error / needs_reconnect
 * states off `connection.status`.
 *
 * Auth: requirePaidClientAccess — session cookie + paid-plan check
 *       (mirrors /api/clients/[id]/platform/gbp).
 *
 * Phase 18.B.3 — Google Ads admin connection card
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { listConnections } from '@/lib/platform-oauth/connection-store'

interface RouteContext {
  params: { id: string }
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const clientId = params.id

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // listConnections returns rows ordered by created_at DESC, so the first
  // google_ads row is the most recent (matches GBP panel semantics).
  const connections = await listConnections(clientId)
  const connection = connections.find(c => c.provider === 'google_ads') ?? null

  return NextResponse.json({ connection })
}
