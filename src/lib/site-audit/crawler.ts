/**
 * Site Auditor Crawler
 *
 * Two public functions:
 *   discoverSitemapUrls(domain) — four-level fallback URL discovery
 *   crawlPages(urls, opts)       — rate-limited, fault-tolerant page fetcher
 *
 * Reference: ROADMAP.md P8.0.2 DNZ collection infrastructure
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrawlOptions {
  /** Maximum pages to crawl. Default: 100 */
  limit?: number
  /** Per-page fetch timeout in ms. Default: 10 000 */
  timeout?: number
  /** Minimum delay between requests in ms. Default: 1 000 */
  rateLimitMs?: number
}

export interface CrawlResult {
  url: string
  markdown: string
  title: string
  statusCode: number
  error?: string
  crawledAt: Date
  /**
   * Set when Jina returned an anti-bot challenge page (SiteGround / Cloudflare
   * / Wordfence / Sucuri / generic). The crawler still records the URL but
   * downstream code MUST skip writing markdown/title back to `client_site_pages`
   * (otherwise the "Robot Challenge Screen" stubs overwrite real page data).
   *
   * 2026-06-20 Oztop incident: 30+ product-category pages stored as
   * `title="Robot Challenge Screen"` because we trusted Jina's output without
   * fingerprinting. See antibot-detector.ts for the detection rules.
   */
  antibot?: { kind: string; evidence: string }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_LIMIT = 100
export const DEFAULT_TIMEOUT = 10_000
export const DEFAULT_RATE_LIMIT_MS = 1_000
export const MAX_BFS_LINKS = 50

// ---------------------------------------------------------------------------
// Internal helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Normalise a domain or full URL to https://hostname (no trailing slash).
 */
export function normaliseDomain(input: string): string {
  const withScheme = input.startsWith('http') ? input : `https://${input}`
  const { protocol, hostname } = new URL(withScheme)
  return `${protocol}//${hostname}`
}

/**
 * Parse <loc> text nodes from a sitemap XML string.
 */
export function parseLocsFromXml(xml: string): string[] {
  const locs: string[] = []
  const re = /<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1].trim())
  }
  return locs
}

/**
 * Parse "Sitemap: <url>" directives from a robots.txt string.
 */
export function parseSitemapDirectives(robotsTxt: string): string[] {
  const urls: string[] = []
  const re = /^Sitemap:\s*(\S+)/gim
  let m: RegExpExecArray | null
  while ((m = re.exec(robotsTxt)) !== null) {
    urls.push(m[1].trim())
  }
  return urls
}

/**
 * Returns true if robots.txt blocks all crawlers from root (/).
 */
export function isFullyCrawlBlocked(robotsTxt: string): boolean {
  // Look for User-agent: * block containing Disallow: /
  const blocks = robotsTxt.split(/(?=User-agent:)/i)
  for (const block of blocks) {
    if (/User-agent:\s*\*/i.test(block) && /Disallow:\s*\/\s*$/m.test(block)) {
      return true
    }
  }
  return false
}

/**
 * Extract same-origin href values from raw HTML.
 * Returns de-duped absolute URLs limited to `max` entries.
 */
export function extractSameDomainLinks(
  html: string,
  origin: string,
  max: number = MAX_BFS_LINKS
): string[] {
  const seen = new Set<string>()
  const re = /href=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && seen.size < max) {
    const raw = m[1].trim()
    try {
      const abs = new URL(raw, origin).href
      // Treat www.domain.com and domain.com as the same origin
      const normAbs = abs.replace(/^(https?:\/\/)www\./, '$1')
      const normOrigin = origin.replace(/^(https?:\/\/)www\./, '$1')
      if (normAbs.startsWith(normOrigin) && !seen.has(abs)) {
        seen.add(abs)
      }
    } catch {
      // ignore malformed hrefs
    }
  }
  return Array.from(seen)
}

/**
 * Extract absolute same-origin URLs from Jina Reader markdown output.
 * Matches both markdown links [text](url) and bare https:// URLs.
 */
