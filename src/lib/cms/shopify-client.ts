/**
 * shopify-client — Shopify Admin REST API integration for Magic Engine.
 *
 * Scope required on the Private App / Custom App token:
 *   write_content  (= write_blogs + write_pages)
 *
 * All article / page creates are draft-first (published: false).
 * The caller must make a second call to publishArticle / publishPage
 * after FDE confirms the preview.
 *
 * Phase 14.A.4 — P14.A.5 (WordPress) ships separately in the same PR cycle.
 */

import { shopifyAdminBase } from './shopify-guard'
import { assertPublicHost } from './ssrf-guard'

const API_VERSION = '2024-01'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShopifyClientConfig {
  /** Normalized shop URL, e.g. https://my-store.myshopify.com */
  shopUrl:     string
  /** Shopify Admin API access token (Private App or Custom App). */
  accessToken: string
}

export interface ShopifyBlog {
  id:    number
  title: string
  handle: string
}

export interface ShopifyArticleDraft {
  /** Shopify article ID (number). */
  platformId:  string
  previewUrl:  string
}

export interface ShopifyPageDraft {
  /** Shopify page ID (number). */
  platformId:  string
  previewUrl:  string
}

export interface ShopifyTestResult {
  ok:         boolean
  shopName?:  string
  error?:     string
}

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function shopifyFetch(
  config:  ShopifyClientConfig,
  path:    string,
  options: RequestInit = {},
): Promise<Response> {
  await assertPublicHost(config.shopUrl)

  const base = shopifyAdminBase(config.shopUrl, API_VERSION)
  const url  = `${base}${path}`

  return fetch(url, {
    ...options,
    headers: {
      'Content-Type':            'application/json',
      'X-Shopify-Access-Token':  config.accessToken,
      ...(options.headers ?? {}),
    },
  })
}

async function expectJson(res: Response, context: string): Promise<Record<string, unknown>> {
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (parsed.errors) {
        detail = typeof parsed.errors === 'string'
          ? parsed.errors
          : JSON.stringify(parsed.errors)
      }
    } catch {
      // keep raw text
    }
    throw new Error(`Shopify ${context} failed (${res.status}): ${detail}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Shopify ${context}: invalid JSON response`)
  }
}

// ─── testConnection ───────────────────────────────────────────────────────────

/**
 * Verify credentials by fetching /shop.json.
 * Returns the shop name on success.
 */
