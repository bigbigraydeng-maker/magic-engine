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

// P12.R.B6 — wpFetch hardening defaults.
// SiteGround captcha typically redirects within < 5s; 10s gives plenty of head-
// room for slow shared hosting while bounding the worst case for the caller.
const DEFAULT_TIMEOUT_MS = 10_000
const RETRY_BACKOFF_MS   = 200
// Cap body capture for WAF fingerprinting at 2KB — long enough to catch
// markers in <meta> / <title> but not so long it blows error logs.
const WAF_BODY_SCAN_BYTES = 2048

// ─── Custom error class & codes ───────────────────────────────────────────────

export type WordpressErrorCode =
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SITEGROUND_ANTIBOT'
  | 'CLOUDFLARE_CHALLENGE'
  | 'WORDFENCE_BLOCK'
  | 'SUCURI_BLOCK'
  | 'GENERIC_WAF'
  | 'WP_REST_DISABLED'
  | 'HTTP_ERROR'

export class WordpressFetchError extends Error {
  readonly code:        WordpressErrorCode
  readonly httpStatus?: number
  readonly evidence?:   string

  constructor(
    message:     string,
    code:        WordpressErrorCode,
    httpStatus?: number,
    evidence?:   string,
  ) {
    super(message)
    this.name       = 'WordpressFetchError'
    this.code       = code
    this.httpStatus = httpStatus
    this.evidence   = evidence
  }
}

// ─── WAF fingerprinting (pure function — easy to unit-test) ───────────────────

export type WafKind = 'siteground' | 'cloudflare' | 'wordfence' | 'sucuri' | 'generic'

export interface WafFingerprint {
  kind:     WafKind
  evidence: string
}

interface WafDetector {
  kind:  WafKind
  match: (res: Response, body: string) => string | null
}

const WAF_DETECTORS: WafDetector[] = [
  {
    kind: 'siteground',
    match: (res, body) => {
      // res.url is the URL after fetch followed any redirects.
      const finalUrl = res.url || ''
      if (/\/sgcaptcha\b|\/sg-block\b|\/sgs-block\b|\bsg_security_block\b/i.test(finalUrl)) {
        return `redirect to ${finalUrl}`
      }
      if (/<title>\s*SiteGround|sg-security/i.test(body)) {
        return 'body contains SiteGround marker'
      }
      return null
    },
  },
  {
    kind: 'cloudflare',
    match: (res, body) => {
      const cfHeader = res.headers.get('cf-mitigated') ?? res.headers.get('cf-ray')
      if (cfHeader && (res.status === 403 || res.status === 503 || res.status === 429)) {
        return `cf-* header present + status ${res.status}`
      }
      if (/<title>\s*Just a moment\.\.\.<\/title>/i.test(body)) return 'Cloudflare "Just a moment..." challenge page'
      if (/cf-challenge|__cf_chl_jschl|jschl-answer/i.test(body)) return 'Cloudflare challenge token in body'
      return null
    },
  },
  {
    kind: 'wordfence',
    match: (res, body) => {
      if (/Generated by Wordfence|<title>\s*Wordfence/i.test(body)) {
        return 'body contains Wordfence marker'
      }
      const setCookie = res.headers.get('set-cookie')?.toLowerCase() ?? ''
      if (setCookie.includes('wfwaf-authcookie')) return 'wfwaf-authcookie cookie present'
      return null
    },
  },
  {
    kind: 'sucuri',
    match: (res, body) => {
      if (res.headers.get('x-sucuri-id') || res.headers.get('x-sucuri-cache')) {
        return 'x-sucuri-* header present'
      }
      if (/sucuri_cloudproxy|Sucuri WebSite Firewall/i.test(body)) {
        return 'body contains Sucuri marker'
      }
      return null
    },
  },
  {
    kind: 'generic',
    match: (res, body) => {
      // Only fire when status indicates trouble AND body suggests a block page.
      // Avoid matching legitimate 200 JSON responses that happen to mention "forbidden".
      if (res.status >= 400 && /security check|access denied|forbidden by|blocked by/i.test(body)) {
        return `generic block page (status ${res.status})`
      }
      return null
    },
  },
]

