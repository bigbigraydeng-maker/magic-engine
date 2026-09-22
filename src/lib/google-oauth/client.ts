/**
 * Google OAuth 2.0 utilities — token lifecycle for GSC / GA4 / Google Ads.
 *
 * Flow:
 *   1. buildState(clientId)  → sign a short-lived HMAC state token
 *   2. buildAuthUrl(state, redirectUri)  → redirect user to Google
 *   3. exchangeCode(code, redirectUri)  → get access_token + refresh_token
 *   4. storeTokens(clientId, tokens, email)  → upsert google_oauth_tokens
 *   5. getValidAccessToken(clientId)  → auto-refresh if near expiry
 */

import { createHmac } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL     = 'https://openidconnect.googleapis.com/v1/userinfo'

const STATE_TTL_MS     = 10 * 60 * 1000  // 10 minutes
const TOKEN_BUFFER_MS  =  5 * 60 * 1000  // refresh 5 min before expiry

export const GSC_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'email',
]

export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

/**
 * P14.B.7: Google Indexing API scope.
 * Requires Google Search Console property ownership.
 * Added to COMBINED_GOOGLE_SCOPES so new authorizations include it automatically.
 * Existing tokens without this scope will receive 403 → route returns NEEDS_REAUTH.
 */
export const INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing'

/**
 * Google Business Profile 管理权限（读写商家档案 / 发帖）。
 * 合到 COMBINED_GOOGLE_SCOPES：客户老板一次点完覆盖商家页 + GSC + GA4 + Indexing，
 * 不用再来第二次；`/api/auth/google/callback` 检查 token.scope 是否包含这个，
 * 是就顺手把 platform_oauth_connections.google_gbp + client_connectors.gbp
 * 一起写好（见 lib/gbp/oauth-persist.ts）。老的 `/api/auth/google/gbp/start`
 * 单独入口保留兼容，走的是同一个 helper。
 */
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage'

/**
 * 只读 Google 表格权限（2026-09-13，CTS CAPI 项目）。
 *
 * 这套客户没有配置任何 Google 服务账号（`GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`
 * 在生产环境里根本不存在，PM 实测确认过）——所以读表格不能走服务账号那条路，
 * 只能走这里：客户本来就用自己的 Google 账号连过一次 GSC/GA4（见
 * `google_oauth_tokens`），这次只是给同一个连接多要一个权限，不需要另建
 * 任何新的授权身份。
 */
export const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

/**
 * Combined scopes for the recommended "connect Google" flow —
 * grants GBP + GSC + GA4 + Indexing + Sheets in one consent (2026-09-07 铁律 3
 * "遇卡点必自动化"：从两次 OAuth 点击合并成一次，见 PR grant-permissions-fix).
 *
 * 🔴 加了新 scope 之后，**已经连过的客户不会自动拿到它**——`google_oauth_tokens`
 *    里存的是上次同意时 Google 实际批准的 scope 列表，服务端拿旧 token 去调
 *    新权限的 API 会被 Google 判 403。客户必须重新走一次 `/api/auth/google/connect`
 *    才会在 Google 的同意页面上看到新权限、批准后才写得进新 token。
 */
export const COMBINED_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
  INDEXING_SCOPE,
  GBP_SCOPE,
  SHEETS_READONLY_SCOPE,
  'email',
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
}

interface TokenRow {
  access_token: string
  refresh_token: string | null
  token_expiry: string
}

// ─── State helpers (HMAC-signed, 10-min TTL) ──────────────────────────────────

function clientSecret(): string {
  const s = process.env.GOOGLE_CLIENT_SECRET
  if (!s) throw new Error('GOOGLE_CLIENT_SECRET not configured')
  return s
}

/**
 * 'admin'   → FDE 后台发起，回调落地 settings 页
 * 'connect' → 公网无登录客户自助页 /connect/[clientId]
 * 'wizard'  → $990 自助新手引导向导，回调必须落回向导本身，不能落到 settings 页
 *             (板桥 2026-08-11 复审：落错地方会把客户送进一个他看不懂的 FDE 内部页面)
 */
