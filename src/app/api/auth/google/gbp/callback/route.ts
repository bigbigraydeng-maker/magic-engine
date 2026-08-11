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
import { supabaseAdmin } from '@/lib/supabase'
import { encryptToken } from '@/lib/platform-oauth/vocabulary'
import { resolveGbpLocation } from '@/lib/gbp/location'
import { GBP_STATE_COOKIE } from '../start/route'

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GBP_ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
const GBP_SCOPE        = 'https://www.googleapis.com/auth/business.manage'

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

  // ── 6. Fetch GBP account info ─────────────────────────────────────────────
  const accountsRes = await fetch(GBP_ACCOUNTS_URL, {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  })

  if (!accountsRes.ok) {
    // Capture status + body so we can distinguish:
    //   403 → user not in Test users, or business.manage scope missing
    //   429 → quota
    //   404 → API not enabled in this GCP project
    const errorBody = await accountsRes.text().catch(() => '(unreadable)')
    console.error('[gbp/callback] GBP accounts API failed:', {
      status:     accountsRes.status,
      statusText: accountsRes.statusText,
      body:       errorBody.slice(0, 500),
      scope:      tokenScope,
    })
    return errorRedirect(appUrl, clientId, flow, 'gbp_api_failed')
  }

  const accountsData = (await accountsRes.json()) as {
    accounts?: Array<{ name: string; accountName: string }>
  }

  const accounts = accountsData.accounts ?? []
  if (accounts.length === 0) {
    console.warn('[gbp/callback] no GBP accounts under this Google user')
    return errorRedirect(appUrl, clientId, flow, 'no_gbp_accounts')
  }

  const gbpAccount = accounts[0]   // MVP: connect first account (location picker in Phase 24.A.7)

  // ── 7. Encrypt + upsert platform_oauth_connections ───────────────────────
  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000)

  const { error: dbError } = await supabaseAdmin
    .from('platform_oauth_connections')
    .upsert(
      {
        client_id:         clientId,
        provider:          'google_gbp',
        access_token_enc:  encryptToken(tokenData.access_token),
        refresh_token_enc: encryptToken(tokenData.refresh_token),
        token_expiry:      expiresAt.toISOString(),
        account_id:        gbpAccount.name,
        display_name:      gbpAccount.accountName,
        scopes:            [GBP_SCOPE],
        status:            'active',
      },
      { onConflict: 'client_id,provider,account_id' },
    )

  if (dbError) {
    // Non-fatal for now: log and continue — user can reconnect from settings
    console.error('[gbp/callback] Failed to persist connection:', dbError.message)
  } else {
    // 向导 Step 3 判断"GBP 已连接"读的是 client_connectors，不是
    // platform_oauth_connections——这条一直没写，此前没暴露是因为向导从没
    // 接入真实注册流程，客户走不到这里（2026-08-11 复审发现，见 spec §2.2）。
    const now = new Date().toISOString()
    await supabaseAdmin
      .from('client_connectors')
      .upsert(
        {
          client_id:    clientId,
          anchor:       'gbp',
          status:       'connected',
          config:       { account_name: gbpAccount.accountName },
          connected_at: now,
          updated_at:   now,
        },
        { onConflict: 'client_id,anchor' },
      )
  }

  // ── 7b. Resolve which location posts go to, while we're here ─────────────
  // PM asked for a genuine one-click setup: without this the location stays
  // unresolved and the first weekly post would be the one to discover a
  // problem. Failure is non-fatal — the connection itself is good, we just
  // flag that a location still needs picking.
  // Default to "not confirmed": telling the PM it is ready when we do not
  // know is the one outcome that must never happen (魏征 🟡5).
  let locationStatus: 'ready' | 'needs_location' = 'needs_location'
  try {
    const { data: clientRow } = await supabaseAdmin
      .from('clients')
      .select('id, name, domain')
      .eq('id', clientId)
      .single()

    if (clientRow) {
      const resolved = await resolveGbpLocation(
        clientRow as { id: string; name: string; domain: string | null },
      )
      if (resolved.ok) locationStatus = 'ready'
      else console.warn('[gbp/callback] location unresolved:', resolved.reason)
    } else {
      console.warn('[gbp/callback] client row unreadable — leaving location unconfirmed')
    }
  } catch (err) {
    console.warn('[gbp/callback] location resolution failed:', err instanceof Error ? err.message : err)
  }

  // ── 8. Clear CSRF cookie + redirect to success ────────────────────────────
  const successUrl = buildDestinationUrl(appUrl, clientId, flow)
  successUrl.searchParams.set('gbp', locationStatus === 'ready' ? 'connected' : 'needs_location')

  const response = NextResponse.redirect(successUrl.toString(), 302)
  response.headers.append(
    'Set-Cookie',
    `${GBP_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`,
  )

  return response
}