export function extractMarkdownLinks(
  markdown: string,
  origin: string,
  max: number = MAX_BFS_LINKS
): string[] {
  const seen = new Set<string>()
  const normOrigin = origin.replace(/^(https?:\/\/)www\./, '$1')

  // Match markdown links: [text](https://...)
  const mdRe = /\]\((https?:\/\/[^\s)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = mdRe.exec(markdown)) !== null && seen.size < max) {
    try {
      const abs = new URL(m[1]).href
      const normAbs = abs.replace(/^(https?:\/\/)www\./, '$1')
      if (normAbs.startsWith(normOrigin)) seen.add(abs)
    } catch { /* skip */ }
  }

  // Match bare URLs: https://domain/path
  const bareRe = /https?:\/\/[^\s)"'<>]+/g
  while ((m = bareRe.exec(markdown)) !== null && seen.size < max) {
    try {
      const abs = new URL(m[0]).href
      const normAbs = abs.replace(/^(https?:\/\/)www\./, '$1')
      if (normAbs.startsWith(normOrigin)) seen.add(abs)
    } catch { /* skip */ }
  }

  return Array.from(seen)
}

/**
 * Extract a page title from markdown content.
 * Priority: first H1 → <title> tag → fallback to url hostname.
 */
export function extractTitle(markdown: string, url: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()

  const titleTag = markdown.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleTag) return titleTag[1].trim()

  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * Utility sleep used for rate limiting.
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all crawlable URLs for a domain using a five-level fallback:
 *   0. robots.txt check + sitemap directives
 *   1. /sitemap.xml (direct fetch)
 *   2. /sitemap_index.xml (direct fetch)
 *   4. BFS homepage link extraction (direct fetch, max 50 links)
 *   5a. Jina Reader fetch of /sitemap.xml — bypasses WAF/bot-blocking
 *   5b. Jina Reader fetch of homepage — extracts links from markdown
 *
 * Returns unique, same-domain URLs only.
 * Returns [] if robots.txt fully blocks crawling (and logs a warning).
 */
export async function discoverSitemapUrls(domain: string): Promise<string[]> {
  const origin = normaliseDomain(domain)

  // Check robots.txt first for crawl permission
  try {
    const robotsRes = await fetch(`${origin}/robots.txt`)
    if (robotsRes.ok) {
      const robotsTxt = await robotsRes.text()
      if (isFullyCrawlBlocked(robotsTxt)) {
        console.warn(`[crawler] ${origin}/robots.txt disallows all crawling. Returning empty URL list.`)
        return []
      }
      // Try sitemap directives from robots.txt
      const directives = parseSitemapDirectives(robotsTxt)
      if (directives.length > 0) {
        const urls = await resolveSitemapUrls(directives, origin)
        if (urls.length > 0) {
          return dedupeAndFilter(urls, origin)
        }
      }
    }
  } catch {
    // robots.txt unreachable — continue with other strategies
  }

  // Level 1: /sitemap.xml
  try {
    const res = await fetch(`${origin}/sitemap.xml`)
    if (res.ok) {
      const xml = await res.text()
      const locs = parseLocsFromXml(xml)
      if (locs.length > 0) {
        return dedupeAndFilter(locs, origin)
      }
    }
  } catch {
    // fall through
  }

  // Level 2: /sitemap_index.xml
  try {
    const res = await fetch(`${origin}/sitemap_index.xml`)
    if (res.ok) {
      const xml = await res.text()
      // sitemap_index contains <loc> entries pointing to child sitemaps
      const childSitemapUrls = parseLocsFromXml(xml)
      const allLocs: string[] = []
      for (const childUrl of childSitemapUrls) {
        try {
          const childRes = await fetch(childUrl)
          if (childRes.ok) {
            const childXml = await childRes.text()
            allLocs.push(...parseLocsFromXml(childXml))
          }
        } catch {
          // skip unreachable child sitemap
        }
      }
      if (allLocs.length > 0) {
        return dedupeAndFilter(allLocs, origin)
      }
    }
  } catch {
    // fall through
  }

  // Level 4: BFS homepage link extraction
  try {
    const res = await fetch(origin)
    if (res.ok) {
      const html = await res.text()
      const links = extractSameDomainLinks(html, origin, MAX_BFS_LINKS)
      if (links.length > 0) return links
    }
  } catch {
    // fall through to Level 5
  }

  // Level 5a: Jina Reader — fetch sitemap.xml bypassing WAF
  // Jina proxies the request; the raw XML is preserved in the markdown response.
  try {
    const { fetchUrlAsMarkdown } = await import('../brief/jina')
    const jinaXml = await fetchUrlAsMarkdown(`${origin}/sitemap.xml`)
    if (jinaXml.markdown) {
      const locs = parseLocsFromXml(jinaXml.markdown)
      if (locs.length > 0) {
        console.info(`[crawler] Level 5a Jina sitemap found ${locs.length} URLs for ${origin}`)
        return dedupeAndFilter(locs, origin)
      }
    }
  } catch {
    // fall through to Level 5b
  }

  // Level 5b: Jina Reader — fetch homepage and extract same-origin links from markdown
  try {
    const { fetchUrlAsMarkdown } = await import('../brief/jina')
    const jinaResult = await fetchUrlAsMarkdown(origin)
    if (jinaResult.markdown) {
      const links = extractMarkdownLinks(jinaResult.markdown, origin, MAX_BFS_LINKS)
      if (links.length > 0) {
        console.info(`[crawler] Level 5b Jina homepage found ${links.length} URLs for ${origin}`)
        return links
      }
    }
  } catch {
    // nothing more to try
  }

  return []
}

