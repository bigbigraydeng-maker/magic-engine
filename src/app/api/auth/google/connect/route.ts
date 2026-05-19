/**
 * GET /api/auth/google/connect?client_id=<uuid>
 *
 * Initiates the Google OAuth 2.0 flow for a client. Builds a signed state
 * token (HMAC-SHA256, 10-min TTL), then redirects to Google's consent screen.
 *
 * On success Google redirects to /api/auth/google/callback with code + state.
 *
 * Scopes requested: webmasters.readonly (GSC) + email (display only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildState, buildAuthUrl } from '@/lib/google-oauth/client'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }

  const redirectUri = `${appUrl()}/api/auth/google/callback`
  const state       = buildState(clientId)
  const authUrl     = buildAuthUrl(state, redirectUri)

  return NextResponse.redirect(authUrl)
}
