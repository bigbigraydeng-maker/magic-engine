/**
 * /api/clients/[id]/platform/ga4
 *
 * Manage a client's Google Analytics 4 OAuth connections.
 *
 *   GET    → list active GA4 connections for this client
 *   DELETE → revoke a specific connection (?connectionId=)
 *
 * Mirrors platform/gbp/route.ts, including the provider filter on both GET
 * and DELETE — see that file's header comment for the 2026-08-03 incident
 * this guards against.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import {
  listConnections,
  getConnectionById,
  revokeConnection,
} from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

const GA4_PROVIDER = PLATFORM_PROVIDERS.GOOGLE_GA4

interface RouteContext {
  params: { id: string }
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const clientId = params.id

  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const connections = await listConnections(clientId)
  return NextResponse.json({
    connections: connections.filter((c) => c.provider === GA4_PROVIDER),
  })
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const clientId     = params.id
  const connectionId = req.nextUrl.searchParams.get('connectionId')

  if (!connectionId) {
    return NextResponse.json(
      { error: 'connectionId query param is required' },
      { status: 400 },
    )
  }

  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const row = await getConnectionById(connectionId)
  if (!row || row.client_id !== clientId || row.provider !== GA4_PROVIDER) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  await revokeConnection(connectionId)
  return NextResponse.json({ success: true })
}
