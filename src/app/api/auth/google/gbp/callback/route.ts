/**
 * GET /api/auth/google/gbp/callback?code={authCode}&state={nonce}
 *
 * Handles the OAuth 2.0 redirect from Google after the user grants consent.
 *
 * Flow:
 *  1. Read the CSRF state cookie and split into nonce + clientId.
 *  2. Validate that the `state` query param matches the stored nonce.
 *  3. Auth-check the session against the clientId.
 *  4. Exchange the authorization `code` for access_token + refresh_token.
 *  5. Call the GBP Account Management API to resolve the GBP account ID.
 *  6. Encrypt tokens and upsert a platform_oauth_connections row.
 *  7. Clear the CSRF cookie and 302-redirect to the client settings page.
 *
 * On any error after we know the clientId, redirect to the settings page
 * with `gbp=error&reason=<slug>` so the frontend can display a message.
 *
 * Phase 24.A.4
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { GBP_STATE_COOKIE } from '@/lib/gbp/oauth'
import { persistGbpFromTokens } from '@/lib/gbp/oauth-persist'

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

// ─── Helpers ─────────────────────────────────────────────────────────────────

type GbpFlow = 'admin' | 'wizard'

/**
 * 'wizard' 必须落回向导本身，不能落到 settings 页——那是 FDE 专用的内部
 * 后台，客户授权成功后被送进去只会觉得自己点错了（板桥 2026-08-11 复审）。
 */
function buildDestinationUrl(appUrl: string, clientId: string, flow: GbpFlow): URL {
  if (flow === 'wizard') {
    return new URL(`/dashboard/clients/${clientId}/onboarding`, appUrl)
  }
  return new URL(`/dashboard/clients/${clientId}/settings`, appUrl)
}

function errorRedirect(appUrl: string, clientId: string, flow: GbpFlow, reason: string): NextResponse {
  const url = buildDestinationUrl(appUrl, clientId, flow)
  url.searchParams.set('gbp', 'error')
  url.searchParams.set('reason', reason)
  return NextResponse.redirect(url.toString(), 302)
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── 1. Read + parse CSRF state cookie ────────────────────────────────────
  const rawCookie = req.cookies.get(GBP_STATE_COOKIE)?.value
  if (!rawCookie) {
    return NextResponse.json(
      { error: 'State cookie missing or expired — please restart the connection flow' },
      { status: 400 },
    )
  }

  // clientId 是 UUID，不含冒号，可以安全按 ':' 切三段。
  const [nonce, clientId, rawFlow] = rawCookie.split(':')
  const flow: GbpFlow = rawFlow === 'wizard' ? 'wizard' : 'admin'

  // ── 2. Validate query params ──────────────────────────────────────────────
  const code       = req.nextUrl.searchParams.get('code')
  const stateParam = req.nextUrl.searchParams.get('state')

  if (!code) {
    return NextResponse.json(
      { error: 'Authorization code missing from callback' },
      { status: 400 },
    )
  }
  if (stateParam !== nonce) {
    return NextResponse.json(
      { error: 'CSRF state mismatch — request may have been tampered with' },
      { status: 400 },
    )
  }

  // ── 3. Auth check ─────────────────────────────────────────────────────────
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // ── 4. Resolve app URL (needed for redirect_uri + success redirect) ───────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? ''

  // ── 5. Exchange authorization code for tokens ─────────────────────────────
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri:  `${appUrl}/api/auth/google/gbp/callback`,
      grant_type:    'authorization_code',
    }).toString(),
  })

  if (!tokenRes.ok) {
    return errorRedirect(appUrl, clientId, flow, 'token_exchange_failed')
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?:  string
    refresh_token?: string
    expires_in?:    number
    token_type?:    string
  }

  if (!tokenData.access_token || !tokenData.refresh_token) {
    console.error('[gbp/callback] token exchange missing fields:', {
      has_access_token:  Boolean(tokenData.access_token),
      has_refresh_token: Boolean(tokenData.refresh_token),
    })
    return errorRedirect(appUrl, clientId, flow, 'token_exchange_failed')
  }

  // Log scope grant for diagnostic — does the token actually have business.manage?
  const tokenScope = (tokenData as { scope?: string }).scope ?? '(missing)'
  console.log('[gbp/callback] token granted with scope:', tokenScope)

  // ── 6-7. 拉账号 + 落库 + 解析门店 —— 全部走共享 helper（合并流也走它）─────
  const persist = await persistGbpFromTokens({
    clientId,
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresInSec: tokenData.expires_in ?? 3600,
    scope:        tokenScope,
  })

  if (!persist.ok) {
    return errorRedirect(appUrl, clientId, flow, persist.reason ?? 'gbp_api_failed')
  }

  // ── 8. Clear CSRF cookie + redirect to success ────────────────────────────
  const successUrl = buildDestinationUrl(appUrl, clientId, flow)
  successUrl.searchParams.set('gbp', persist.locationStatus === 'ready' ? 'connected' : 'needs_location')

  const response = NextResponse.redirect(successUrl.toString(), 302)
  response.headers.append(
    'Set-Cookie',
    `${GBP_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`,
  )

  return response
}
