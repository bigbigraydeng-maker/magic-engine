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

export function buildState(clientId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ clientId, exp: Date.now() + STATE_TTL_MS }),
  ).toString('base64url')
  const sig = createHmac('sha256', clientSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyState(state: string): string | null {
  const dot = state.lastIndexOf('.')
  if (dot === -1) return null
  const payload = state.slice(0, dot)
  const sig     = state.slice(dot + 1)
  const expected = createHmac('sha256', clientSecret()).update(payload).digest('base64url')
  if (sig !== expected) return null
  try {
    const data = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { clientId: string; exp: number }
    if (Date.now() > data.exp) return null
    return data.clientId
  } catch {
    return null
  }
}

// ─── OAuth URL ────────────────────────────────────────────────────────────────

export function buildAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         GSC_SCOPES.join(' '),
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
  await supabaseAdmin
    .from('google_oauth_tokens')
    .upsert(row, { onConflict: 'client_id' })
}

// ─── Token retrieval + auto-refresh ──────────────────────────────────────────

export async function getValidAccessToken(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('access_token, refresh_token, token_expiry')
    .eq('client_id', clientId)
    .single<TokenRow>()

  if (!data) return null

  const expiresAt = new Date(data.token_expiry).getTime()
  if (Date.now() < expiresAt - TOKEN_BUFFER_MS) {
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
