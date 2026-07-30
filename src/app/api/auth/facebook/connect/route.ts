/**
 * GET /api/auth/facebook/connect?client_id=<uuid>
 *
 * Starts the Meta consent flow for one client. Builds a signed state token
 * (HMAC-SHA256, 10-min TTL) carrying the client id, then redirects to Meta.
 *
 * On success Meta redirects to /api/auth/facebook/callback with code + state.
 *
 * Replaces the manual step this used to require: generating a token by hand and
 * adding META_SYSTEM_USER_TOKEN_PAGE_<id> to Render for every new client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { buildState, buildAuthUrl } from '@/lib/meta-oauth/client'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }

  // Anyone who can reach this URL could otherwise start a consent flow that
  // attaches their Meta account to a client they have no business touching.
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let authUrl: string
  try {
    const redirectUri = `${appUrl()}/api/auth/facebook/callback`
    authUrl = buildAuthUrl(buildState(clientId), redirectUri)
  } catch (err) {
    // Missing app credentials — say which knob is missing rather than 500ing.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    )
  }

  return NextResponse.redirect(authUrl)
}
