import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { confirmSocialConnectionWrite, upsertConnection } from '@/lib/platform-oauth/connection-store'
import { normalizeInstagramHandle, type InstagramOutcome } from '@/lib/instagram-oauth/identity'
import { getInstagramConfig, instagramReturnUrl, readInstagramIdentity, verifyInstagramState,
  INSTAGRAM_STATE_COOKIE, INSTAGRAM_STATE_PATH } from '@/lib/instagram-oauth/client'

function back(clientId: string | null, outcome: InstagramOutcome, clear = true) {
  const response = NextResponse.redirect(instagramReturnUrl(clientId, outcome))
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  if (clear) response.cookies.set(INSTAGRAM_STATE_COOKIE, '', { httpOnly: true, secure: true,
    sameSite: 'lax', path: INSTAGRAM_STATE_PATH, maxAge: 0 })
  return response
}

async function currentHandle(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('clients').select('instagram_handle').eq('id', clientId).maybeSingle()
  if (error || !data) throw new Error('Instagram target unavailable')
  return normalizeInstagramHandle(data.instagram_handle)
}

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get('state')
  // Old tabs must not erase a newer browser attempt.
  if (!state || req.cookies.get(INSTAGRAM_STATE_COOKIE)?.value !== state) return back(null, 'bad_state', false)
  const config = getInstagramConfig()
  const context = config && verifyInstagramState(state, config.secret)
  if (!context) return back(null, 'bad_state')
  const { clientId, userId, handle } = context
  try {
    const access = await requireOnboardingClientAccess(clientId)
    if (!access.ok || access.user.id !== userId) return back(null, 'bad_state')
    if (req.nextUrl.searchParams.get('error')) return back(clientId, 'denied')
    const code = req.nextUrl.searchParams.get('code')
    if (!code) return back(clientId, 'bad_state')
    if (await currentHandle(clientId) !== handle) return back(clientId, 'target_changed')
    const identity = await readInstagramIdentity(code, config)
    if (!identity) return back(clientId, 'verify_failed')
    if (identity.username !== handle) return back(clientId, 'account_mismatch')
    // All provider waits are behind us. Recheck actor, entitlement, target and feature config.
    const finalAccess = await requireOnboardingClientAccess(clientId)
    if (!finalAccess.ok || finalAccess.user.id !== userId) return back(null, 'bad_state')
    if (await currentHandle(clientId) !== handle) return back(clientId, 'target_changed')
    const finalConfig = getInstagramConfig()
    if (!finalConfig || finalConfig.appId !== config.appId || finalConfig.secret !== config.secret
      || finalConfig.redirectUri !== config.redirectUri) return back(clientId, 'unavailable')
    if (!verifyInstagramState(state, finalConfig.secret) || identity.tokenExpiry.getTime() <= Date.now()) return back(clientId, 'bad_state')
    const verifiedAt = new Date()
    await upsertConnection({ clientId, provider: 'instagram', purpose: 'legacy',
      accessToken: identity.accessToken, refreshToken: '', tokenExpiry: identity.tokenExpiry,
      accountId: identity.accountId, locationName: identity.username, displayName: `@${identity.username}`,
      scopes: identity.scopes, authorizingPrincipalId: userId, lastSyncedAt: verifiedAt })
    try {
      const confirmed = await confirmSocialConnectionWrite({ clientId, provider: 'instagram',
        accountId: identity.accountId, locationName: identity.username,
        requiredScopes: identity.scopes, tokenExpiry: identity.tokenExpiry, verifiedAt })
      if (!confirmed) return back(clientId, 'save_failed')
    } catch { return back(clientId, 'save_failed') }
    return back(clientId, 'connected')
  } catch { return back(clientId, 'verify_failed') }
}
