/**
 * GET /api/auth/facebook/callback?code=…&state=…
 *
 * Meta sends the user back here after consent. We turn the one-time code into a
 * long-lived user token, read every Page that token holds a role on, and store
 * the Page token for the Page this client is bound to.
 *
 * We store the **Page** token, not the user token: the hourly Messenger sync
 * needs a Page token, and deriving one at read time is what used to fail
 * silently (`no_page_token`) when the identity behind the env-var token held no
 * role on the Page.
 *
 * Every exit redirects back to the client's settings page with a short,
 * plain-language `meta` query param — a JSON error body here would be a dead end
 * for whoever clicked the button.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyState, exchangeCode, exchangeForLongLivedToken, listPagesWithTokens, listGrantedScopes, META_PUBLISH_SCOPE, META_STATE_COOKIE, META_STATE_PATH } from '@/lib/meta-oauth/client'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'
import { projectFactoryConfig } from '@/lib/factory/client-config'

/** Long-lived user tokens last ~60 days; Page tokens derived from them do not
 *  expire while the grant stands. We record 60 days so an expiry sweep has
 *  something honest to look at rather than a fabricated "never". */
const TOKEN_LIFETIME_DAYS = 60

type Outcome =
  | 'connected'
  | 'publish_ready'
  | 'publish_not_granted'
  | 'verify_failed'
  | 'no_publish_target'
  | 'no_pages'
  | 'page_not_granted'
  | 'no_page_bound'
  | 'denied'
  | 'bad_state'
  | 'exchange_failed'

