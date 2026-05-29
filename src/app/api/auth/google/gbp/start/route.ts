/**
 * GET /api/auth/google/gbp/start?clientId={meClientId}
 *
 * Initiates the Google OAuth 2.0 flow for connecting a client's
 * Google Business Profile account to Magic Engine.
 *
 * Flow:
 *  1. Validate ME session has access to the given client.
 *  2. Generate a random nonce → store as httpOnly cookie (CSRF guard).
 *  3. Build the Google OAuth consent URL.
 *  4. 302 redirect the browser to Google.
 *
 * The browser then completes the consent at Google and is redirected to
 * /api/auth/google/gbp/callback with `code` and `state` query params.
 *
 * Security notes:
 *  - Cookie is httpOnly + SameSite=Lax (must be Lax, not Strict, so the
 *    cookie is sent on the GET redirect back from Google).
 *  - prompt=consent forces Google to return a refresh_token every time,
 *    even if the user previously authorised the app.
 *  - access_type=offline is required for the refresh_token grant.
 *  - Cookie value uses raw `nonce:clientId` (no URL-encoding) by writing
 *    the Set-Cookie header directly to preserve the colon separator.
 *
 * Phase 24.A.3
 */

import { type NextRequest, NextResponse } from 'next/server'
import * as nodeCrypto from 'crypto'   // namespace import — required for vi.mock interception
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// ─── Constants ────────────────────────────────────────────────────────────────

export const GBP_OAUTH_SCOPE    = 'https://www.googleapis.com/auth/business.manage'
export const GBP_STATE_COOKIE   = 'gbp_oauth_state'
export const STATE_TTL_SECS     = 600   // 10 minutes

// ─── Route ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── 1. Validate query param ──────────────────────────────────────────────
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json(
      { error: 'clientId query param is required' },
      { status: 400 },
    )
  }

  // ── 2. Auth: verify the calling user can manage this client ──────────────
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // ── 3. Env config ────────────────────────────────────────────────────────
  const googleClientId = process.env.GOOGLE_CLIENT_ID
  const appUrl         = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL

  if (!googleClientId) {
    return NextResponse.json(
      { error: 'GOOGLE_CLIENT_ID is not configured' },
      { status: 500 },
    )
  }
  if (!appUrl) {
    return NextResponse.json(
      { error: 'APP_URL / NEXT_PUBLIC_APP_URL is not configured' },
      { status: 500 },
    )
  }

  // ── 4. Generate CSRF nonce ───────────────────────────────────────────────
  //   Cookie value: "{nonce}:{clientId}" — validated in the callback.
  //   Only the nonce travels as the OAuth `state` param (clientId stays server-side).
  const nonce      = nodeCrypto.randomBytes(16).toString('hex')
  const cookieVal  = `${nonce}:${clientId}`

  // ── 5. Build Google OAuth URL ────────────────────────────────────────────
  const redirectUri = `${appUrl}/api/auth/google/gbp/callback`
  const authUrl     = new URL('https://accounts.google.com/o/oauth2/v2/auth')

  authUrl.searchParams.set('client_id',     googleClientId)
  authUrl.searchParams.set('redirect_uri',  redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope',         GBP_OAUTH_SCOPE)
  authUrl.searchParams.set('access_type',   'offline')   // needed for refresh_token
  authUrl.searchParams.set('prompt',        'consent')   // forces refresh_token on every auth
  authUrl.searchParams.set('state',         nonce)

  // ── 6. Redirect + set cookie ─────────────────────────────────────────────
  //   Use explicit 302 (not Next's default 307) for the OAuth flow.
  //   Set the cookie via header directly to avoid Next.js URL-encoding the
  //   colon separator in the cookie value.
  const response = NextResponse.redirect(authUrl.toString(), 302)

  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.headers.append(
    'Set-Cookie',
    `${GBP_STATE_COOKIE}=${cookieVal}; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_SECS}; Path=/${secure}`,
  )

  return response
}
