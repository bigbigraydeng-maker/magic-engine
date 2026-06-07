/**
 * POST /api/clients/[id]/cms/wordpress/yoast-probe
 *
 * P14.B.1 — Probe whether Yoast SEO meta keys are REST-writable on this
 * client's WordPress site, then persist the result to cms_connections.
 *
 * Returns:
 *   { success: true, writable: true }   — mu-plugin installed correctly
 *   { success: true, writable: false, reason: string }  — not installed
 *   { success: false, error: string, code: ... }         — fetch error
 *
 * How the probe works (see wordpress-client.ts for full details):
 *   1. GET /wp-json/wp/v2/posts?per_page=1&context=edit  — find a real post ID
 *   2. POST /wp-json/wp/v2/posts/{id} with meta._yoast_wpseo_title = <current value>
 *      (no-op write). 200 → keys registered; 403 → keys not registered.
 *
 * Security:
 *  - requirePaidClientAccess (tenant isolation)
 *  - Uses existing encrypted credentials — no password re-entry
 *  - DNS SSRF guard runs inside wordpress-client
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import { setYoastPluginInstalled } from '@/lib/cms/connection-store'
import { probeYoastMetaWritable } from '@/lib/cms/wordpress-client'

interface RouteContext {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const conn = await getWordpressConnection(clientId)
  if (!conn) {
    return NextResponse.json(
      { success: false, error: 'No WordPress connection found', code: 'NO_CONNECTION' },
      { status: 422 },
    )
  }
  if (conn.status !== 'connected') {
    return NextResponse.json(
      { success: false, error: 'WordPress connection not verified — test the connection first', code: 'NOT_CONNECTED' },
      { status: 422 },
    )
  }

  try {
    const result = await probeYoastMetaWritable({
      siteUrl:     conn.siteUrl,
      username:    conn.username,
      appPassword: conn.plainAppPassword,
    })

    // Persist regardless of outcome so the UI can reflect current state.
    await setYoastPluginInstalled(clientId, result.writable).catch(err => {
      console.error('[yoast-probe] persist failed (non-blocking):', err)
    })

    return NextResponse.json({
      success:  true,
      writable: result.writable,
      ...(result.reason ? { reason: result.reason } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[yoast-probe]', clientId, message)

    if (message.startsWith('WordPress ')) {
      return NextResponse.json(
        { success: false, error: message, code: 'WP_API_ERROR' },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { success: false, error: message, code: 'INTERNAL' },
      { status: 500 },
    )
  }
}
