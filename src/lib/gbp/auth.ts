/**
 * GBP per-client access tokens.
 *
 * The GBP OAuth flow (api/auth/google/gbp/{start,callback}) stores an
 * encrypted refresh token per client in `platform_oauth_connections`
 * (provider = 'google_gbp'). This module turns that row into a live access
 * token, refreshing through Google when the stored one has expired.
 *
 * WHY THIS EXISTS
 * ---------------
 * `lib/gbp/publisher.ts` originally read a single `GOOGLE_GBP_ACCESS_TOKEN`
 * env var — never set in production, so every publish attempt silently
 * degraded to draft and ME has published exactly zero GBP posts to date.
 * Per-client OAuth is the only path that works for more than one client.
 *
 * Mirrors lib/google-oauth/client.ts > getValidAccessToken, but reads the
 * platform_oauth_connections table (GBP) instead of google_oauth_tokens (GSC).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { decryptToken, encryptToken } from '@/lib/platform-oauth/vocabulary'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** Refresh this many seconds before actual expiry (clock skew + call time). */
const EXPIRY_SKEW_MS = 60_000

export interface GbpConnection {
  id: string
  /** GBP account resource name: accounts/{accountId} */
  account_id: string
  /** GBP location resource name: accounts/{a}/locations/{l} — null until resolved. */
  location_name: string | null
  display_name: string | null
}

export type GbpAuthFailure =
  | 'not_connected'      // no active google_gbp row for this client
  | 'token_unreadable'   // row exists but tokens cannot be decrypted
  | 'refresh_failed'     // Google rejected the refresh (revoked / expired consent)

export type GbpAuthResult =
  | { ok: true; accessToken: string; connection: GbpConnection }
  | { ok: false; reason: GbpAuthFailure }

interface ConnectionRow {
  id: string
  account_id: string | null
  location_name: string | null
  display_name: string | null
  access_token_enc: string | null
  refresh_token_enc: string | null
  token_expiry: string | null
}

/** Read the client's active GBP connection row (no token work). */
export async function loadGbpConnection(clientId: string): Promise<GbpConnection | null> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, account_id, location_name, display_name')
    .eq('client_id', clientId)
    .eq('provider', 'google_gbp')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  const row = data as Pick<ConnectionRow, 'id' | 'account_id' | 'location_name' | 'display_name'>
  if (!row.account_id) return null
  return {
    id: row.id,
    account_id: row.account_id,
    location_name: row.location_name,
    display_name: row.display_name,
  }
}

/** True when this client has completed the GBP authorisation. */
export async function hasGbpConnection(clientId: string): Promise<boolean> {
  return (await loadGbpConnection(clientId)) !== null
}

/**
 * A live GBP access token for this client, refreshing if needed.
 *
 * Never throws: callers (cron, publisher) need to degrade per-client rather
 * than fail a whole batch, so failures come back as a typed reason.
 */
export async function getGbpAccessToken(clientId: string): Promise<GbpAuthResult> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, account_id, location_name, display_name, access_token_enc, refresh_token_enc, token_expiry')
    .eq('client_id', clientId)
    .eq('provider', 'google_gbp')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return { ok: false, reason: 'not_connected' }

  const row = data as ConnectionRow
  if (!row.account_id) return { ok: false, reason: 'not_connected' }

  const connection: GbpConnection = {
    id: row.id,
    account_id: row.account_id,
    location_name: row.location_name,
    display_name: row.display_name,
  }

  const expiresAt = row.token_expiry ? new Date(row.token_expiry).getTime() : 0
  const stillValid = expiresAt - EXPIRY_SKEW_MS > Date.now()

  if (stillValid && row.access_token_enc) {
    try {
      return { ok: true, accessToken: decryptToken(row.access_token_enc), connection }
    } catch {
      // fall through to refresh — a junk access token is worse than a refresh
    }
  }

  if (!row.refresh_token_enc) return { ok: false, reason: 'token_unreadable' }

  let refreshToken: string
  try {
    refreshToken = decryptToken(row.refresh_token_enc)
  } catch {
    return { ok: false, reason: 'token_unreadable' }
  }

  const refreshed = await refreshGoogleToken(refreshToken)
  if (!refreshed.ok) {
    // Only a DEFINITIVE rejection (consent revoked / bad client) means the
    // human must re-authorise. A Google 5xx, a network blip or a missing env
    // var must not burn the connection — doing so would drag the PM through
    // a pointless OAuth round trip for a transient wobble (魏征 🔴2).
    if (refreshed.permanent) {
      await supabaseAdmin
        .from('platform_oauth_connections')
        .update({
          status: 'error',
          error_message: '需要重新授权（Google 说这个授权已失效）',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
    }
    return { ok: false, reason: 'refresh_failed' }
  }

  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  await supabaseAdmin
    .from('platform_oauth_connections')
    .update({
      access_token_enc: encryptToken(refreshed.access_token),
      token_expiry: newExpiry,
      error_message: null,
    })
    .eq('id', row.id)

  return { ok: true, accessToken: refreshed.access_token, connection }
}

/**
 * `permanent: true` means only a human re-authorising can fix it. Everything
 * else (5xx, network, misconfigured env) is transient and must leave the
 * stored connection alone.
 */
type RefreshOutcome =
  | { ok: true; access_token: string; expires_in: number }
  | { ok: false; permanent: boolean }

export async function refreshGoogleToken(refreshToken: string): Promise<RefreshOutcome> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    // Our own misconfiguration — never the client's consent.
    console.error('[gbp/auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured')
    return { ok: false, permanent: false }
  }

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // Google signals a dead grant with 4xx + invalid_grant / invalid_client.
      const permanent =
        res.status >= 400 && res.status < 500 && /invalid_grant|invalid_client/i.test(body)
      console.error('[gbp/auth] refresh rejected by Google:', res.status, permanent ? '(permanent)' : '(transient)')
      return { ok: false, permanent }
    }

    const json = (await res.json()) as { access_token: string; expires_in: number }
    return { ok: true, access_token: json.access_token, expires_in: json.expires_in }
  } catch (err) {
    console.error('[gbp/auth] refresh call failed:', err instanceof Error ? err.message : err)
    return { ok: false, permanent: false }
  }
}
