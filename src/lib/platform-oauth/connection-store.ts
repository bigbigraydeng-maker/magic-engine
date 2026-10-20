/**
 * Platform OAuth Connection Store — Phase 24.A.5
 *
 * CRUD operations for platform_oauth_connections.
 * All plaintext tokens are encrypted here before hitting the DB.
 * Callers never deal with encryption directly.
 *
 * Usage:
 *   await upsertConnection({ clientId, provider, accessToken, refreshToken, ... })
 *   const summaries = await listConnections(clientId)
 *   const row       = await getConnectionById(id)
 *   await revokeConnection(id)
 */

import { supabaseAdmin } from '../supabase'
import type { SocialConnectionFact } from './social-onboarding'
import {
  encryptToken,
  toConnectionSummary,
  CONNECTION_STATUS,
  type PlatformOAuthConnectionRow,
  type PlatformConnectionSummary,
  type UpsertConnectionInput,
} from './vocabulary'

// ─── Write operations ────────────────────────────────────────────────────────

/**
 * Upsert a platform connection.
 * Encrypts tokens, resolves expiry, then writes to DB.
 * On conflict (same client + provider + account), updates the existing row.
 *
 * @throws {Error} if the DB operation fails
 */
export async function upsertConnection(input: UpsertConnectionInput): Promise<void> {
  const { error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .upsert(
      {
        client_id:         input.clientId,
        provider:          input.provider,
        ...(input.purpose ? { purpose: input.purpose } : {}),
        ...(input.authorizingPrincipalId ? { authorizing_principal_id: input.authorizingPrincipalId } : {}),
        ...(input.entitlementRevision ? { entitlement_revision: input.entitlementRevision } : {}),
        access_token_enc:  encryptToken(input.accessToken),
        refresh_token_enc: encryptToken(input.refreshToken),
        token_expiry:      input.tokenExpiry.toISOString(),
        account_id:        input.accountId,
        location_name:     input.locationName ?? null,
        display_name:      input.displayName,
        scopes:            input.scopes,
        status:            CONNECTION_STATUS.ACTIVE,
        // 🔴 状态改回 active 就必须把旧报错擦掉，否则一条健康的连接会永远
        //    挂着上次断线的原文。2026-09-24 实测：CTS 的 info@ 重连之后
        //    status=active、error_message 还是 9 天前那条 AADSTS65001 ——
        //    任何"按报错找坏连接"的排查都会被它骗一次。
        error_message:     null,
        // Only touch last_synced_at when the caller just re-verified the grant.
        // Omitting the key entirely (rather than writing null) keeps an
        // existing value intact on an upsert that is not a fresh sync.
        ...(input.lastSyncedAt ? { last_synced_at: input.lastSyncedAt.toISOString() } : {}),
        updated_at:        new Date().toISOString(),
      },
      { onConflict: 'client_id,provider,account_id' },
    )

  if (error) {
    throw new Error(`Failed to upsert connection: ${error.message}`)
  }
}

/**
 * Mark a connection as revoked. The row is retained for audit purposes.
 *
 * @throws {Error} if the DB operation fails
 */
export async function revokeConnection(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .update({
      status:     CONNECTION_STATUS.REVOKED,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    throw new Error(`Failed to revoke connection: ${error.message}`)
  }
}

// ─── Read operations ─────────────────────────────────────────────────────────

/** Narrow, fail-closed read for social onboarding; never selects credentials or provider errors. */
export async function listSocialConnectionFacts(clientId: string): Promise<SocialConnectionFact[]> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id,provider,purpose,account_id,location_name,display_name,status,scopes,token_expiry,last_synced_at')
    .eq('client_id', clientId)
    .eq('purpose', 'legacy')
    .in('provider', ['meta', 'instagram', 'tiktok', 'google_youtube'])
  if (error || !data) throw new Error('Social connection facts unavailable')
  return data as SocialConnectionFact[]
}

/** Confirm that the grant just written is the one this client can actually use.
 * The timestamp checks prevent an older grant for the same account from passing a new callback.
 * Reads only the credential-free onboarding projection.
 */
export async function confirmSocialConnectionWrite(input: {
  clientId: string
  provider: 'google_youtube' | 'instagram'
  accountId: string
  requiredScopes: readonly string[]
  tokenExpiry: Date
  verifiedAt: Date
  locationName?: string
}): Promise<boolean> {
  const rows = (await listSocialConnectionFacts(input.clientId))
    .filter(row => row.provider === input.provider && row.purpose === 'legacy' && row.status !== 'revoked')
  if (rows.length !== 1) return false
  const row = rows[0]
  const scopes = row.scopes
  return row.account_id === input.accountId && row.status === 'active'
    && (input.locationName === undefined || row.location_name === input.locationName)
    && Array.isArray(scopes)
    && scopes.every(scope => typeof scope === 'string')
    && input.requiredScopes.every(scope => scopes.includes(scope))
    && typeof row.token_expiry === 'string'
    && Date.parse(row.token_expiry) === input.tokenExpiry.getTime()
    && input.tokenExpiry.getTime() > Date.now()
    && typeof row.last_synced_at === 'string'
    && Date.parse(row.last_synced_at) === input.verifiedAt.getTime()
}

/** Legacy summary contract: returns [] on DB error. New onboarding uses the strict narrow read above. */
export async function listConnections(clientId: string): Promise<PlatformConnectionSummary[]> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error || !data) {
    if (error) {
      console.error('[connection-store] listConnections error:', error.message)
    }
    return []
  }

  return data.map(row => toConnectionSummary(row as PlatformOAuthConnectionRow))
}

/**
 * Fetch the full row by primary key.
 * Returns null if not found or on error.
 * IMPORTANT: the returned row contains encrypted token fields — never send to client.
 */
export async function getConnectionById(id: string): Promise<PlatformOAuthConnectionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return null
  return data as PlatformOAuthConnectionRow
}
