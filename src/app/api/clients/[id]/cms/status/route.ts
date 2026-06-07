/**
 * GET /api/clients/[id]/cms/status
 *
 * Return the CMS connection status for a client — safe for the browser UI.
 * The PAT is NEVER included in this response (only token_last_four hint).
 *
 * Security: requires INTERNAL_API_KEY bearer token.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getConnectionStatus } from '@/lib/cms/connection-store'

interface RouteContext {
  params: { id: string }
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'client id required', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  try {
    const status = await getConnectionStatus(clientId)
    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cms/status GET]', clientId, message)
    return NextResponse.json(
      { success: false, error: 'Failed to load connection status', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}
