/**
 * /api/clients/[id]/platform/gbp
 *
 * Manage a client's Google Business Profile OAuth connections.
 *
 *   GET    → list active GBP connections for this client
 *   DELETE → revoke a specific connection (?connectionId=)
 *
 * Auth: requireDashboardClientAccess — session cookie.
 * Tenant isolation on DELETE: verifies the connection's client_id matches
 * the route's [id] param before revoking.
 *
 * Phase 24.A.6
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  listConnections,
  getConnectionById,
  revokeConnection,
} from '@/lib/platform-oauth/connection-store'

interface RouteContext {
  params: { id: string }
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: RouteContext) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const connections = await listConnections(clientId)
  return NextResponse.json({ connections })
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const clientId     = params.id
  const connectionId = req.nextUrl.searchParams.get('connectionId')

  if (!connectionId) {
    return NextResponse.json(
      { error: 'connectionId query param is required' },
      { status: 400 },
    )
  }

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Tenant isolation: verify the connection belongs to this client
  const row = await getConnectionById(connectionId)
  if (!row || row.client_id !== clientId) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  await revokeConnection(connectionId)
  return NextResponse.json({ success: true })
}
