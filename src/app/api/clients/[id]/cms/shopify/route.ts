/**
 * /api/clients/[id]/cms/shopify
 *
 *   GET    — return Shopify connection status (no access token)
 *   POST   — upsert Shopify connection (shop_url + access_token)
 *   DELETE — remove the Shopify connection for this client
 *
 * Security:
 *  - INTERNAL_API_KEY bearer required
 *  - shop_url is validated for HTTPS + public host before persistence
 *  - Access token is encrypted via AES-256-GCM, never echoed back
 *
 * Token scope required:
 *   write_content  (= write_blogs + write_pages)
 *
 * Phase 14.A.4 — Shopify connector CRUD. Publish flow ships in publish-shopify route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  upsertShopifyConnection,
  getShopifyConnectionStatus,
  getShopifyConnection,
  deleteShopifyConnection,
  markShopifyConnectionTested,
} from '@/lib/cms/connection-store'
import { testShopifyConnection } from '@/lib/cms/shopify-client'

interface RouteContext {
  params: { id: string }
}

function badInput(msg: string) {
  return NextResponse.json(
    { success: false, error: msg, code: 'INVALID_INPUT' },
    { status: 400 },
  )
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (!params.id) return badInput('client id required')

  try {
    const status = await getShopifyConnectionStatus(params.id)
    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cms/shopify GET]', params.id, message)
    return NextResponse.json(
      { success: false, error: 'Failed to load connection status', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

/**
 * Body: { shop_url: string, access_token: string, test?: boolean }
 * When test=true (default), validates the token against the Shopify API before saving.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (!params.id) return badInput('client id required')

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return badInput('Invalid JSON body')
  }

  const { shop_url, access_token, test: runTest = true } = body as {
    shop_url?:     unknown
    access_token?: unknown
    test?:         unknown
  }

  if (typeof shop_url !== 'string' || !shop_url.trim()) {
    return badInput('shop_url required')
  }
  if (typeof access_token !== 'string' || access_token.trim().length < 10) {
    return badInput('access_token required (min 10 chars)')
  }

  try {
    const status = await upsertShopifyConnection({
      clientId:   params.id,
      shopUrl:    shop_url.trim(),
      plainToken: access_token.trim(),
    })

    // Test connection immediately unless caller opts out.
    if (runTest !== false) {
      const conn = await getShopifyConnection(params.id)
      if (conn) {
        const testResult = await testShopifyConnection({
          shopUrl:     conn.shopUrl,
          accessToken: conn.plainToken,
        })
        await markShopifyConnectionTested(
          params.id,
          testResult.ok,
          testResult.ok ? undefined : testResult.error,
        )
        if (!testResult.ok) {
          return NextResponse.json(
            {
              success: false,
              error:   `Connection saved but token test failed: ${testResult.error}`,
              code:    'TOKEN_TEST_FAILED',
              data:    status,
            },
            { status: 422 },
          )
        }
        // Re-fetch with updated status.
        const refreshed = await getShopifyConnectionStatus(params.id)
        return NextResponse.json({ success: true, data: refreshed, shopName: testResult.shopName })
      }
    }

    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const looksLikeUserInput = message.startsWith('shop_url') || message.startsWith('access_token') || message.startsWith('Invalid')
    if (looksLikeUserInput) return badInput(message)

    console.error('[cms/shopify POST]', params.id, message)
    return NextResponse.json(
      { success: false, error: 'Failed to save connection', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (!params.id) return badInput('client id required')

  try {
    await deleteShopifyConnection(params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cms/shopify DELETE]', params.id, message)
    return NextResponse.json(
      { success: false, error: 'Failed to delete connection', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}
