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
import { encryptToken } from '@/lib/platform-oauth/vocabulary'

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
  try {
    await storeTokens(clientId, tokens, googleEmail)
  } catch (err) {
    console.error('[google/callback] failed to store tokens:', err)
    return NextResponse.redirect(destination(flow, clientId, 'error'))
  }

  // Dual-write to platform_oauth_connections (encrypted path) so getValidToken()
  // works for GSC. Keep writing to google_oauth_tokens above for backward compat.
  if (tokens.refresh_token) {
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    const { error: connErr } = await supabaseAdmin
      .from('platform_oauth_connections')
      .upsert(
        {
          client_id:         clientId,
          provider:          'google_gsc',
          access_token_enc:  encryptToken(tokens.access_token),
          refresh_token_enc: encryptToken(tokens.refresh_token),
          token_expiry:      expiresAt.toISOString(),
          account_id:        googleEmail ?? clientId,
          display_name:      googleEmail ?? 'Google Search Console',
          scopes:            tokens.scope.split(' '),
          status:            'active',
          updated_at:        new Date().toISOString(),
        },
        { onConflict: 'client_id,provider,account_id' },
      )
    if (connErr) {
      console.warn('[google/callback] dual-write to platform_oauth_connections failed:', connErr.message)
      // Non-fatal — legacy path still works
    }
  }

  // Update GSC connector — preserve site_url and existing 'connected' status.
  // Only set 'partial' when no site_url is recorded yet.
  const now = new Date().toISOString()
  const { data: existing } = await supabaseAdmin
    .from('client_connectors')
    .select('status, config')
    .eq('client_id', clientId)
    .eq('anchor', 'gsc')
    .maybeSingle<{ status: string; config: Record<string, unknown> | null }>()

  const hasSiteUrl = Boolean(existing?.config?.site_url)
  const newStatus  = existing?.status === 'connected' || hasSiteUrl ? 'connected' : 'partial'
  const newConfig  = { ...(existing?.config ?? {}), google_email: googleEmail }

  await supabaseAdmin
    .from('client_connectors')
    .upsert(
      {
        client_id:    clientId,
        anchor:       'gsc',
        status:       newStatus,
        config:       newConfig,
        connected_at: now,
        updated_at:   now,
      },
      { onConflict: 'client_id,anchor' },
    )

  // Redirect back to where the flow started
  return NextResponse.redirect(destination(flow, clientId, 'success'))
}
