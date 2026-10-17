/**
 * GET /api/auth/google/youtube/callback?code=...&state=...
 *
 * Exchanges the code, verifies the authorised account manages the expected
 * channel (exact id match), and only then stores the connection.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  YOUTUBE_STATE_COOKIE,
  isValidChannelId,
  persistYoutubeConnection,
} from '@/lib/youtube-publish/oauth'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

function destination(appUrl: string, clientId: string, result: string, reason?: string): NextResponse {
  const url = new URL(`/dashboard/clients/${clientId}/settings`, appUrl)
  url.searchParams.set('youtube', result)
  if (reason) url.searchParams.set('reason', reason)
  const response = NextResponse.redirect(url.toString(), 302)
  response.headers.append('Set-Cookie', `${YOUTUBE_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`)
  return response
}

export async function GET(req: NextRequest) {
  const rawCookie = req.cookies.get(YOUTUBE_STATE_COOKIE)?.value
  if (!rawCookie) {
    return NextResponse.json(
      { error: 'State cookie missing or expired — please restart the connection flow' },
      { status: 400 },
    )
  }
  const [nonce, clientId, channelId] = rawCookie.split(':')
  const code = req.nextUrl.searchParams.get('code')
  if (!code) {
    return NextResponse.json({ error: 'Authorization code missing from callback' }, { status: 400 })
  }
  if (req.nextUrl.searchParams.get('state') !== nonce) {
    return NextResponse.json({ error: 'CSRF state mismatch' }, { status: 400 })
  }
  if (!clientId || !isValidChannelId(channelId)) {
    return NextResponse.json({ error: 'State cookie malformed' }, { status: 400 })
  }

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? ''
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: `${appUrl}/api/auth/google/youtube/callback`,
      grant_type: 'authorization_code',
    }).toString(),
  })
  if (!tokenRes.ok) return destination(appUrl, clientId, 'error', 'token_exchange_failed')

  const tokens = (await tokenRes.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }
  if (!tokens.access_token || !tokens.refresh_token) {
    return destination(appUrl, clientId, 'error', 'token_exchange_failed')
  }

  const persisted = await persistYoutubeConnection({
    clientId,
    expectedChannelId: channelId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresInSec: tokens.expires_in ?? 3600,
    scope: tokens.scope ?? '',
  })
  if (!persisted.ok) return destination(appUrl, clientId, 'error', persisted.reason)
  return destination(appUrl, clientId, 'connected')
}
