/**
 * GET /api/auth/google/callback?code=<code>&state=<state>
 *
 * OAuth 2.0 callback handler. Verifies the HMAC state, exchanges the
 * authorization code for tokens, stores them in google_oauth_tokens, and
 * marks the client's GSC connector as 'partial' (OAuth done, site_url pending).
 *
 * Redirects back to /dashboard/clients/[id]/connectors/gsc on success,
 * or to /dashboard with an error param on failure.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  verifyState,
  exchangeCode,
  fetchGoogleEmail,
  storeTokens,
} from '@/lib/google-oauth/client'
import { supabaseAdmin } from '@/lib/supabase'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // User denied consent
  if (error) {
    return NextResponse.redirect(`${appUrl()}/dashboard?google_auth_error=denied`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl()}/dashboard?google_auth_error=missing_params`)
  }

  // Verify signed state → extract clientId
  const clientId = verifyState(state)
  if (!clientId) {
    return NextResponse.redirect(`${appUrl()}/dashboard?google_auth_error=invalid_state`)
  }

  // Exchange authorization code for tokens
  const redirectUri = `${appUrl()}/api/auth/google/callback`
  let tokens
  try {
    tokens = await exchangeCode(code, redirectUri)
  } catch (err) {
    console.error('[google/callback] token exchange failed:', err)
    return NextResponse.redirect(
      `${appUrl()}/dashboard/clients/${clientId}/connectors/gsc?oauth=error`,
    )
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

  // Redirect back to the GSC connector detail page
  return NextResponse.redirect(
    `${appUrl()}/dashboard/clients/${clientId}/connectors/gsc?oauth=success`,
  )
}
