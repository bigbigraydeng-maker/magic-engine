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
import { CMS_STATUS, CMS_PROVIDER, isCmsContentTarget } from './vocabulary'
import type {
  CmsConnectionStatus,
  WordpressConnectionStatus,
  ShopifyConnectionStatus,
  CmsContentTarget,
} from './vocabulary'
import { validateWordpressSiteUrl } from './url-guard'
import { validateShopifyShopUrl } from './shopify-guard'

// ─── Row type ────────────────────────────────────────────────────────────────

interface CmsConnectionRow {
  id:                     string
  client_id:              string
  provider:               string
  repo_owner:             string | null
  repo_name:              string | null
  default_branch:         string | null
  content_paths:          string[]
  /** B1: GEO-B+ Stage 1 — typed injection targets. */
  content_targets:        unknown
  site_url:               string | null
  username:               string | null
  encrypted_token:        string
  token_last_four:        string | null
  status:                 string
  last_error:             string | null
  last_tested_at:         string | null
  created_at:             string
  updated_at:             string
  /** P14.B.1 */
  yoast_plugin_installed: boolean | null
  /** P14.B.6 */
  wp_default_category_id: number | null
}

// ─── UpsertParams ────────────────────────────────────────────────────────────

export interface UpsertCmsConnectionParams {
  clientId:       string
  repoOwner:      string
  repoName:       string
  defaultBranch?: string
  contentPaths?:  string[]
  /** B1: list of GEO snippet injection targets. Accepts unknown so route
   *  handlers can pass raw JSON straight through; normaliseContentTargets
   *  enforces the whitelist (syntax ∈ {html, php}, role = global_head)
   *  before the value reaches Postgres. */
  contentTargets?: unknown
  /** Plain-text GitHub PAT — will be encrypted before storage. */
  plainToken:     string
}

// ─── Content target validation (mirror of DB CHECK constraint) ───────────────

/**
 * Thrown by normaliseContentTargets when caller input fails the MVP whitelist.
 *
 * B2 carryover from 魏征 B1 review: previously route handlers used
 * `message.startsWith('Invalid content target')` to distinguish 400 vs 500.
 * That was fragile — any wording change would silently degrade to 500. Routes
 * now check `err instanceof CmsContentTargetValidationError`.
 */
export class CmsContentTargetValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CmsContentTargetValidationError'
  }
}

/**
 * Normalises the caller-supplied list, throwing if any element fails the
 * whitelist. We validate in JS first so the API can return a 400 with a clean
 * message instead of bubbling a Postgres CHECK violation up to the FDE.
 */
export function normaliseContentTargets(
  input: unknown,
): CmsContentTarget[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    throw new CmsContentTargetValidationError('contentTargets must be an array')
  }
  const out: CmsContentTarget[] = []
  for (const raw of input) {
    if (!isCmsContentTarget(raw)) {
      throw new CmsContentTargetValidationError(
        'Invalid content target — expected {path, syntax (html|php), role (global_head), label?}',
      )
    }
    // Trim BEFORE re-checking empty, so a whitespace-only path (which DB CHECK
    // would reject as empty) is caught here as a 400 instead of bubbling up as
    // a 500 from the Postgres constraint violation.
    const trimmedPath = raw.path.trim()
    if (trimmedPath === '') {
      throw new CmsContentTargetValidationError(
        'Invalid content target — path cannot be blank',
      )
    }
    // Repo-relative paths only. A leading '/' would produce '/repos/o/r/contents//path'
    // on the GitHub API call and 400 with an opaque "Invalid path" — catch it here
    // so the FDE sees an actionable error.
    if (trimmedPath.startsWith('/')) {
      throw new CmsContentTargetValidationError(
        'Invalid content target — path must be repo-relative (no leading "/")',
      )
    }
    out.push({
      path:   trimmedPath,
      syntax: raw.syntax,
      role:   raw.role,
      ...(raw.label !== undefined ? { label: raw.label } : {}),
    })
  }
  return out
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
    defaultBranch  = 'main',
    contentPaths   = [],
    contentTargets = [],
    plainToken,
  } = params

  const encrypted   = encryptToken(plainToken)
  const hint        = tokenLastFour(plainToken)
  const safeTargets = normaliseContentTargets(contentTargets)

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
        content_targets: safeTargets,
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

/**
 * Update only the content_targets list. Useful for the Settings UI which
 * needs to add/remove targets without re-typing the PAT.
 */
export async function updateContentTargets(
  clientId: string,
  targets:  unknown,
): Promise<CmsConnectionStatus | null> {
  const safeTargets = normaliseContentTargets(targets)
  const { data, error } = await supabaseAdmin
    .from('cms_connections')
    .update({ content_targets: safeTargets })
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.GITHUB)
    .select()
    .maybeSingle()

  if (error) throw new Error(`cms_connections content_targets update failed: ${error.message}`)
  if (!data)  return null

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
    connected:      row.status === CMS_STATUS.CONNECTED,
    provider:       row.provider as CmsConnectionStatus['provider'],
    repoOwner:      row.repo_owner    ?? '',
    repoName:       row.repo_name     ?? '',
    branch:         row.default_branch ?? '',
    tokenHint:      row.token_last_four,
    status:         row.status as CmsConnectionStatus['status'],
    lastError:      row.last_error,
    lastTestedAt:   row.last_tested_at,
    contentTargets: parseContentTargets(row.content_targets),
  }
}

/**
 * Defensive parse: DB CHECK guarantees shape on writes that go through us,
 * but a row may have been written outside the app (manual SQL). Drop any
 * malformed elements so the UI never crashes on a bad row.
 */
function parseContentTargets(raw: unknown): CmsContentTarget[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isCmsContentTarget)
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
    connected:            row.status === CMS_STATUS.CONNECTED,
    provider:             CMS_PROVIDER.WORDPRESS,
    siteUrl:              row.site_url ?? '',
    username:             row.username ?? '',
    tokenHint:            row.token_last_four,
    status:               row.status as WordpressConnectionStatus['status'],
    lastError:            row.last_error,
    lastTestedAt:         row.last_tested_at,
    yoastPluginInstalled: row.yoast_plugin_installed ?? false,
    wpDefaultCategoryId:  row.wp_default_category_id ?? null,
  }
}

// ─── P14.B.1: mark Yoast probe result ────────────────────────────────────────

/**
 * Update yoast_plugin_installed flag after probe completes.
 * Called by the /cms/wordpress/yoast-probe route.
 */
export async function setYoastPluginInstalled(
  clientId: string,
  installed: boolean,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('cms_connections')
    .update({ yoast_plugin_installed: installed })
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.WORDPRESS)

  if (error) throw new Error(`setYoastPluginInstalled failed: ${error.message}`)
}

// ─── P14.B.6: update default WP category ────────────────────────────────────

/**
 * Persist the default WP category ID for a client's WP connection.
 * null clears the override (WP defaults to uncategorized).
 * Called by the dedicated PATCH /cms/wordpress/category route.
 */
export async function setWpDefaultCategoryId(
  clientId: string,
  categoryId: number | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('cms_connections')
    .update({ wp_default_category_id: categoryId })
    .eq('client_id', clientId)
    .eq('provider', CMS_PROVIDER.WORDPRESS)

  if (error) throw new Error(`setWpDefaultCategoryId failed: ${error.message}`)
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
