/**
 * GET /api/clients/[id]/cms/providers
 *
 * Return the connection status for all CMS providers at once.
 * Safe for the browser UI — tokens are never included.
 *
 * Response:
 *   {
 *     success: true,
 *     providers: {
 *       github:    CmsConnectionStatus | null,
 *       wordpress: WordpressConnectionStatus | null,
 *       shopify:   ShopifyConnectionStatus | null,
 *     }
 *   }
 *
 * Security: requires INTERNAL_API_KEY bearer token.
 *
 * Phase 14.A.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import {
  getConnectionStatus,
  getWordpressConnectionStatus,
  getShopifyConnectionStatus,
} from '@/lib/cms/connection-store'

interface RouteContext {
  params: { id: string }
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const clientId = params.id
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'client id required', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  try {
    const [github, wordpress, shopify] = await Promise.all([
      getConnectionStatus(clientId).catch(() => null),
      getWordpressConnectionStatus(clientId).catch(() => null),
      getShopifyConnectionStatus(clientId).catch(() => null),
    ])

    return NextResponse.json({ success: true, providers: { github, wordpress, shopify } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cms/providers GET]', clientId, message)
    return NextResponse.json(
      { success: false, error: 'Failed to load provider statuses', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}
