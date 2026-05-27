/**
 * /api/clients/[id]/cms/wordpress
 *
 *   GET    — return WordPress connection status (no Application Password)
 *   POST   — upsert WordPress connection (site_url + username + app_password)
 *             Immediately tests credentials against the WP REST API (unless test=false).
 *   DELETE — remove the WordPress connection for this client
 *
 * Security:
 *  - INTERNAL_API_KEY bearer required
 *  - site_url validated for HTTPS + public host before persistence (url-guard)
 *  - Application Password encrypted via AES-256-GCM, never echoed back
 *  - DNS SSRF guard runs at credential-test time via wordpress-client
 *
 * WP setup requirements (surfaced in UI, not enforced server-side):
 *  - Dedicated WP user (e.g. "magic-engine") with Author or Editor role
 *  - Application Password generated at WP Admin → Users → Profile
 *  - User must NOT have activate_plugins / edit_themes capabilities
 *
 * Phase 14.A.5 — adds credential-test + markWordpressConnectionTested
 * (Phase 14.A.3 shipped the basic CRUD skeleton)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  upsertWordpressConnection,
  getWordpressConnectionStatus,
  getWordpressConnection,
  deleteWordpressConnection,
  markWordpressConnectionTested,
} from '@/lib/cms/connection-store'
import { testWordpressConnection } from '@/lib/cms/wordpress-client'

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
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (!params.id) return badInput('client id required')

  try {
    const status = await getWordpressConnectionStatus(params.id)
    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cms/wordpress GET]', params.id, message)
    return NextResponse.json(
      { success: false, error: 'Failed to load connection status', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
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

  const { site_url, username, app_password, test: runTest = true } = body as {
    site_url?:     unknown
    username?:     unknown
    app_password?: unknown
    test?:         unknown
  }

  if (typeof site_url !== 'string' || !site_url.trim()) {
    return badInput('site_url required')
  }
  if (typeof username !== 'string' || !username.trim()) {
    return badInput('username required')
  }
  if (typeof app_password !== 'string' || app_password.replace(/\s+/g, '').length < 10) {
    return badInput('app_password required (min 10 chars excluding spaces)')
  }

  try {
    const status = await upsertWordpressConnection({
      clientId:         params.id,
      siteUrl:          site_url.trim(),
      username:         username.trim(),
      plainAppPassword: app_password.trim(),
    })

    // Immediately test credentials against the WP REST API unless opted out.
    if (runTest !== false) {
      const conn = await getWordpressConnection(params.id)
      if (conn) {
        const testResult = await testWordpressConnection({
          siteUrl:     conn.siteUrl,
          username:    conn.username,
          appPassword: conn.plainAppPassword,
        })
        await markWordpressConnectionTested(
          params.id,
          testResult.ok,
          testResult.ok ? undefined : testResult.error,
        )
        if (!testResult.ok) {
          return NextResponse.json(
            {
              success: false,
              error:   `Connection saved but credential test failed: ${testResult.error}`,
              code:    'TOKEN_TEST_FAILED',
              data:    status,
            },
            { status: 422 },
          )
        }
        const refreshed = await getWordpressConnectionStatus(params.id)
        return NextResponse.json({
          success:     true,
          data:        refreshed,
          displayName: testResult.displayName,
          roles:       testResult.roles,
        })
      }
    }

    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const looksLikeUserInput =
      message.startsWith('site_url') ||
      message.startsWith('username') ||
      message.startsWith('app_password') ||
      message.startsWith('Invalid')
    if (looksLikeUserInput) return badInput(message)

    console.error('[cms/wordpress POST]', params.id, message)
    return NextResponse.json(
      { success: false, error: 'Failed to save connection', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (!params.id) return badInput('client id required')

  try {
    await deleteWordpressConnection(params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cms/wordpress DELETE]', params.id, message)
    return NextResponse.json(
      { success: false, error: 'Failed to delete connection', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}