/**
 * Crawl a list of URLs using Jina Reader, with rate limiting and fault tolerance.
 * Uses Promise.allSettled so individual failures don't block the batch.
 */
export async function crawlPages(
  urls: string[],
  opts?: CrawlOptions
): Promise<CrawlResult[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT
  const rateLimitMs = opts?.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS

  const targets = urls.slice(0, limit)
  const results: CrawlResult[] = []

  for (let i = 0; i < targets.length; i++) {
    const url = targets[i]
    const crawledAt = new Date()

    try {
      const { fetchUrlAsMarkdown } = await import('../brief/jina')
      const { detectAntibotChallenge } = await import('./antibot-detector')
      const jinaResult = await withTimeout(fetchUrlAsMarkdown(url), timeout)
      const title = jinaResult.title || extractTitle(jinaResult.markdown, url)

      // 2026-06-20 Oztop incident — Jina passes anti-bot challenge pages
      // through verbatim, polluting client_site_pages with stub rows. Flag
      // them here so the job-executor can route them to crawl_status
      // 'antibot_challenged' instead of overwriting real page data.
      const antibot = detectAntibotChallenge(jinaResult.markdown, title)
      results.push({
        url,
        markdown: antibot ? '' : jinaResult.markdown,
        title:    antibot ? '' : title,
        statusCode: 200,
        crawledAt,
        ...(antibot ? { antibot, error: `antibot_${antibot.kind}: ${antibot.evidence}` } : {}),
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      results.push({
        url,
        markdown: '',
        title: '',
        statusCode: 0,
        error,
        crawledAt,
      })
    }

    // Rate limiting: skip delay after the last request
    if (i < targets.length - 1) {
      await delay(rateLimitMs)
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a list of sitemap URLs (possibly sitemap indexes) into page URLs.
 * Handles arbitrarily nested sitemap indexes up to MAX_SITEMAP_DEPTH levels.
 */
async function resolveSitemapUrls(sitemapUrls: string[], origin: string): Promise<string[]> {
  const all: string[] = []
  for (const url of sitemapUrls) {
    all.push(...(await fetchSitemapPageUrls(url, 0)))
  }
  return all
}

const MAX_SITEMAP_DEPTH = 3

/**
 * Recursively fetch page URLs from a sitemap or sitemap index.
 * If the fetched XML is a <sitemapindex>, recurses into each child.
 * Depth-limited to MAX_SITEMAP_DEPTH to guard against malformed cycles.
 */
async function fetchSitemapPageUrls(url: string, depth: number): Promise<string[]> {
  if (depth >= MAX_SITEMAP_DEPTH) return []
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const xml = await res.text()
    if (/<sitemapindex/i.test(xml)) {
      const childUrls = parseLocsFromXml(xml)
      const nested: string[] = []
      for (const childUrl of childUrls) {
        nested.push(...(await fetchSitemapPageUrls(childUrl, depth + 1)))
      }
      return nested
    }
    return parseLocsFromXml(xml)
  } catch {
    return []
  }
}

/**
 * Normalise a URL's origin for comparison, stripping the www. prefix.
 * e.g. https://www.example.com → https://example.com
 */
function normaliseOriginForCompare(url: string): string {
  return url.replace(/^(https?:\/\/)www\./, '$1')
}

/**
 * Remove duplicates and filter to same-origin URLs only.
 * Treats www.domain.com and domain.com as the same origin.
 */
function dedupeAndFilter(urls: string[], origin: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  // Normalise origin for comparison (strip www.)
  const normOrigin = normaliseOriginForCompare(origin)
  for (const u of urls) {
    const normU = normaliseOriginForCompare(u)
    if (!seen.has(u) && normU.startsWith(normOrigin)) {
      seen.add(u)
      result.push(u)
    }
  }
  return result
}

/**
 * Wrap a promise with a timeout rejection.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ])
}
