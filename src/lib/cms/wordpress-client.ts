/**
 * wordpress-client — WordPress REST API v2 integration for Magic Engine.
 *
 * Authentication: Application Password — a per-user credential that does NOT
 * require OAuth. ME assumes a dedicated low-privilege WP user (e.g. "magic-engine")
 * with the minimum role needed to create posts/pages (Author or a custom role).
 * The Application Password is stored AES-256-GCM encrypted; ME only decrypts
 * server-side at publish time.
 *
 * Security:
 *  - URL is format-validated at save time (url-guard) and DNS-validated at
 *    runtime to prevent SSRF against hosts that resolve to private IPs.
 *  - All published HTML is sanitized upstream before reaching this layer.
 *  - Application Password is base64-encoded and sent only over HTTPS.
 *
 * Draft-first flow:
 *  1. createWordpressPostDraft / createWordpressPageDraft → status='draft'
 *  2. FDE confirms preview
 *  3. publishWordpressPost / publishWordpressPage → status='publish'
 *
 * Phase 14.A.5
 */

import { validateWordpressSiteUrl } from './url-guard'
import { assertPublicHost } from './ssrf-guard'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WordpressClientConfig {
  /** Normalized site URL, e.g. https://example.com (no trailing slash). */
  siteUrl:     string
  /** WP username paired with the Application Password. */
  username:    string
  /** Plain-text Application Password (spaces stripped; WP ignores them). */
  appPassword: string
}

export interface WordpressPostDraft {
  /** WP post ID (number serialised as string). */
  platformId:  string
  /** Preview URL for the draft post. */
  previewUrl:  string
}

export interface WordpressPageDraft {
  platformId:  string
  previewUrl:  string
}

export interface WordpressTestResult {
  ok:           boolean
  displayName?: string
  roles?:       string[]
  error?:       string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildBasicAuth(username: string, appPassword: string): string {
  // WP Application Passwords contain spaces every 4 chars — strip them first.
  const clean = appPassword.replace(/\s+/g, '')
  return `Basic ${Buffer.from(`${username}:${clean}`).toString('base64')}`
}


async function wpFetch(
  config:  WordpressClientConfig,
  path:    string,
  options: RequestInit = {},
): Promise<Response> {
  await assertPublicHost(config.siteUrl)

  const url = `${config.siteUrl}/wp-json/wp/v2${path}`
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': buildBasicAuth(config.username, config.appPassword),
      ...(options.headers ?? {}),
    },
  })
}

async function expectJson(
  res:     Response,
  context: string,
): Promise<Record<string, unknown>> {
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (typeof parsed.message === 'string') detail = parsed.message
    } catch {
      // keep raw text
    }
    throw new Error(`WordPress ${context} failed (${res.status}): ${detail}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`WordPress ${context}: invalid JSON response`)
  }
}

// ─── testWordpressConnection ───────────────────────────────────────────────────

/**
 * Verify credentials and confirm the WP user has a role that can publish content.
 * Calls GET /wp-json/wp/v2/users/me?context=edit with Application Password auth.
 */
export async function testWordpressConnection(
  config: WordpressClientConfig,
): Promise<WordpressTestResult> {
  const guard = validateWordpressSiteUrl(config.siteUrl)
  if (!guard.ok) {
    return { ok: false, error: guard.error }
  }

  try {
    const res  = await wpFetch(config, '/users/me?context=edit')
    const body = await expectJson(res, 'testConnection')

    const displayName = typeof body.name === 'string' ? body.name : undefined
    const roles = Array.isArray(body.roles)
      ? (body.roles as unknown[]).filter((r): r is string => typeof r === 'string')
      : []

    const PUBLISH_ROLES = new Set(['administrator', 'editor', 'author', 'contributor'])
    if (!roles.some(r => PUBLISH_ROLES.has(r))) {
      return {
        ok:    false,
        error: `User "${config.username}" has no publish role (roles: ${roles.join(', ') || 'none'})`,
      }
    }

    return { ok: true, displayName, roles }
  } catch (err) {
    return {
      ok:    false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ─── createWordpressPostDraft ─────────────────────────────────────────────────

export interface CreateWordpressPostPayload {
  title:       string
  /** HTML content body. Must be sanitized by the caller. */
  content:     string
  /** Post excerpt / meta description shown in search results. */
  excerpt?:    string
  /** WordPress category IDs. Defaults to uncategorized (1). */
  categories?: number[]
}

/**
 * Create a WordPress post draft (status='draft').
 * Returns the platform post ID and a preview URL.
 */
export async function createWordpressPostDraft(
  config:  WordpressClientConfig,
  payload: CreateWordpressPostPayload,
): Promise<WordpressPostDraft> {
  const body: Record<string, unknown> = {
    title:   payload.title,
    content: payload.content,
    excerpt: payload.excerpt ?? '',
    status:  'draft',
  }

  if (payload.categories && payload.categories.length > 0) {
    body.categories = payload.categories
  }

  const res  = await wpFetch(config, '/posts', { method: 'POST', body: JSON.stringify(body) })
  const data = await expectJson(res, 'createPostDraft')

  const postId     = String(data.id)
  const link       = typeof data.link === 'string' ? data.link : undefined
  const previewUrl = link
    ? `${link}?preview=true`
    : `${config.siteUrl}/?p=${postId}&preview=true`

  return { platformId: postId, previewUrl }
}

// ─── publishWordpressPost ─────────────────────────────────────────────────────

/**
 * Flip a draft post to published (status='publish').
 * WP REST API uses POST (not PUT) for partial updates.
 */
export async function publishWordpressPost(
  config: WordpressClientConfig,
  postId: string,
): Promise<void> {
  const res = await wpFetch(config, `/posts/${postId}`, {
    method: 'POST',
    body:   JSON.stringify({ status: 'publish', date: new Date().toISOString() }),
  })
  await expectJson(res, 'publishPost')
}

// ─── createWordpressPageDraft ─────────────────────────────────────────────────

export interface CreateWordpressPagePayload {
  title:    string
  /** HTML content body. Must be sanitized by the caller. */
  content:  string
  excerpt?: string
  /** Custom permalink slug. Auto-generated from title if omitted. */
  slug?:    string
}

/**
 * Create a WordPress page draft (status='draft').
 */
export async function createWordpressPageDraft(
  config:  WordpressClientConfig,
  payload: CreateWordpressPagePayload,
): Promise<WordpressPageDraft> {
  const body: Record<string, unknown> = {
    title:   payload.title,
    content: payload.content,
    excerpt: payload.excerpt ?? '',
    status:  'draft',
    ...(payload.slug ? { slug: payload.slug } : {}),
  }

  const res  = await wpFetch(config, '/pages', { method: 'POST', body: JSON.stringify(body) })
  const data = await expectJson(res, 'createPageDraft')

  const pageId     = String(data.id)
  const link       = typeof data.link === 'string' ? data.link : undefined
  const previewUrl = link
    ? `${link}?preview=true`
    : `${config.siteUrl}/?page_id=${pageId}&preview=true`

  return { platformId: pageId, previewUrl }
}

// ─── publishWordpressPage ─────────────────────────────────────────────────────

/**
 * Flip a draft page to published.
 */
export async function publishWordpressPage(
  config:  WordpressClientConfig,
  pageId:  string,
): Promise<void> {
  const res = await wpFetch(config, `/pages/${pageId}`, {
    method: 'POST',
    body:   JSON.stringify({ status: 'publish', date: new Date().toISOString() }),
  })
  await expectJson(res, 'publishPage')
}