export function detectWafFingerprint(
  res:  Response,
  body: string,
): WafFingerprint | null {
  const scan = body.length > WAF_BODY_SCAN_BYTES ? body.slice(0, WAF_BODY_SCAN_BYTES) : body
  for (const detector of WAF_DETECTORS) {
    const evidence = detector.match(res, scan)
    if (evidence) return { kind: detector.kind, evidence }
  }
  return null
}

const WAF_CODE_MAP: Record<WafKind, WordpressErrorCode> = {
  siteground: 'SITEGROUND_ANTIBOT',
  cloudflare: 'CLOUDFLARE_CHALLENGE',
  wordfence:  'WORDFENCE_BLOCK',
  sucuri:     'SUCURI_BLOCK',
  generic:    'GENERIC_WAF',
}

function wafErrorMessage(waf: WafFingerprint, context: string): string {
  switch (waf.kind) {
    case 'siteground':
      return `SiteGround anti-bot challenge during WordPress ${context}. ` +
             `Ask the site owner to whitelist /wp-json/* in SiteGround Security → Defensive Mode → IP Allowlist.`
    case 'cloudflare':
      return `Cloudflare challenge during WordPress ${context}. ` +
             `Ask the site owner to add a WAF skip rule for /wp-json/* or allowlist ME's egress IP.`
    case 'wordfence':
      return `Wordfence block during WordPress ${context}. ` +
             `Ask the site owner to allowlist ME's IP in Wordfence → Tools → Allowlisted URLs.`
    case 'sucuri':
      return `Sucuri firewall block during WordPress ${context}. ` +
             `Ask the site owner to allowlist ME's IP in Sucuri dashboard → Access Control.`
    case 'generic':
      return `Generic WAF / security-plugin block during WordPress ${context}.`
  }
}

// ─── wpFetch (with timeout + retry) ───────────────────────────────────────────

export interface WpFetchOptions {
  /** Override the 10s default timeout. Mainly for tests. */
  timeoutMs?: number
  /** Internal flag — set true on the retry pass so we don't loop. */
  _isRetry?:  boolean
}

async function wpFetch(
  config:  WordpressClientConfig,
  path:    string,
  options: RequestInit  = {},
  opts:    WpFetchOptions = {},
): Promise<Response> {
  await assertPublicHost(config.siteUrl)

  const url        = `${config.siteUrl}/wp-json/wp/v2${path}`
  const timeoutMs  = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...options,
      signal:  controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': buildBasicAuth(config.username, config.appPassword),
        'User-Agent':    ME_USER_AGENT,
        ...(options.headers ?? {}),
      },
    })

    // Retry once on 5xx (Render cold start, transient WP issues).
    // Don't retry 4xx (auth / not found) or captcha responses — they won't change.
    if (!opts._isRetry && res.status >= 500 && res.status < 600) {
      // Drain the body so the underlying socket can be released to the pool
      // before we open the retry connection. Ignore drain errors.
      await res.text().catch(() => undefined)
      clearTimeout(timer)
      await sleep(RETRY_BACKOFF_MS)
      return wpFetch(config, path, options, { ...opts, _isRetry: true })
    }

    return res
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new WordpressFetchError(
        `WordPress request timed out after ${timeoutMs}ms: ${url}`,
        'TIMEOUT',
      )
    }
    // Network-level error → retry once (don't loop).
    if (!opts._isRetry && isLikelyNetworkError(err)) {
      clearTimeout(timer)
      await sleep(RETRY_BACKOFF_MS)
      return wpFetch(config, path, options, { ...opts, _isRetry: true })
    }
    if (err instanceof WordpressFetchError) throw err
    throw new WordpressFetchError(
      `WordPress network error: ${err instanceof Error ? err.message : String(err)}`,
      'NETWORK_ERROR',
    )
  } finally {
    clearTimeout(timer)
    // Do NOT abort the controller here on the happy path — caller still needs
    // to read res.text() / res.json(). Timer cleanup is enough.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isLikelyNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  // Node undici surfaces network errors as "fetch failed" with a .cause; the
  // common low-level codes show up in stringified error chains.
  const msg   = err.message
  const cause = (err as Error & { cause?: unknown }).cause
  const causeMsg = cause instanceof Error ? cause.message : ''
  return /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|fetch failed/i.test(`${msg} ${causeMsg}`)
}