function back(clientId: string | null, outcome: Outcome, clearState = true): NextResponse {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  // The outcome message and the Reauthorize action live in FacebookPagePanel,
  // which only renders inside the client-page settings drawer's "platform" tab
  // (`?settings=platform` opens that drawer) — NOT on the /settings route, which
  // does not mount the panel. Landing there would hide every publish_* /
  // verify_failed result and the retry button. clientId comes from the
  // HMAC-verified state, never a raw query param, so this is not an open redirect.
  const query = new URLSearchParams({ settings: 'platform', meta: outcome })
  const path = clientId
    ? `/dashboard/clients/${clientId}?${query.toString()}`
    : `/dashboard?meta=${outcome}`
  const response = NextResponse.redirect(`${appUrl}${path}`)
  if (clearState) {
    response.cookies.set(META_STATE_COOKIE, '', {
      httpOnly: true, secure: new URL(appUrl).protocol === 'https:',
      sameSite: 'lax', path: META_STATE_PATH, maxAge: 0,
    })
  }
  return response
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams

  const code = params.get('code')
  const state = params.get('state')
  // An old tab must not erase a newer attempt's browser binding.
  if (!state || req.cookies.get(META_STATE_COOKIE)?.value !== state) return back(null, 'bad_state', false)

  const verified = verifyState(state)
  if (!verified) return back(null, 'bad_state')
  const { clientId, intent } = verified
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok || access.user.id !== verified.userId) return back(null, 'bad_state')
  // A cancellation belongs to this client only after browser and actor checks.
  if (params.get('error')) return back(clientId, 'denied')
  if (!code) return back(clientId, 'bad_state')

  // Which Page do we need a token for? These are two independent fields:
  //   • inbox connect  → clients.facebook_page_id (the Messenger sync target)
  //   • publishing      → factory_config.publish_target.page_id (what the
  //                        Facebook Reel adapter actually posts to)
  // Storing the inbox Page's token while claiming the publishing Page is ready
  // is exactly the failure this reauth exists to end, so publishing resolves its
  // own target. Compare the current server config with the server target signed
  // at initiation; changing A to B must never silently authorize B.
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id, factory_config')
    .eq('id', clientId)
    .maybeSingle()
  if (error || !data) return back(clientId, 'verify_failed')

  let targetPageId: string | null
  if (intent === 'publishing') {
    const target = projectFactoryConfig((data as { factory_config?: unknown } | null)?.factory_config).publish_target
    // A missing or non-Facebook publish target means there is nothing valid to
    // authorise — fail closed rather than binding the wrong Page.
    if (!target || target.platform !== 'facebook' || !target.page_id) {
      return back(clientId, 'no_publish_target')
    }
    targetPageId = target.page_id
  } else {
    targetPageId = (data as { facebook_page_id?: string | null } | null)?.facebook_page_id ?? null
    if (!targetPageId) return back(clientId, 'no_page_bound')
  }
  if (targetPageId !== verified.targetPageId) return back(clientId, 'verify_failed')

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'}/api/auth/facebook/callback`
  const shortToken = await exchangeCode(code, redirectUri)
  if (!shortToken) return back(clientId, 'exchange_failed')
  const longToken = await exchangeForLongLivedToken(shortToken)
  if (!longToken) return back(clientId, 'exchange_failed')
  const pages = await listPagesWithTokens(longToken)
  if (pages.length === 0) return back(clientId, 'no_pages')

  // The consent may be genuine yet not cover the Page we need — the account
  // that authorised holds no role on it. Saying so beats storing a token that
  // will never work.
  const match = pages.find((p) => p.pageId === targetPageId)
  if (!match) return back(clientId, 'page_not_granted')

  const expiry = new Date(Date.now() + TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)

  // Store what Meta ACTUALLY granted, never what we requested. The user can
  // approve a subset on the consent screen; recording the requested constant
  // would mark a token publish-ready that cannot publish.
  //
  // `null` means the permissions read itself failed — NOT "zero granted". We
  // must not fabricate facts on that path: writing the requested scopes would
  // record a grant the user may never have given, and stamping last_synced_at
  // would claim a verification that never happened. So we fail closed — leave
  // the existing connection's known scope facts untouched by not upserting at
  // all — and report a non-secret not-ready outcome for the operator to retry.
  const granted = await listGrantedScopes(longToken)
  if (granted === null) return back(clientId, 'verify_failed')

  // Provider calls yield control. Recheck immediately before persistence so
  // changes made while the consent is completing cannot silently retarget it.
  const finalAccess = await requireDashboardClientAccess(clientId)
  if (!finalAccess.ok || finalAccess.user.id !== verified.userId) return back(null, 'bad_state')
  const finalConfig = await supabaseAdmin.from('clients')
    .select('facebook_page_id, factory_config').eq('id', clientId).maybeSingle()
  if (finalConfig.error || !finalConfig.data) return back(clientId, 'verify_failed')
  const finalTarget = intent === 'publishing'
    ? projectFactoryConfig(finalConfig.data.factory_config).publish_target
    : null
  const finalPageId = intent === 'publishing'
    ? (finalTarget?.platform === 'facebook' ? finalTarget.page_id : null)
    : finalConfig.data.facebook_page_id
  if (finalPageId !== verified.targetPageId) return back(clientId, 'verify_failed')

  try {
    await upsertConnection({
      clientId,
      provider: PLATFORM_PROVIDERS.META,
      accessToken: match.pageToken,
      refreshToken: '', // Meta issues no refresh token; re-consent is the renewal path.
      tokenExpiry: expiry,
      accountId: match.pageId,
      displayName: match.pageName,
      scopes: granted,
      lastSyncedAt: new Date(),
    })
  } catch {
    return back(clientId, 'verify_failed')
  }

  // The publishing reauthorisation fails closed: only report ready when the
  // provider authoritatively confirmed pages_manage_posts. A declined grant
  // (authoritative list without it) stays visibly not-ready and cannot be
  // mistaken for success. Inbox connects (no intent) keep their existing outcome.
  if (intent === 'publishing') {
    return back(clientId, granted.includes(META_PUBLISH_SCOPE) ? 'publish_ready' : 'publish_not_granted')
  }

  return back(clientId, 'connected')
}
