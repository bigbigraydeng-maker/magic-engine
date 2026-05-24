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
import type { CmsConnectionStatus, WordpressConnectionStatus, ShopifyConnectionStatus } from './vocabulary'
import { validateWordpressSiteUrl } from './url-guard'
import { validateShopifyShopUrl } from './shopify-guard'

// ─── Row type ────────────────────────────────────────────────────────────────

interface CmsConnectionRow {
  id:              string
  client_id:       string
  provider:        string
  repo_owner:      string | null
  repo_name:       string | null
  default_branch:  string | null
  content_paths:   string[]
  site_url:        string | null
  username:        string | null
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
    repoOwner:    row.repo_owner    ?? '',
    repoName:     row.repo_name     ?? '',
    branch:       row.default_branch ?? '',
    tokenHint:    row.token_last_four,
    status:       row.status as CmsConnectionStatus['status'],
    lastError:    row.last_error,
    lastTestedAt: row.last_tested_at,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WordPress connection — separate API surface, same table, same crypto.
// Phase 14.A.3 ships the CRUD; the actual Application-Password fetch lands
// in P14.A.5.
// ═══════════════════════════════════════════════════════════════════════════

export interface UpsertWordpressConnectionParams {
  clientId:         string
  /** Site origin — will be re-validated and normalized to `https://host[:443]`. */
  siteUrl:          string
  /** Dedicated WP user paired with the Application Password (e.g. "magic-engine"). */
  username:         string
  /** Plain-text WP Application Password — encrypted before storage. */
  plainAppPassword: string
}

export async function upsertWordpressConnection(
  params: UpsertWordpressConnectionParams,
): Promise<WordpressConnectionStatus> {
  const { clientId, siteUrl, username, plainAppPassword } = params

  const guard = validateWordpressSiteUrl(siteUrl)
  if (!guard.ok || !guard.normalizedUrl) {
    throw new Error(guard.error ?? 'Invalid site_url')
  }
  if (!username.trim()) {
    throw new Error('username required')
  }
  if (plainAppPassword.length < 10) {
    throw new Error('app_password required (min 10 chars)')
  }

  const encrypted = encryptToken(plainAppPassword)
  const hint      = tokenLastFour(plainAppPassword)

  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .upsert(
      {
        client_id:       clientId,
        provider:        CMS_PROVIDER.WORDPRESS,
        site_url:        guard.normalizedUrl,
        username:        username.trim(),
        // GitHub-only columns are nullable now; keep WordPress rows clean.
        repo_owner:      null,
        repo_name:       null,
        default_branch:  null,
        content_paths:   [],
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

  if (error) throw new Error(`cms_connections upsert (wordpress) failed: ${error.message}`)

  return rowToWordpressStatus(data as CmsConnectionRow)
}

export async function getWordpressConnectionStatus(
  clientId: string,
): Promise<WordpressConnectionStatus | null> {
  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.WORDPRESS)
    .maybeSingle()

  if (error) throw new Error(`cms_connections select (wordpress) failed: ${error.message}`)
  if (!data)  return null

  return rowToWordpressStatus(data as CmsConnectionRow)
}

/**
 * Server-only — returns the decrypted Application Password.
 * Used by the WordPress publish connector (P14.A.5). NEVER import from a
 * module that runs in the browser.
 */
export async function getWordpressConnection(
  clientId: string,
): Promise<(WordpressConnectionStatus & { plainAppPassword: string }) | null> {
  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.WORDPRESS)
    .maybeSingle()

  if (error) throw new Error(`cms_connections select (wordpress) failed: ${error.message}`)
  if (!data)  return null

  const row = data as CmsConnectionRow
  const plainAppPassword = decryptToken(row.encrypted_token)

  return {
    ...rowToWordpressStatus(row),
    plainAppPassword,
  }
}

export async function markWordpressConnectionTested(
  clientId:  string,
  success:   boolean,
  errorMsg?: string,
): Promise<WordpressConnectionStatus | null> {
  const { data, error: dbErr } = await supabaseAdmin
    .from('cms_connections')
    .update({
      status:         success ? CMS_STATUS.CONNECTED : CMS_STATUS.ERROR,
      last_error:     success ? null : (errorMsg ?? 'Unknown error'),
      last_tested_at: new Date().toISOString(),
    })
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.WORDPRESS)
    .select()
    .maybeSingle()

  if (dbErr) throw new Error(`cms_connections update (wordpress) failed: ${dbErr.message}`)
  if (!data)  return null

  return rowToWordpressStatus(data as CmsConnectionRow)
}