export async function testShopifyConnection(
  config: ShopifyClientConfig,
): Promise<ShopifyTestResult> {
  try {
    const res  = await shopifyFetch(config, '/shop.json')
    const body = await expectJson(res, 'testConnection')
    const shop = body.shop as Record<string, unknown> | undefined
    return {
      ok:       true,
      shopName: typeof shop?.name === 'string' ? shop.name : undefined,
    }
  } catch (err) {
    return {
      ok:    false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ─── getBlogs ─────────────────────────────────────────────────────────────────

/**
 * List all blogs in the store.
 * Returns an empty array on a store with no blogs.
 */
export async function listShopifyBlogs(
  config: ShopifyClientConfig,
): Promise<ShopifyBlog[]> {
  const res  = await shopifyFetch(config, '/blogs.json?fields=id,title,handle')
  const body = await expectJson(res, 'listBlogs')
  const raw  = body.blogs
  if (!Array.isArray(raw)) return []
  return (raw as Array<Record<string, unknown>>).map(b => ({
    id:     Number(b.id),
    title:  String(b.title ?? ''),
    handle: String(b.handle ?? ''),
  }))
}

/**
 * Get the first blog in the store, or create one named "News" if none exist.
 * Returns the blog ID to use for article creation.
 */
export async function getOrCreateDefaultBlog(
  config: ShopifyClientConfig,
): Promise<number> {
  const blogs = await listShopifyBlogs(config)
  if (blogs.length > 0) return blogs[0].id

  const res  = await shopifyFetch(config, '/blogs.json', {
    method: 'POST',
    body:   JSON.stringify({ blog: { title: 'News' } }),
  })
  const body = await expectJson(res, 'createBlog')
  const blog = body.blog as Record<string, unknown>
  return Number(blog.id)
}

// ─── createArticleDraft ───────────────────────────────────────────────────────

export interface CreateArticlePayload {
  /** Blog ID to publish the article under. If omitted, uses the first blog. */
  blogId?:       number
  title:         string
  /** HTML body of the article. Must be sanitized before calling this. */
  bodyHtml:      string
  /** SEO meta description. */
  summary?:      string
  /** Article tags, comma-separated or as an array. */
  tags?:         string | string[]
  /** Shopify author name (defaults to "Magic Engine"). */
  author?:       string
  /** Published flag — always false here (draft-first). */
}

/**
 * Create a blog article draft (published: false) on Shopify.
 * Returns the platform article ID and a preview URL.
 */
export async function createShopifyArticleDraft(
  config:  ShopifyClientConfig,
  payload: CreateArticlePayload,
): Promise<ShopifyArticleDraft> {
  const blogId = payload.blogId ?? (await getOrCreateDefaultBlog(config))

  const tags = Array.isArray(payload.tags)
    ? payload.tags.join(', ')
    : (payload.tags ?? '')

  const body = {
    article: {
      title:     payload.title,
      body_html: payload.bodyHtml,
      summary:   payload.summary ?? '',
      tags,
      author:    payload.author ?? 'Magic Engine',
      published: false,
    },
  }

  const res   = await shopifyFetch(config, `/blogs/${blogId}/articles.json`, {
    method: 'POST',
    body:   JSON.stringify(body),
  })
  const data  = await expectJson(res, 'createArticleDraft')
  const art   = data.article as Record<string, unknown>
  const artId = String(art.id)

  // Preview URL points to the unpublished article admin page (FDE can preview there).
  const shopHost   = new URL(config.shopUrl).hostname
  const previewUrl = `https://${shopHost}/admin/articles/${artId}`

  return { platformId: artId, previewUrl }
}

// ─── publishArticle ───────────────────────────────────────────────────────────

/**
 * Flip a draft article to published status.
 * Also sets published_at to now so it sorts correctly in the blog.
 */
export async function publishShopifyArticle(
  config:    ShopifyClientConfig,
  blogId:    number,
  articleId: string,
): Promise<void> {
  const res = await shopifyFetch(config, `/blogs/${blogId}/articles/${articleId}.json`, {
    method: 'PUT',
    body:   JSON.stringify({
      article: {
        id:           Number(articleId),
        published:    true,
        published_at: new Date().toISOString(),
      },
    }),
  })
  await expectJson(res, 'publishArticle')
}

// ─── createPageDraft ─────────────────────────────────────────────────────────

export interface CreatePagePayload {
  title:     string
  /** HTML body of the page. Must be sanitized before calling this. */
  bodyHtml:  string
  /** Shopify page handle (slug). Auto-generated from title if omitted. */
  handle?:   string
  /** SEO meta description. */
  metaDescription?: string
}

/**
 * Create a Shopify page draft (published: false).
 * Returns the platform page ID and an admin preview URL.
 */
export async function createShopifyPageDraft(
  config:  ShopifyClientConfig,
  payload: CreatePagePayload,
): Promise<ShopifyPageDraft> {
  const body: Record<string, unknown> = {
    page: {
      title:     payload.title,
      body_html: payload.bodyHtml,
      published: false,
      ...(payload.handle   ? { handle: payload.handle } : {}),
    },
  }
  if (payload.metaDescription) {
    ;(body.page as Record<string, unknown>).metafields = [
      {
        namespace: 'global',
        key:       'description_tag',
        value:     payload.metaDescription,
        type:      'single_line_text_field',
      },
    ]
  }

  const res    = await shopifyFetch(config, '/pages.json', {
    method: 'POST',
    body:   JSON.stringify(body),
  })
  const data   = await expectJson(res, 'createPageDraft')
  const page   = data.page as Record<string, unknown>
  const pageId = String(page.id)

  const shopHost   = new URL(config.shopUrl).hostname
  const previewUrl = `https://${shopHost}/admin/pages/${pageId}`

  return { platformId: pageId, previewUrl }
}

// ─── publishPage ─────────────────────────────────────────────────────────────

/**
 * Flip a draft page to published status.
 */
export async function publishShopifyPage(
  config:  ShopifyClientConfig,
  pageId:  string,
): Promise<void> {
  const res = await shopifyFetch(config, `/pages/${pageId}.json`, {
    method: 'PUT',
    body:   JSON.stringify({
      page: {
        id:        Number(pageId),
        published: true,
      },
    }),
  })
  await expectJson(res, 'publishPage')
}
