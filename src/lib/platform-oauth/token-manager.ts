/**
 * Platform OAuth Token Manager — Phase 24.A.2
 *
 * Single entry point for all platform API callers:
 *
 *   const token = await getValidToken(clientId, 'google_gbp')
 *   // token is always a valid plaintext access_token — never expired.
 *
 * If the stored token is expired (or within the 5-min safety buffer),
 * this module transparently:
 *   1. Decrypts the refresh_token
 *   2. Calls the provider's token endpoint
 *   3. Re-encrypts and persists the new access_token
 *   4. Returns the fresh token
 *
 * Callers never check expiry or trigger refresh themselves.
 * Server-side only.
 */

import { supabaseAdmin } from '../supabase'
import {
  decryptToken,
  encryptToken,
  isTokenExpired,
  PLATFORM_PROVIDERS,
  CONNECTION_STATUS,
  type PlatformProvider,
  type PlatformOAuthConnectionRow,
} from './vocabulary'

// ─── Custom errors ────────────────────────────────────────────────────────────

export class PlatformConnectionNotFoundError extends Error {
  readonly clientId: string
  readonly provider: PlatformProvider

  constructor(clientId: string, provider: PlatformProvider) {
    super(`No active ${provider} connection for client ${clientId}`)
    this.name      = 'PlatformConnectionNotFoundError'
    this.clientId  = clientId
    this.provider  = provider
  }
}

export class PlatformTokenRefreshError extends Error {
  readonly provider: PlatformProvider

  constructor(provider: PlatformProvider, reason: string) {
    super(`Token refresh failed for ${provider}: ${reason}`)
    this.name     = 'PlatformTokenRefreshError'
    this.provider = provider
  }
}

// ─── Provider-specific refresh logic ─────────────────────────────────────────

interface RefreshResult {
  accessToken: string
  expiresAt:   Date
}

async function refreshGoogleToken(refreshTokenPlain: string): Promise<RefreshResult> {
  const clientId     = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new PlatformTokenRefreshError(
      PLATFORM_PROVIDERS.GOOGLE_GBP,
      'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured',
    )
  }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshTokenPlain,
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable body)')
    throw new PlatformTokenRefreshError(PLATFORM_PROVIDERS.GOOGLE_GBP, `HTTP ${res.status}: ${text}`)
  }

  const data = (await res.json()) as {
    access_token?:       string
    expires_in?:         number
    error?:              string
    error_description?:  string
  }

  if (!data.access_token) {
    const detail = data.error_description ?? data.error ?? 'missing access_token in response'
    throw new PlatformTokenRefreshError(PLATFORM_PROVIDERS.GOOGLE_GBP, detail)
  }

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000)
  return { accessToken: data.access_token, expiresAt }
}

function isGoogleProvider(provider: PlatformProvider): boolean {
  return (
    provider === PLATFORM_PROVIDERS.GOOGLE_GBP ||
    provider === PLATFORM_PROVIDERS.GOOGLE_GSC ||
    provider === PLATFORM_PROVIDERS.GOOGLE_ADS
  )
}

async function callProviderRefresh(
  provider: PlatformProvider,
  refreshTokenPlain: string,
): Promise<RefreshResult> {
  if (isGoogleProvider(provider)) {
    return refreshGoogleToken(refreshTokenPlain)
  }
  // Phase 18 will add Meta / TikTok refresh
  throw new PlatformTokenRefreshError(
    provider,
    `Token refresh not yet implemented for provider=${provider}`,
  )
}

// ─── DB helpers (package-private for testing) ────────────────────────────────

export async function fetchConnectionRow(
  clientId: string,
  provider: PlatformProvider,
): Promise<PlatformOAuthConnectionRow> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', provider)
    .eq('status', CONNECTION_STATUS.ACTIVE)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    throw new PlatformConnectionNotFoundError(clientId, provider)
  }

  return data as PlatformOAuthConnectionRow
}

async function persistRefreshedToken(
  connectionId: string,
  accessToken:  string,
  expiresAt:    Date,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .update({
      access_token_enc: encryptToken(accessToken),
      token_expiry:     expiresAt.toISOString(),
      last_synced_at:   new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    })
    .eq('id', connectionId)

  if (error) {
    // Non-fatal: caller still gets a valid token.
    console.error('[token-manager] Failed to persist refreshed token:', error.message)
  }
}

async function markConnectionError(connectionId: string, message: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('platform_oauth_connections')
      .update({
        status:        CONNECTION_STATUS.ERROR,
        error_message: message.slice(0, 500),   // guard against very long messages
        updated_at:    new Date().toISOString(),
      })
      .eq('id', connectionId)
  } catch {
    // best-effort — never throw from error-marking
  }
}
// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return a valid plaintext access_token for the given client + provider.
 *
 * Transparently refreshes the token if expired.
 *
 * @throws {PlatformConnectionNotFoundError}  No active connection exists.
 * @throws {PlatformTokenRefreshError}         Refresh call failed (connection marked error).
 */
export async function getValidToken(
  clientId: string,
  provider: PlatformProvider,
): Promise<string> {
  const row         = await fetchConnectionRow(clientId, provider)
  const accessToken = decryptToken(row.access_token_enc)

  // Fast path — token still valid
  if (!isTokenExpired(row.token_expiry)) {
    return accessToken
  }

  // Slow path — token expired, refresh
  const refreshTokenPlain = decryptToken(row.refresh_token_enc)

  let refreshed: RefreshResult
  try {
    refreshed = await callProviderRefresh(provider, refreshTokenPlain)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await markConnectionError(row.id, msg)
    throw err
  }

  await persistRefreshedToken(row.id, refreshed.accessToken, refreshed.expiresAt)
  return refreshed.accessToken
}
