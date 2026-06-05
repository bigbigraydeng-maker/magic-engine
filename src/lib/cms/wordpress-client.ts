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


// Identifies Magic Engine to host-side firewalls (e.g. SiteGround WAF).
// A missing or generic User-Agent (bare Node.js fetch) can trigger IP bans.
const ME_USER_AGENT = 'MagicEngine/1.0 (WordPress Publisher; +https://magicengine.com.au)'

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
      'User-Agent':    ME_USER_AGENT,
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
    // Show the first 300 chars of the non-JSON response so FDE can diagnose
    // (common causes: Cloudflare challenge, security plugin block, maintenance page).
    const preview = text.slice(0, 300).replace(/\s+/g, ' ').trim()
    throw new Error(
      `WordPress ${context}: response is not JSON — the site may be blocking REST API access ` +
      `(Cloudflare, security plugin, or maintenance mode). Response preview: "${preview}"`
    )
  }
}

// ─── probeYoastMetaWritable ────────────────────────────────────────────────────

/**
 * P14.B.1 — Probe whether Yoast SEO meta keys are REST-writable on this WP site.
 *
 * Strategy: attempt to PATCH _yoast_wpseo_title on a known post with its
 * existing value (a no-op write). If WP returns 200 the key is registered
 * and writable; if 403 / "rest_cannot_edit_post_meta" the mu-plugin is absent.
 *
 * We use the most recently modified post so we don't need to know a specific ID.
 * If no posts exist, returns { writable: false, reason: 'no_posts' }.
 */
export interface YoastProbeResult {
  writable: boolean
  reason?:  string
}