export async function deleteWordpressConnection(clientId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('cms_connections')
    .delete()
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.WORDPRESS)

  if (error) throw new Error(`cms_connections delete (wordpress) failed: ${error.message}`)
}

function rowToWordpressStatus(row: CmsConnectionRow): WordpressConnectionStatus {
  return {
    connected:    row.status === CMS_STATUS.CONNECTED,
    provider:     CMS_PROVIDER.WORDPRESS,
    siteUrl:      row.site_url ?? '',
    username:     row.username ?? '',
    tokenHint:    row.token_last_four,
    status:       row.status as WordpressConnectionStatus['status'],
    lastError:    row.last_error,
    lastTestedAt: row.last_tested_at,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shopify connection — same table, same crypto.
// Phase 14.A.4: write_content scope (write_blogs + write_pages).
// ═══════════════════════════════════════════════════════════════════════════

export interface UpsertShopifyConnectionParams {
  clientId:   string
  /** Shop URL — will be validated and normalized to https://host. */
  shopUrl:    string
  /** Plain-text Admin API access token — encrypted before storage. */
  plainToken: string
}

export async function upsertShopifyConnection(
  params: UpsertShopifyConnectionParams,
): Promise<ShopifyConnectionStatus> {
  const { clientId, shopUrl, plainToken } = params

  const guard = validateShopifyShopUrl(shopUrl)
  if (!guard.ok || !guard.normalizedUrl) {
    throw new Error(guard.error ?? 'Invalid shop_url')
  }
  if (plainToken.trim().length < 10) {
    throw new Error('access_token required (min 10 chars)')
  }

  const encrypted = encryptToken(plainToken)
  const hint      = tokenLastFour(plainToken)

  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .upsert(
      {
        client_id:       clientId,
        provider:        CMS_PROVIDER.SHOPIFY,
        site_url:        guard.normalizedUrl,
        username:        null,
        repo_owner:      null,
        repo_name:       null,
        default_branch:  null,
        content_paths:   [],
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

  if (error) throw new Error(`cms_connections upsert (shopify) failed: ${error.message}`)

  return rowToShopifyStatus(data as CmsConnectionRow)
}

export async function getShopifyConnectionStatus(
  clientId: string,
): Promise<ShopifyConnectionStatus | null> {
  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.SHOPIFY)
    .maybeSingle()

  if (error) throw new Error(`cms_connections select (shopify) failed: ${error.message}`)
  if (!data)  return null

  return rowToShopifyStatus(data as CmsConnectionRow)
}

/**
 * Server-only — returns the decrypted Admin API access token.
 * Used by the Shopify publish connector. NEVER import from browser modules.
 */
export async function getShopifyConnection(
  clientId: string,
): Promise<(ShopifyConnectionStatus & { plainToken: string }) | null> {
  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.SHOPIFY)
    .maybeSingle()

  if (error) throw new Error(`cms_connections select (shopify) failed: ${error.message}`)
  if (!data)  return null

  const row        = data as CmsConnectionRow
  const plainToken = decryptToken(row.encrypted_token)

  return {
    ...rowToShopifyStatus(row),
    plainToken,
  }
}

export async function markShopifyConnectionTested(
  clientId: string,
  success:  boolean,
  errorMsg?: string,
): Promise<ShopifyConnectionStatus | null> {
  const { data, error: dbErr } = await supabaseAdmin
    .from('cms_connections')
    .update({
      status:         success ? CMS_STATUS.CONNECTED : CMS_STATUS.ERROR,
      last_error:     success ? null : (errorMsg ?? 'Unknown error'),
      last_tested_at: new Date().toISOString(),
    })
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.SHOPIFY)
    .select()
    .maybeSingle()

  if (dbErr) throw new Error(`cms_connections update (shopify) failed: ${dbErr.message}`)
  if (!data)  return null

  return rowToShopifyStatus(data as CmsConnectionRow)
}

export async function deleteShopifyConnection(clientId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('cms_connections')
    .delete()
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.SHOPIFY)

  if (error) throw new Error(`cms_connections delete (shopify) failed: ${error.message}`)
}

function rowToShopifyStatus(row: CmsConnectionRow): ShopifyConnectionStatus {
  return {
    connected:    row.status === CMS_STATUS.CONNECTED,
    provider:     CMS_PROVIDER.SHOPIFY,
    shopUrl:      row.site_url ?? '',
    tokenHint:    row.token_last_four,
    status:       row.status as ShopifyConnectionStatus['status'],
    lastError:    row.last_error,
    lastTestedAt: row.last_tested_at,
  }
}
