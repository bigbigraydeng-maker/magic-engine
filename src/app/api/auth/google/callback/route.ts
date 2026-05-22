/**
 * GET /api/auth/google/callback?code=<code>&state=<state>
 *
 * OAuth 2.0 callback handler. Verifies the HMAC state, exchanges the
 * authorization code for tokens, stores them in google_oauth_tokens, and
 * marks the client's GSC connector as 'partial' (OAuth done, site_url pending).
 *
 * The signed state carries a `flow` field that decides where the user lands
 * afterwards:
 *   - 'admin'   → /dashboard/clients/[id]/connectors/gsc  (internal operator)
 *   - 'connect' → /connect/[id]  (public customer-facing page, no login)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  verifyState,
  exchangeCode,
  fetchGoogleEmail,
  storeTokens,
  type OAuthFlow,
} from '@/lib/google-oauth/client'
import { supabaseAdmin } from '@/lib/supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
}

type OAuthResult = 'success' | 'error' | 'denied'

function destination(flow: OAuthFlow, clientId: string, oauth: OAuthResult): string {
  if (flow === 'connect') {
    return `${appUrl()}/connect/${clientId}?oauth=${oauth}`
  }
  return `${appUrl()}/dashboard/clients/${clientId}/connectors/gsc?oauth=${oauth}`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const verified = state ? verifyState(state) : null

  // User denied consent
  if (error) {
    if (verified?.flow === 'connect') {
      return NextResponse.redirect(destination('connect', verified.clientId, 'denied'))
    }
    return NextResponse.redirect(`${appUrl()}/dashboard?google_auth_error=denied`)
  }

  // Missing code or state — route connect-flow customers away from the dashboard login wall
  if (!code || !state) {
    if (verified?.flow === 'connect') {
      return NextResponse.redirect(destination('connect', verified.clientId, 'error'))
    }
    return NextResponse.redirect(`${appUrl()}/dashboard?google_auth_error=missing_params`)
  }

  // Verify signed state → extract clientId + flow.
  // If state is tampered/expired we cannot trust the flow, so use a public-safe fallback.
  if (!verified) {
    return NextResponse.redirect(`${appUrl()}/?google_auth_error=invalid_link`)
  }
  const { clientId, flow } = verified

  // Re-validate clientId as UUID — defence-in-depth against any future refactor that
  // might allow non-HMAC-sourced clientIds to reach this point.
  if (!UUID_RE.test(clientId)) {
    return NextResponse.redirect(`${appUrl()}/dashboard?google_auth_error=invalid_state`)
  }

  // Exchange authorization code for tokens
  const redirectUri = `${appUrl()}/api/auth/google/callback`
  let tokens
  try {
    tokens = await exchangeCode(code, redirectUri)
  } catch (err) {
    console.error('[google/callback] token exchange failed:', err)
    return NextResponse.redirect(destination(flow, clientId, 'error'))
  }

  // Fetch the Google account email for display
  const googleEmail = await fetchGoogleEmail(tokens.access_token)

  // Persist tokens
  await storeTokens(clientId, tokens, googleEmail)

  // Mark GSC connector as 'partial': OAuth done, site_url still needed
  const now = new Date().toISOString()
  await supabaseAdmin
    .from('client_connectors')
    .upsert(
      {
        client_id:    clientId,
        anchor:       'gsc',
        status:       'partial',
        config:       { google_email: googleEmail },
        connected_at: now,
        updated_at:   now,
      },
      { onConflict: 'client_id,anchor' },
    )

  // Redirect back to where the flow started
  return NextResponse.redirect(destination(flow, clientId, 'success'))
}
