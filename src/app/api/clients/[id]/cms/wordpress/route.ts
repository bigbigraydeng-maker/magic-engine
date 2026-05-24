/**
 * /api/clients/[id]/cms/wordpress
 *
 *   GET    — return WordPress connection status (no Application Password)
 *   POST   — upsert WordPress connection (site_url + username + app_password)
 *   DELETE — remove the WordPress connection for this client
 *
 * Security:
 *  - INTERNAL_API_KEY bearer required
 *  - site_url is validated for HTTPS + public host before persistence
 *  - Application Password is encrypted via AES-256-GCM, never echoed back
 *
 * Phase 14.A.3 — connection-management UI surface. The actual REST API publish
 * loop ships in P14.A.5.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import {
  upsertWordpressConnection,
  getWordpressConnectionStatus,
  deleteWordpressConnection,
} from '@/lib/cms/connection-store'

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
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
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
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  if (!params.id) return badInput('client id required')

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return badInput('Invalid JSON body')
  }

  const { site_url, username, app_password } = body as {
    site_url?:     unknown
    username?:     unknown
    app_password?: unknown
  }

  if (typeof site_url !== 'string' || !site_url.trim()) {
    return badInput('site_url required')
  }
  if (typeof username !== 'string' || !username.trim()) {
    return badInput('username required')
  }
  if (typeof app_password !== 'string' || app_password.trim().length < 10) {
    return badInput('app_password required (min 10 chars)')
  }

  try {
    const status = await upsertWordpressConnection({
      clientId:         params.id,
      siteUrl:          site_url.trim(),
      username:         username.trim(),
      plainAppPassword: app_password.trim(),
    })
    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // url-guard / validation messages are safe to bubble back; DB errors are not.
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
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
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
