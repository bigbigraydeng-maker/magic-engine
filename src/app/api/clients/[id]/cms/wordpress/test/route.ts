/**
 * POST /api/clients/[id]/cms/wordpress/test
 *
 * Re-test the stored WordPress credentials without requiring the caller to
 * re-submit the plain Application Password. Reads the encrypted credential
 * from cms_connections, decrypts server-side, calls testWordpressConnection,
 * and updates last_tested_at + status.
 *
 * Returns: { success, ok, displayName?, roles?, error? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  getWordpressConnection,
  markWordpressConnectionTested,
} from '@/lib/cms/connection-store'
import { testWordpressConnection } from '@/lib/cms/wordpress-client'

interface RouteContext {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
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

  const conn = await getWordpressConnection(clientId).catch(() => null)
  if (!conn) {
    return NextResponse.json(
      { success: false, error: 'No WordPress connection found for this client', code: 'NO_CONNECTION' },
      { status: 404 },
    )
  }

  const result = await testWordpressConnection({
    siteUrl:     conn.siteUrl,
    username:    conn.username,
    appPassword: conn.plainAppPassword,
  })

  await markWordpressConnectionTested(clientId, result.ok, result.ok ? undefined : result.error)

  return NextResponse.json({
    success:     true,
    ok:          result.ok,
    displayName: result.displayName,
    roles:       result.roles,
    error:       result.error,
  })
}