export type OAuthFlow = 'admin' | 'connect' | 'wizard'

export interface VerifiedState {
  clientId: string
  flow: OAuthFlow
}

export function buildState(clientId: string, flow: OAuthFlow = 'admin'): string {
  const payload = Buffer.from(
    JSON.stringify({ clientId, flow, exp: Date.now() + STATE_TTL_MS }),
  ).toString('base64url')
  const sig = createHmac('sha256', clientSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyState(state: string): VerifiedState | null {
  const dot = state.lastIndexOf('.')
  if (dot === -1) return null
  const payload = state.slice(0, dot)
  const sig     = state.slice(dot + 1)
  const expected = createHmac('sha256', clientSecret()).update(payload).digest('base64url')
  if (sig !== expected) return null
  try {
    const data = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { clientId: string; flow?: string; exp: number }
    if (Date.now() > data.exp) return null
    const flow: OAuthFlow =
      data.flow === 'connect' ? 'connect' : data.flow === 'wizard' ? 'wizard' : 'admin'
    return { clientId: data.clientId, flow }
  } catch {
    return null
  }
}

// ─── OAuth URL ────────────────────────────────────────────────────────────────

export function buildAuthUrl(
  state: string,
  redirectUri: string,
  scopes: string[] = GSC_SCOPES,
): string {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         scopes.join(' '),
    access_type:   'offline',
    prompt:        'consent',   // always return refresh_token
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<RawTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: clientSecret(),
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<RawTokenResponse>
}

// ─── User info ────────────────────────────────────────────────────────────────

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json() as { email?: string }
    return data.email ?? null
  } catch {
    return null
  }
}

// ─── Token storage ────────────────────────────────────────────────────────────

export async function storeTokens(
  clientId: string,
  tokens: RawTokenResponse,
  googleEmail: string | null,
): Promise<void> {
  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const row: Record<string, unknown> = {
    client_id:    clientId,
    access_token: tokens.access_token,
    token_expiry: expiry,
    scopes:       tokens.scope.split(' '),
    google_email: googleEmail,
    updated_at:   new Date().toISOString(),
  }
  if (tokens.refresh_token) {
    row.refresh_token = tokens.refresh_token
  }
  const { error } = await supabaseAdmin
    .from('google_oauth_tokens')
    .upsert(row, { onConflict: 'client_id' })
  if (error) {
    throw new Error(`Failed to store OAuth tokens for ${clientId}: ${error.message}`)
  }
}

// ─── Token retrieval + auto-refresh ──────────────────────────────────────────

/**
 * Return a valid access_token for the client, refreshing if the cached one
 * is near expiry.
 *
 * `opts.forceRefresh` skips the cached-token check and hits the Google
 * refresh endpoint unconditionally. Used by GSC / GA4 clients when they
 * catch a 401 with a cached access_token — Google can invalidate tokens
 * before their nominal expiry, and we saw intermittent 06-27/06-28/06-30
 * cron failures with exactly that shape.
 */
export async function getValidAccessToken(
  clientId: string,
  opts?: { forceRefresh?: boolean },
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('access_token, refresh_token, token_expiry')
    .eq('client_id', clientId)
    .single<TokenRow>()

  if (!data) return null

  const expiresAt = new Date(data.token_expiry).getTime()
  if (!opts?.forceRefresh && Date.now() < expiresAt - TOKEN_BUFFER_MS) {
    return data.access_token
  }

  if (!data.refresh_token) return null

  try {
    const refreshed = await doRefresh(data.refresh_token)
    const newExpiry  = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    await supabaseAdmin
      .from('google_oauth_tokens')
      .update({
        access_token: refreshed.access_token,
        token_expiry: newExpiry,
        updated_at:   new Date().toISOString(),
      })
      .eq('client_id', clientId)
    return refreshed.access_token
  } catch (err) {
    console.warn('[google-oauth] refresh failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function doRefresh(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: clientSecret(),
    }),
  })
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`)
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}
