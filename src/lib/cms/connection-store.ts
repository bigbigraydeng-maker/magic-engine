/**
 * CMS Connection Store — server-only persistence layer for cms_connections.
 *
 * Strict security separation:
 *  - getConnection()       → returns decrypted PAT (server/orchestrator only)
 *  - getConnectionStatus() → returns safe display data (no PAT, for UI/routes)
 *
 * NEVER export getConnection() from a module that is imported by client
 * components. It must only be called from server-side orchestration code.
 */

import { supabaseAdmin } from '../supabase'
import { encryptToken, decryptToken, tokenLastFour } from './crypto'
import { CMS_STATUS, CMS_PROVIDER } from './vocabulary'
import type { CmsConnectionStatus } from './vocabulary'

// ─── Row type ────────────────────────────────────────────────────────────────

interface CmsConnectionRow {
  id:              string
  client_id:       string
  provider:        string
  repo_owner:      string
  repo_name:       string
  default_branch:  string
  content_paths:   string[]
  encrypted_token: string
  token_last_four: string | null
  status:          string
  last_error:      string | null
  last_tested_at:  string | null
  created_at:      string
  updated_at:      string
}

// ─── UpsertParams ────────────────────────────────────────────────────────────

export interface UpsertCmsConnectionParams {
  clientId:       string
  repoOwner:      string
  repoName:       string
  defaultBranch?: string
  contentPaths?:  string[]
  /** Plain-text GitHub PAT — will be encrypted before storage. */
  plainToken:     string
}

// ─── upsertConnection ────────────────────────────────────────────────────────

/**
 * Create or replace the CMS connection for a client.
 * Encrypts the PAT before writing.
 */
export async function upsertConnection(
  params: UpsertCmsConnectionParams,
): Promise<CmsConnectionStatus> {
  const {
    clientId,
    repoOwner,
    repoName,
    defaultBranch = 'main',
    contentPaths  = [],
    plainToken,
  } = params

  const encrypted = encryptToken(plainToken)
  const hint      = tokenLastFour(plainToken)

  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .upsert(
      {
        client_id:       clientId,
        provider:        CMS_PROVIDER.GITHUB,
        repo_owner:      repoOwner,
        repo_name:       repoName,
        default_branch:  defaultBranch,
        content_paths:   contentPaths,
        encrypted_token: encrypted,
        token_last_four: hint,
        status:          CMS_STATUS.DISCONNECTED,
        last_error:      null,
        last_tested_at:  null,
      },
      { onConflict: 'client_id,provider' },
    )
    .select()
    .single()

  if (error) throw new Error(`cms_connections upsert failed: ${error.message}`)

  return rowToStatus(data as CmsConnectionRow)
}

// ─── getConnectionStatus ─────────────────────────────────────────────────────

/**
 * Return safe display data (no PAT) for the client's CMS connection.
 * Returns null if no connection exists.
 */
export async function getConnectionStatus(
  clientId: string,
): Promise<CmsConnectionStatus | null> {
  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.GITHUB)
    .maybeSingle()

  if (error) throw new Error(`cms_connections select failed: ${error.message}`)
  if (!data)  return null

  return rowToStatus(data as CmsConnectionRow)
}

// ─── getConnection ───────────────────────────────────────────────────────────

/**
 * Return the full connection including the DECRYPTED PAT.
 *
 * !! SERVER-SIDE ONLY — NEVER call from client components !!
 *
 * Returns null if no connection exists.
 */
export async function getConnection(
  clientId: string,
): Promise<(CmsConnectionStatus & { plainToken: string }) | null> {
  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.GITHUB)
    .maybeSingle()

  if (error) throw new Error(`cms_connections select failed: ${error.message}`)
  if (!data)  return null

  const row = data as CmsConnectionRow
  const plainToken = decryptToken(row.encrypted_token)

  return {
    ...rowToStatus(row),
    plainToken,
  }
}

// ─── markConnectionTested ────────────────────────────────────────────────────

/**
 * Update the status + last_tested_at after a connection test.
 */
export async function markConnectionTested(
  clientId: string,
  success:  boolean,
  error?:   string,
): Promise<CmsConnectionStatus | null> {
  const { data, error: dbErr } = await supabaseAdmin
    .from('cms_connections')
    .update({
      status:        success ? CMS_STATUS.CONNECTED : CMS_STATUS.ERROR,
      last_error:    success ? null : (error ?? 'Unknown error'),
      last_tested_at: new Date().toISOString(),
    })
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.GITHUB)
    .select()
    .maybeSingle()

  if (dbErr) throw new Error(`cms_connections update failed: ${dbErr.message}`)
  if (!data)  return null

  return rowToStatus(data as CmsConnectionRow)
}

// ─── deleteConnection ────────────────────────────────────────────────────────

export async function deleteConnection(clientId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('cms_connections')
    .delete()
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.GITHUB)

  if (error) throw new Error(`cms_connections delete failed: ${error.message}`)
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function rowToStatus(row: CmsConnectionRow): CmsConnectionStatus {
  return {
    connected:    row.status === CMS_STATUS.CONNECTED,
    provider:     row.provider as CmsConnectionStatus['provider'],
    repoOwner:    row.repo_owner,
    repoName:     row.repo_name,
    branch:       row.default_branch,
    tokenHint:    row.token_last_four,
    status:       row.status as CmsConnectionStatus['status'],
    lastError:    row.last_error,
    lastTestedAt: row.last_tested_at,
  }
}
