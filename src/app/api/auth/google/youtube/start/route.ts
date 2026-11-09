/**
 * GET /api/auth/google/youtube/start?clientId={meClientId}
 *
 * Starts customer-scoped Google OAuth. An existing channel remains locked;
 * a first-time channel can only be discovered from the consented account.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { readClientChannelTarget } from '@/lib/youtube-publish/store'
import { YOUTUBE_PUBLISH_SCOPES } from '@/lib/youtube-publish/client'
import {
  YOUTUBE_STATE_COOKIE,
  YOUTUBE_STATE_PATH,
  YOUTUBE_STATE_TTL_SECS,
  buildYoutubeState,
} from '@/lib/youtube-publish/oauth'

function back(clientId: string, outcome: 'target_review' | 'unavailable'): NextResponse {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3001'
  const url = new URL(`/dashboard/clients/${clientId}/settings`, origin)
  url.search = new URLSearchParams({ tab: 'connect', section: 'social-connections', youtube: outcome }).toString()
  const response = NextResponse.redirect(url)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'clientId query param is required' }, { status: 400 })
  }

  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let target: Awaited<ReturnType<typeof readClientChannelTarget>>
  try { target = await readClientChannelTarget(clientId) }
  catch { return back(clientId, 'unavailable') }
  if (target.kind === 'missing' || target.kind === 'invalid') return back(clientId, 'target_review')

  const googleClientId = process.env.GOOGLE_CLIENT_ID
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
  if (!googleClientId || !googleSecret || !appUrl) return back(clientId, 'unavailable')

  const state = buildYoutubeState({ clientId, userId: access.user.id,
    targetChannelId: target.kind === 'configured' ? target.channelId : null }, googleSecret)
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', googleClientId)
  authUrl.searchParams.set('redirect_uri', `${appUrl}/api/auth/google/youtube/callback`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', YOUTUBE_PUBLISH_SCOPES.join(' '))
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authUrl.toString(), 302)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.cookies.set(YOUTUBE_STATE_COOKIE, state, { httpOnly: true,
    secure: new URL(appUrl).protocol === 'https:', sameSite: 'lax',
    path: YOUTUBE_STATE_PATH, maxAge: YOUTUBE_STATE_TTL_SECS })
  return response
}
