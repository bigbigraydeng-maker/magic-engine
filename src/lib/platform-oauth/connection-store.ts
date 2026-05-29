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
        access_token_enc:  encryptToken(input.accessToken),
        refresh_token_enc: encryptToken(input.refreshToken),
        token_expiry:      input.tokenExpiry.toISOString(),
        account_id:        input.accountId,
        location_name:     input.locationName ?? null,
        display_name:      input.displayName,
        scopes:            input.scopes,
        status:            CONNECTION_STATUS.ACTIVE,
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

/**
 * List all connections for a client — safe for frontend consumption.
 * Returns PlatformConnectionSummary[] (no encrypted token fields).
 * Non-throwing: returns [] on DB error.
 */
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
