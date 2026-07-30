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
import { verifyState, exchangeCode, exchangeForLongLivedToken, listPagesWithTokens, META_PAGE_SCOPES } from '@/lib/meta-oauth/client'
import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

/** Long-lived user tokens last ~60 days; Page tokens derived from them do not
 *  expire while the grant stands. We record 60 days so an expiry sweep has
 *  something honest to look at rather than a fabricated "never". */
const TOKEN_LIFETIME_DAYS = 60

type Outcome =
  | 'connected'
  | 'no_pages'
  | 'page_not_granted'
  | 'no_page_bound'
  | 'denied'
  | 'bad_state'
  | 'exchange_failed'

function back(clientId: string | null, outcome: Outcome): NextResponse {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const path = clientId ? `/dashboard/clients/${clientId}/settings` : '/dashboard'
  return NextResponse.redirect(`${appUrl}${path}?meta=${outcome}`)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams

  // User pressed Cancel on Meta's consent screen.
  if (params.get('error')) return back(null, 'denied')

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return back(null, 'bad_state')

  const verified = verifyState(state)
  if (!verified) return back(null, 'bad_state')
  const { clientId } = verified

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'}/api/auth/facebook/callback`

  const shortToken = await exchangeCode(code, redirectUri)
  if (!shortToken) return back(clientId, 'exchange_failed')

  const longToken = await exchangeForLongLivedToken(shortToken)
  if (!longToken) return back(clientId, 'exchange_failed')

  const pages = await listPagesWithTokens(longToken)
  if (pages.length === 0) return back(clientId, 'no_pages')

  // Which Page is this client actually bound to? Without a binding we have no
  // basis to pick one, and guessing would attach the wrong inbox.
  const { data } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()

  const boundPageId = (data as { facebook_page_id?: string | null } | null)?.facebook_page_id
  if (!boundPageId) return back(clientId, 'no_page_bound')

  // The consent may be genuine yet not cover the Page we need — the account
  // that authorised holds no role on it. Saying so beats storing a token that
  // will never work.
  const match = pages.find((p) => p.pageId === boundPageId)
  if (!match) return back(clientId, 'page_not_granted')

  const expiry = new Date(Date.now() + TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)

  await upsertConnection({
    clientId,
    provider: PLATFORM_PROVIDERS.META,
    accessToken: match.pageToken,
    refreshToken: '', // Meta issues no refresh token; re-consent is the renewal path.
    tokenExpiry: expiry,
    accountId: match.pageId,
    displayName: match.pageName,
    scopes: [...META_PAGE_SCOPES],
  })

  return back(clientId, 'connected')
}
