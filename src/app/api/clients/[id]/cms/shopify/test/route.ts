/**
 * POST /api/clients/[id]/cms/shopify/test
 *
 * Re-test the stored Shopify credentials without requiring the caller to
 * re-submit the plain access token. Reads the encrypted credential from
 * cms_connections, decrypts server-side, calls testShopifyConnection, and
 * updates last_tested_at + status.
 *
 * Returns: { success, ok, shopName?, error? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  getShopifyConnection,
  markShopifyConnectionTested,
} from '@/lib/cms/connection-store'
import { testShopifyConnection } from '@/lib/cms/shopify-client'

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

  const conn = await getShopifyConnection(clientId).catch(() => null)
  if (!conn) {
    return NextResponse.json(
      { success: false, error: 'No Shopify connection found for this client', code: 'NO_CONNECTION' },
      { status: 404 },
    )
  }

  const result = await testShopifyConnection({
    shopUrl:     conn.shopUrl,
    accessToken: conn.plainToken,
  })

  await markShopifyConnectionTested(clientId, result.ok, result.ok ? undefined : result.error)

  return NextResponse.json({
    success:  true,
    ok:       result.ok,
    shopName: result.shopName,
    error:    result.error,
  })
}
