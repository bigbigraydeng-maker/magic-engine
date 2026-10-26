/** Google consent callback: customer-scoped, channel-locked and fail-closed. */
import { type NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { discoverSingleAuthorizedChannel } from '@/lib/youtube-publish/client'
import { claimClientChannelTarget, readClientChannelTarget } from '@/lib/youtube-publish/store'
import { YOUTUBE_STATE_COOKIE, YOUTUBE_STATE_PATH, persistYoutubeConnection,
  verifyYoutubeState, type YoutubeState } from '@/lib/youtube-publish/oauth'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
type Outcome = 'connected' | 'cancelled' | 'bad_state' | 'target_changed' | 'no_channel'
  | 'multiple_channels' | 'channel_mismatch' | 'scope_missing' | 'verify_failed' | 'save_failed'

function back(clientId: string | null, outcome: Outcome, clear = true): NextResponse {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3001'
  const path = clientId ? `/dashboard/clients/${clientId}/settings` : '/dashboard'
  const url = new URL(path, origin)
  url.searchParams.set('tab', 'connect')
  url.searchParams.set('section', 'social-connections')
  url.searchParams.set('youtube', outcome)
  const response = NextResponse.redirect(url)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  // An old callback must not erase a newer browser attempt.
  if (clear) response.cookies.set(YOUTUBE_STATE_COOKIE, '', { httpOnly: true,
    secure: url.protocol === 'https:', sameSite: 'lax', path: YOUTUBE_STATE_PATH, maxAge: 0 })
  return response
}

async function sameActor(context: YoutubeState): Promise<boolean> {
  const access = await requireOnboardingClientAccess(context.clientId)
  return access.ok && access.user.id === context.userId
}

async function sameTarget(context: YoutubeState): Promise<boolean> {
  const current = await readClientChannelTarget(context.clientId)
  return context.targetChannelId === null ? current.kind === 'empty'
    : current.kind === 'configured' && current.channelId === context.targetChannelId
}

async function exchangeCode(code: string, origin: string, appId: string, appSecret: string): Promise<{
  access_token: string; refresh_token: string; tokenExpiry: Date; scope: string
} | null> {
  const response = await fetch(TOKEN_URL, { method: 'POST', cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: appId,
      client_secret: appSecret,
      redirect_uri: `${origin}/api/auth/google/youtube/callback`, grant_type: 'authorization_code' }).toString() })
  if (!response.ok) return null
  const data = await response.json() as Record<string, unknown>
  if (typeof data.access_token !== 'string' || !data.access_token ||
    typeof data.refresh_token !== 'string' || !data.refresh_token ||
    typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) ||
    data.expires_in <= 0 || data.expires_in > 86400 || typeof data.scope !== 'string') return null
  return { access_token: data.access_token, refresh_token: data.refresh_token,
    scope: data.scope, tokenExpiry: new Date(Date.now() + data.expires_in * 1000) }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const state = req.nextUrl.searchParams.get('state')
  if (!state || req.cookies.get(YOUTUBE_STATE_COOKIE)?.value !== state) return back(null, 'bad_state', false)
  const secret = process.env.GOOGLE_CLIENT_SECRET
  const context = secret && verifyYoutubeState(state, secret)
  if (!context) return back(null, 'bad_state')
  const { clientId } = context
  try {
    if (!(await sameActor(context))) return back(null, 'bad_state')
    if (!(await sameTarget(context))) return back(clientId, 'target_changed')
    if (req.nextUrl.searchParams.get('error')) return back(clientId, 'cancelled')
    const code = req.nextUrl.searchParams.get('code')
    const appId = process.env.GOOGLE_CLIENT_ID
    if (!code || !appId) return back(clientId, 'verify_failed')
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? ''
    if (!origin) return back(clientId, 'verify_failed')
    const token = await exchangeCode(code, origin, appId, secret)
    if (!token) return back(clientId, 'verify_failed')
    let channelId = context.targetChannelId
    if (channelId === null) {
      const discovered = await discoverSingleAuthorizedChannel(token.access_token)
      if (discovered === 'none') return back(clientId, 'no_channel')
      if (discovered === 'multiple') return back(clientId, 'multiple_channels')
      channelId = discovered.id
    }
    const candidate = channelId
    const persisted = await persistYoutubeConnection({ clientId, expectedChannelId: candidate,
      accessToken: token.access_token, refreshToken: token.refresh_token,
      tokenExpiry: token.tokenExpiry, scope: token.scope,
      beforeWrite: async () => {
        if (!(await sameActor(context)) || !(await sameTarget(context)) ||
          !verifyYoutubeState(state, secret) || token.tokenExpiry.getTime() <= Date.now()) return false
        if (!(await sameActor(context)) || !verifyYoutubeState(state, secret) ||
          token.tokenExpiry.getTime() <= Date.now()) return false
        if (context.targetChannelId === null && !(await claimClientChannelTarget(clientId, candidate))) return false
        const final = await readClientChannelTarget(clientId)
        if (final.kind !== 'configured' || final.channelId !== candidate || !(await sameActor(context))) return false
        const finalTarget = await readClientChannelTarget(clientId)
        return finalTarget.kind === 'configured' && finalTarget.channelId === candidate &&
          await sameActor(context) && Boolean(verifyYoutubeState(state, secret)) &&
          token.tokenExpiry.getTime() > Date.now() &&
          process.env.GOOGLE_CLIENT_ID === appId && process.env.GOOGLE_CLIENT_SECRET === secret &&
          (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL) === origin
      },
    })
    if (!persisted.ok) return back(clientId, persisted.reason === 'scope_missing' ? 'scope_missing'
      : persisted.reason === 'channel_mismatch' ? 'channel_mismatch'
        : persisted.reason === 'context_changed' ? 'target_changed'
          : persisted.reason === 'save_unverified' ? 'save_failed' : 'verify_failed')
    return back(clientId, 'connected')
  } catch {
    // A successful target CAS followed by a failed grant write stays configured,
    // not connected. Retrying can safely authorize that same exact channel.
    return back(clientId, 'save_failed')
  }
}
