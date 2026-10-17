/**
 * GET /api/auth/google/youtube/start?clientId={meClientId}&channelId={UC...}
 *
 * Starts the Google OAuth flow for YouTube publishing. The expected channel id
 * travels in the httpOnly state cookie; the callback refuses to store tokens
 * unless the authorised account manages exactly that channel.
 */

import { type NextRequest, NextResponse } from 'next/server'
import * as nodeCrypto from 'crypto'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { YOUTUBE_PUBLISH_SCOPES } from '@/lib/youtube-publish/client'
import {
  YOUTUBE_STATE_COOKIE,
  YOUTUBE_STATE_TTL_SECS,
  isValidChannelId,
} from '@/lib/youtube-publish/oauth'

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')
  const channelId = req.nextUrl.searchParams.get('channelId')
  if (!clientId) {
    return NextResponse.json({ error: 'clientId query param is required' }, { status: 400 })
  }
  if (!isValidChannelId(channelId)) {
    return NextResponse.json({ error: 'channelId must be a YouTube channel id (UC...)' }, { status: 400 })
  }

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
  if (!googleClientId) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID is not configured' }, { status: 500 })
  }
  if (!appUrl) {
    return NextResponse.json({ error: 'APP_URL / NEXT_PUBLIC_APP_URL is not configured' }, { status: 500 })
  }

  const nonce = nodeCrypto.randomBytes(16).toString('hex')
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', googleClientId)
  authUrl.searchParams.set('redirect_uri', `${appUrl}/api/auth/google/youtube/callback`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', YOUTUBE_PUBLISH_SCOPES.join(' '))
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', nonce)

  const response = NextResponse.redirect(authUrl.toString(), 302)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.headers.append(
    'Set-Cookie',
    `${YOUTUBE_STATE_COOKIE}=${nonce}:${clientId}:${channelId}; HttpOnly; SameSite=Lax; Max-Age=${YOUTUBE_STATE_TTL_SECS}; Path=/${secure}`,
  )
  return response
}