export async function probeYoastMetaWritable(
  config: WordpressClientConfig,
): Promise<YoastProbeResult> {
  const guard = validateWordpressSiteUrl(config.siteUrl)
  if (!guard.ok) return { writable: false, reason: 'invalid_url' }

  try {
    // 1. Fetch the most recent post to get a real post ID + existing title meta.
    const listRes  = await wpFetch(config, '/posts?per_page=1&orderby=modified&order=desc&context=edit')
    const listText = await listRes.text()
    if (!listRes.ok) return { writable: false, reason: `list_posts_failed_${listRes.status}` }

    let posts: Array<Record<string, unknown>>
    try {
      posts = JSON.parse(listText) as Array<Record<string, unknown>>
    } catch {
      return { writable: false, reason: 'list_parse_error' }
    }
    if (!Array.isArray(posts) || posts.length === 0) {
      return { writable: false, reason: 'no_posts' }
    }

    const post = posts[0]
    const postId = String(post.id ?? '')
    if (!postId) return { writable: false, reason: 'no_post_id' }

    // 2. Read the existing yoast title (may be empty string — that's fine).
    const existingMeta = (post.meta ?? {}) as Record<string, unknown>
    const existingTitle = typeof existingMeta._yoast_wpseo_title === 'string'
      ? existingMeta._yoast_wpseo_title
      : ''

    // 3. PATCH the meta with the same value — a no-op write.
    const patchRes = await wpFetch(config, `/posts/${postId}`, {
      method: 'POST',
      body:   JSON.stringify({ meta: { _yoast_wpseo_title: existingTitle } }),
    })

    if (patchRes.ok) return { writable: true }

    const errText = await patchRes.text()
    return { writable: false, reason: `patch_${patchRes.status}: ${errText.slice(0, 200)}` }
  } catch (err) {
    return { writable: false, reason: err instanceof Error ? err.message : 'unknown' }
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
  /** Custom permalink slug (e.g. "engineered-timber-flooring-brisbane"). */
  slug?:             string
  /**
   * Yoast SEO fields — written via WP REST API meta object.
   * Requires Yoast SEO 14.0+ with REST API meta enabled.
   * Silently skipped if Yoast is not active.
   */
  seoTitle?:         string   // → _yoast_wpseo_title
  seoDescription?:   string   // → _yoast_wpseo_metadesc
  focusKeyphrase?:   string   // → _yoast_wpseo_focuskw
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

  if (payload.slug) {
    body.slug = payload.slug
  }

  // Yoast SEO meta — requires Yoast SEO 14.0+ with REST API enabled.
  // WP silently ignores unknown meta keys, so this is safe on non-Yoast installs.
  const yoastMeta: Record<string, string> = {}
  if (payload.seoTitle)       yoastMeta._yoast_wpseo_title    = payload.seoTitle
  if (payload.seoDescription) yoastMeta._yoast_wpseo_metadesc = payload.seoDescription
  if (payload.focusKeyphrase) yoastMeta._yoast_wpseo_focuskw  = payload.focusKeyphrase
  if (Object.keys(yoastMeta).length > 0) body.meta = yoastMeta

  const res  = await wpFetch(config, '/posts', { method: 'POST', body: JSON.stringify(body) })
  const data = await expectJson(res, 'createPostDraft')

  const postId     = String(data.id)
  const link       = typeof data.link === 'string' ? data.link : undefined
  // Draft links often already contain a query string (e.g. /?p=123), so we must
  // use '&' instead of '?' when appending the preview parameter.
  const previewUrl = link
    ? (link.includes('?') ? `${link}&preview=true` : `${link}?preview=true`)
    : `${config.siteUrl}/?p=${postId}&preview=true`

  return { platformId: postId, previewUrl }
}

// ─── publishWordpressPost ─────────────────────────────────────────────────────

export interface WordpressPublishResult {
  /** The live URL of the published post/page. Present after status='publish'. */
  link: string | null
}

/**
 * Flip a draft post to published (status='publish').
 * WP REST API uses POST (not PUT) for partial updates.
 * Returns the live link for the published post (P14.B.7 — used to request GSC indexing).
 */
export async function publishWordpressPost(
  config: WordpressClientConfig,
  postId: string,
): Promise<WordpressPublishResult> {
  const res  = await wpFetch(config, `/posts/${postId}`, {
    method: 'POST',
    body:   JSON.stringify({ status: 'publish', date: new Date().toISOString() }),
  })
  const data = await expectJson(res, 'publishPost')
  return { link: typeof data.link === 'string' ? data.link : null }
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
    ? (link.includes('?') ? `${link}&preview=true` : `${link}?preview=true`)
    : `${config.siteUrl}/?page_id=${pageId}&preview=true`

  return { platformId: pageId, previewUrl }
}

// ─── publishWordpressPage ─────────────────────────────────────────────────────

/**
 * Flip a draft page to published.
 * Returns the live link (P14.B.7 — used to request GSC indexing).
 */
export async function publishWordpressPage(
  config:  WordpressClientConfig,
  pageId:  string,
): Promise<WordpressPublishResult> {
  const res  = await wpFetch(config, `/pages/${pageId}`, {
    method: 'POST',
    body:   JSON.stringify({ status: 'publish', date: new Date().toISOString() }),
  })
  const data = await expectJson(res, 'publishPage')
  return { link: typeof data.link === 'string' ? data.link : null }
}

// ─── deleteWordpressPost / deleteWordpressPage ────────────────────────────────

/**
 * P14.B.2 — Permanently delete a WordPress post draft by moving it to trash.
 * WP REST API DELETE with `?force=true` bypasses trash. We use force=false
 * so FDE can still recover from WP trash if needed.
 */
export async function deleteWordpressPost(
  config: WordpressClientConfig,
  postId: string,
): Promise<void> {
  const res = await wpFetch(config, `/posts/${postId}`, { method: 'DELETE' })
  // 200 = trashed, 410 = already deleted. Both are acceptable.
  if (!res.ok && res.status !== 410) {
    const text = await res.text()
    throw new Error(`WordPress deletePost failed (${res.status}): ${text.slice(0, 200)}`)
  }
}

/**
 * P14.B.2 — Move a WordPress page draft to trash.
 */
export async function deleteWordpressPage(
  config: WordpressClientConfig,
  pageId: string,
): Promise<void> {
  const res = await wpFetch(config, `/pages/${pageId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 410) {
    const text = await res.text()
    throw new Error(`WordPress deletePage failed (${res.status}): ${text.slice(0, 200)}`)
  }
}