async function expectJson(
  res:     Response,
  context: string,
): Promise<Record<string, unknown>> {
  const text = await res.text()

  // Check WAF fingerprint first — captcha pages can return 200 with HTML body.
  const waf = detectWafFingerprint(res, text)
  if (waf) {
    throw new WordpressFetchError(
      `${wafErrorMessage(waf, context)} (status=${res.status}, evidence: ${waf.evidence})`,
      WAF_CODE_MAP[waf.kind],
      res.status,
      waf.evidence,
    )
  }

  if (!res.ok) {
    let detail = text
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (typeof parsed.message === 'string') detail = parsed.message
    } catch {
      // keep raw text
    }
    // Truncate detail so error logs don't blow up.
    if (detail.length > 500) detail = `${detail.slice(0, 500)}…`
    throw new WordpressFetchError(
      `WordPress ${context} failed (${res.status}): ${detail}`,
      'HTTP_ERROR',
      res.status,
    )
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    const preview = text.slice(0, WAF_BODY_SCAN_BYTES).replace(/\s+/g, ' ').trim().slice(0, 500)
    throw new WordpressFetchError(
      `WordPress ${context}: response is not JSON — the site may be blocking REST API access ` +
      `(security plugin, maintenance mode, or wp-json disabled). Response preview: "${preview}"`,
      'WP_REST_DISABLED',
      res.status,
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

// ═══════════════════════════════════════════════════════════════════════════════
// P12.R.M1 — Page Rewriter: get/update an EXISTING WP post or page
// ═══════════════════════════════════════════════════════════════════════════════
//
// Distinct from the create/publish flow above:
//   - createWordpressPostDraft + publishWordpressPost  → produce a NEW post.
//   - getExistingWordpressPost + updateExistingWordpressPost → mutate an
//     already-published post/page so the FDE can rewrite Yoast title / meta /
//     FAQ schema without opening WP admin.
//
// The two functions are intentionally minimal — audit / idempotency / before-
// snapshot recording live in the API route layer (M2), not here.

export type WordpressPostType = 'post' | 'page'

const YOAST_TITLE_KEY     = '_yoast_wpseo_title'
const YOAST_METADESC_KEY  = '_yoast_wpseo_metadesc'
const YOAST_FOCUSKW_KEY   = '_yoast_wpseo_focuskw'

export interface ExistingWordpressPost {
  /** WP post ID. */
  postId:          number
  postType:        WordpressPostType
  title:           string
  slug:            string
  excerpt:         string
  /** Raw HTML body as stored in WP `content.raw`. May be Elementor JSON markers. */
  content:         string
  /** WP post status: `publish`, `draft`, `pending`, `private`, `future`. */
  status:          string
  /** Live URL. */
  link:            string
  /** Last-modified ISO timestamp from WP. */
  modified:        string
  /** Yoast SEO title from `meta._yoast_wpseo_title`. Undefined when the key is not exposed. */
  seoTitle?:       string
  seoDescription?: string
  focusKeyphrase?: string
}

/**
 * Fetch a single post or page so the FDE can see current Yoast meta / title /
 * excerpt before authoring a rewrite. `context=edit` is required so Yoast
 * meta fields come back populated (`view` context strips meta on most installs).
 */
export async function getExistingWordpressPost(
  config:    WordpressClientConfig,
  postId:    number,
  postType:  WordpressPostType = 'post',
): Promise<ExistingWordpressPost> {
  if (!Number.isInteger(postId) || postId <= 0) {
    throw new WordpressFetchError(
      `getExistingWordpressPost: invalid postId ${postId} — must be a positive integer.`,
      'HTTP_ERROR',
    )
  }
  const path = `/${postType}s/${postId}?context=edit`
  const res  = await wpFetch(config, path)
  const data = await expectJson(res, `getExisting${postType === 'page' ? 'Page' : 'Post'}`)

  // Reuse the shared parser (P12.R.M3) but trust the caller's postId since the
  // direct-by-id endpoint always returns the same row we asked for.
  return { ...parseExistingPost(data, postType), postId }
}

/**
 * WP REST returns `{ rendered, raw }` shapes for title/content/excerpt under
 * `context=edit`. Prefer `raw` (untransformed) so a round-trip rewrite doesn't
 * lose shortcodes or Elementor wrappers; fall back to `rendered` / string.
 */
function extractRenderedOrRaw(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.raw      === 'string') return obj.raw
    if (typeof obj.rendered === 'string') return obj.rendered
  }
  return ''
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export interface UpdateExistingWordpressPostInput {
  postId:        number
  postType?:     WordpressPostType   // default 'post'

  // ── At least ONE of these must be supplied ───────────────────────────────────
  title?:           string
  excerpt?:         string
  content?:         string   // HTML body — caller must sanitize via prepareCmsContent first
  slug?:            string
  /** Yoast SEO title (`<title>` tag). */
  seoTitle?:        string
  /** Yoast meta description. */
  seoDescription?:  string
  /** Yoast focus keyphrase. */
  focusKeyphrase?:  string
}

export interface UpdateExistingWordpressPostResult {
  postId:        number
  postType:      WordpressPostType
  link:          string
  modified:      string
  /** Echo of which input keys were actually sent on the wire — useful for audit. */
  updatedFields: string[]
}

/**
 * PATCH an existing WP post / page.
 *
 * WP REST treats POST `/posts/{id}` as a partial update: only the fields you
 * send are mutated. We forward only the keys the caller specified, so an
 * absent `content` field will NOT clear the body.
 *
 * Yoast meta keys are sent under the `meta` object. They must be registered
 * as `show_in_rest` — verify with probeYoastMetaWritable() before relying on
 * the seoTitle / seoDescription / focusKeyphrase inputs.
 *
 * Does NOT change the post status (publish/draft/private stays as-is). Callers
 * that need a status change must use the existing publish/delete helpers.
 */
export async function updateExistingWordpressPost(
  config: WordpressClientConfig,
  input:  UpdateExistingWordpressPostInput,
): Promise<UpdateExistingWordpressPostResult> {
  if (!Number.isInteger(input.postId) || input.postId <= 0) {
    throw new WordpressFetchError(
      `updateExistingWordpressPost: invalid postId ${input.postId} — must be a positive integer.`,
      'HTTP_ERROR',
    )
  }
  const postType: WordpressPostType = input.postType ?? 'post'

  const body: Record<string, unknown> = {}
  const updatedFields: string[]       = []

  if (input.title    !== undefined) { body.title   = input.title;   updatedFields.push('title') }
  if (input.excerpt  !== undefined) { body.excerpt = input.excerpt; updatedFields.push('excerpt') }
  if (input.content  !== undefined) { body.content = input.content; updatedFields.push('content') }
  if (input.slug     !== undefined) { body.slug    = input.slug;    updatedFields.push('slug') }

  const meta: Record<string, string> = {}
  if (input.seoTitle       !== undefined) { meta[YOAST_TITLE_KEY]    = input.seoTitle;       updatedFields.push('seoTitle') }
  if (input.seoDescription !== undefined) { meta[YOAST_METADESC_KEY] = input.seoDescription; updatedFields.push('seoDescription') }
  if (input.focusKeyphrase !== undefined) { meta[YOAST_FOCUSKW_KEY]  = input.focusKeyphrase; updatedFields.push('focusKeyphrase') }
  if (Object.keys(meta).length > 0) body.meta = meta

  if (updatedFields.length === 0) {
    throw new WordpressFetchError(
      'updateExistingWordpressPost: no updatable fields supplied — at least one of ' +
      '{title, excerpt, content, slug, seoTitle, seoDescription, focusKeyphrase} is required.',
      'HTTP_ERROR',
    )
  }

  const path = `/${postType}s/${input.postId}`
  const res  = await wpFetch(config, path, {
    method: 'POST',
    body:   JSON.stringify(body),
  })
  const data = await expectJson(res, `update${postType === 'page' ? 'Page' : 'Post'}`)

  return {
    postId:        input.postId,
    postType,
    link:          typeof data.link     === 'string' ? data.link     : '',
    modified:      typeof data.modified === 'string' ? data.modified : '',
    updatedFields,
  }
}

// ─── findWordpressPostByUrl (P12.R.M3 — Page Rewriter UI lookup) ──────────────

/**
 * Extract a likely slug from a WordPress permalink URL.
 *
 * Strips query/fragment, drops the trailing slash, and returns the last
 * non-empty path segment. Handles both flat permalinks
 * (`/tile-sizes-explained/`) and prefixed permalinks
 * (`/blog/tile-sizes-explained/`, `/2026/06/tile-sizes-explained/`).
 *
 * Returns null if the URL cannot be parsed or has no path segment.
 *
 * Exported for unit testing — keep this pure (no I/O).
 */
export function extractSlugFromWpUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const segments = parsed.pathname.split('/').filter(s => s.length > 0)
  if (segments.length === 0) return null
  const last = segments[segments.length - 1]
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

interface FindByUrlResultMeta {
  searchedAs:    'post' | 'page' | 'both'
  postsTried:    number   // how many post results came back (for diagnostics)
  pagesTried:    number
}

export interface FindWordpressPostByUrlOutcome {
  post: ExistingWordpressPost | null
  meta: FindByUrlResultMeta
}

/**
 * Find an existing WP post or page that matches a given permalink URL.
 *
 * Strategy:
 *   1. Extract the slug from the URL.
 *   2. Query `/posts?slug=<slug>&context=edit&per_page=2`.
 *   3. If no post matches, query `/pages?slug=<slug>&context=edit&per_page=2`.
 *   4. Return the first match shaped as ExistingWordpressPost, or null.
 *
 * We only ever return ONE match — if more than one row shares a slug (rare;
 * usually from a republish-with-old-slug history) the caller must disambiguate
 * by direct postId. The `meta.postsTried` / `pagesTried` counts surface that
 * fact to the UI so FDE can be warned.
 *
 * The same-host check is enforced upstream by validateWordpressSiteUrl on
 * `config.siteUrl`; this function does not re-validate the input URL host
 * (the caller decides whether to require host match).
 */
export async function findWordpressPostByUrl(
  config: WordpressClientConfig,
  url:    string,
): Promise<FindWordpressPostByUrlOutcome> {
  const slug = extractSlugFromWpUrl(url)
  if (!slug) {
    return { post: null, meta: { searchedAs: 'both', postsTried: 0, pagesTried: 0 } }
  }
  const slugParam = encodeURIComponent(slug)

  // 1. Posts first (most common case).
  const postsRes  = await wpFetch(config, `/posts?slug=${slugParam}&context=edit&per_page=2`)
  const postsData = await expectJson(postsRes, 'findPostBySlug') as unknown as Array<Record<string, unknown>>
  const postsArr  = Array.isArray(postsData) ? postsData : []

  if (postsArr.length > 0) {
    return {
      post: parseExistingPost(postsArr[0], 'post'),
      meta: { searchedAs: 'post', postsTried: postsArr.length, pagesTried: 0 },
    }
  }

  // 2. Pages fallback.
  const pagesRes  = await wpFetch(config, `/pages?slug=${slugParam}&context=edit&per_page=2`)
  const pagesData = await expectJson(pagesRes, 'findPageBySlug') as unknown as Array<Record<string, unknown>>
  const pagesArr  = Array.isArray(pagesData) ? pagesData : []

  if (pagesArr.length > 0) {
    return {
      post: parseExistingPost(pagesArr[0], 'page'),
      meta: { searchedAs: 'both', postsTried: 0, pagesTried: pagesArr.length },
    }
  }

  return { post: null, meta: { searchedAs: 'both', postsTried: 0, pagesTried: 0 } }
}

/**
 * Shared parser — converts a raw WP REST post/page row into ExistingWordpressPost.
 * Kept private (not exported) so its shape can evolve without breaking callers.
 */
function parseExistingPost(raw: Record<string, unknown>, postType: WordpressPostType): ExistingWordpressPost {
  const meta = (raw.meta ?? {}) as Record<string, unknown>
  const id   = typeof raw.id === 'number' ? raw.id : Number(raw.id)
  return {
    postId:   Number.isInteger(id) && id > 0 ? id : 0,
    postType,
    title:    extractRenderedOrRaw(raw.title),
    slug:     typeof raw.slug === 'string' ? raw.slug : '',
    excerpt:  extractRenderedOrRaw(raw.excerpt),
    content:  extractRenderedOrRaw(raw.content),
    status:   typeof raw.status   === 'string' ? raw.status   : 'publish',
    link:     typeof raw.link     === 'string' ? raw.link     : '',
    modified: typeof raw.modified === 'string' ? raw.modified : '',
    seoTitle:       optionalString(meta[YOAST_TITLE_KEY]),
    seoDescription: optionalString(meta[YOAST_METADESC_KEY]),
    focusKeyphrase: optionalString(meta[YOAST_FOCUSKW_KEY]),
  }
}
