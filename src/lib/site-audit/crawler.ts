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

/**
 * 发现过程中被**吞掉**的一次失败（Issue #930）。
 *
 * 🔴 discoverSitemapUrls 的每一级回退都会把失败 catch 掉继续往下走 —— 这对「尽量多找点」
 *    是对的，但它让调用方无法区分「这个站就这么多页」和「有一棵 sitemap 子树没取到」。
 *    台账要的是后者能被看见：部分结果被当成完整结果，会产出一份静默缺页的清单。
 *    所以这里**只增加一个可选的观察口**，不改任何既有行为：不传 onIssue 就跟以前一模一样。
 */
export interface DiscoveryIssue {
  readonly stage: string
  readonly url?: string
  readonly error: string
}

export interface DiscoverOptions {
  /** 每吞掉一次失败就回调一次。不传 = 完全维持既有行为。 */
  readonly onIssue?: (issue: DiscoveryIssue) => void
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
/**
 * Direct-fetch discovery yielding fewer URLs than this is treated as suspicious
 * (WAF challenge pages often contain exactly one same-domain link) and we
 * escalate to Jina-proxied discovery instead of returning early.
 * 2026-08-01 Oztop incident: SiteGround blocks Render IPs; the challenge page
 * yielded 1 URL and the crawler never reached the Jina levels.
 */
export const MIN_DISCOVERED_URLS = 2
/** Spacing between Jina child-sitemap fetches (anonymous tier ≈ 20 RPM). */
export const JINA_SITEMAP_DELAY_MS = 3_500

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
 *   5a. Jina Reader raw fetch of /sitemap.xml + /sitemap_index.xml — bypasses
 *       WAF/bot-blocking (Jina's IPs, not Render's) and recurses into child
 *       sitemaps
 *   5b. Jina Reader fetch of homepage — extracts links from markdown
 *
 * Direct levels (0-4) yielding fewer than MIN_DISCOVERED_URLS results are
 * treated as suspicious (likely a WAF challenge page) and discovery escalates
 * to the Jina levels instead of returning early. The best direct result is
 * kept as a fallback if Jina finds nothing better.
 *
 * Returns unique, same-domain URLs only.
 * Returns [] if robots.txt fully blocks crawling (and logs a warning).
 */
export async function discoverSitemapUrls(domain: string, opts?: DiscoverOptions): Promise<string[]> {
  const origin = normaliseDomain(domain)
  const report = (stage: string, error: unknown, url?: string): void =>
    opts?.onIssue?.({ stage, url, error: error instanceof Error ? error.message : String(error) })
  let best: string[] = []
  const keepOrEscalate = (urls: string[]): string[] | null => {
    if (urls.length >= MIN_DISCOVERED_URLS) return urls
    if (urls.length > best.length) best = urls
    return null
  }

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
        const urls = keepOrEscalate(dedupeAndFilter(await resolveSitemapUrls(directives, origin, report), origin))
        if (urls) return urls
      }
    }
  } catch (err) {
    report('robots.txt', err, `${origin}/robots.txt`)
  }

  // Level 1: /sitemap.xml
  try {
    const res = await fetch(`${origin}/sitemap.xml`)
    if (res.ok) {
      const xml = await res.text()
      const urls = keepOrEscalate(dedupeAndFilter(parseLocsFromXml(xml), origin))
      if (urls) return urls
    }
  } catch (err) {
    report('sitemap.xml', err, `${origin}/sitemap.xml`)
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
          } else {
            // 🔴 404/503 不会抛 —— fetch 正常完成，只是 ok 为 false。
            //    只在 catch 里上报，等于漏掉了子树失败最常见的那一种。
            report('child-sitemap', `HTTP ${childRes.status}`, childUrl)
          }
        } catch (err) {
          report('child-sitemap', err, childUrl)
        }
      }
      const urls = keepOrEscalate(dedupeAndFilter(allLocs, origin))
      if (urls) return urls
    }
  } catch (err) {
    report('sitemap_index.xml', err, `${origin}/sitemap_index.xml`)
  }

  // Level 4: BFS homepage link extraction
  try {
    const res = await fetch(origin)
    if (res.ok) {
      const html = await res.text()
      const links = extractSameDomainLinks(html, origin, MAX_BFS_LINKS)
      // 🔴 BFS 截到上限就返回，截断跟「这个站就这么多页」长得一样。
      //    不上报的话，台账会拿到 count: 50 / error: null，其余页面静默缺席。
      if (links.length >= MAX_BFS_LINKS) {
        report('homepage-bfs-truncated', `hit MAX_BFS_LINKS=${MAX_BFS_LINKS}`, origin)
      }
      const urls = keepOrEscalate(links)
      if (urls) {
        // 🔴 真正的危险信号不是「sitemap 404」（那是正常回退），而是**最后靠首页链接凑出来的结果**：
        //    首页 BFS 本来就枚举不全一个站，它给出的「正数 + 无错误」跟「这个站就这么多页」
        //    长得一模一样。台账必须知道这一份是尽力而为的结果，交给人认。
        report('homepage-bfs-only', 'discovery fell back to homepage links (not a sitemap)', origin)
        return urls
      }
    }
  } catch (err) {
    report('homepage-bfs', err, origin)
  }

  // Level 5a: Jina Reader — fetch sitemap(s) bypassing WAF. Jina's render
  // pipeline passes challenge redirects (SiteGround sgcaptcha) that direct
  // fetch is stuck on; sitemap URLs are recovered from the rendered output
  // by fetchSitemapPagesViaJina (<loc> tags or bare/markdown links). The old
  // implementation only looked for <loc> in markdown output — dead code.
  for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const locs = await fetchSitemapPagesViaJina(`${origin}${path}`, 0, JINA_SITEMAP_DELAY_MS, new Set(), report)
      const urls = dedupeAndFilter(locs, origin)
      if (urls.length > 0) {
        console.info(`[crawler] Level 5a Jina sitemap (${path}) found ${urls.length} URLs for ${origin}`)
        if (urls.length >= MIN_DISCOVERED_URLS) return urls
        if (urls.length > best.length) best = urls
      }
    } catch (err) {
      report('jina-sitemap', err, `${origin}${path}`)
    }
  }

  // Level 5b: Jina Reader — fetch homepage and extract same-origin links from markdown
  try {
    const { fetchUrlAsMarkdown } = await import('../brief/jina')
    const jinaResult = await fetchUrlAsMarkdown(origin)
    if (jinaResult.markdown) {
      const links = extractMarkdownLinks(jinaResult.markdown, origin, MAX_BFS_LINKS)
      if (links.length >= MAX_BFS_LINKS) {
        report('jina-homepage-truncated', `hit MAX_BFS_LINKS=${MAX_BFS_LINKS}`, origin)
      }
      if (links.length >= MIN_DISCOVERED_URLS) {
        console.info(`[crawler] Level 5b Jina homepage found ${links.length} URLs for ${origin}`)
        report('jina-homepage-only', 'discovery fell back to homepage links (not a sitemap)', origin)
        return links
      }
      if (links.length > best.length) best = links
    }
  } catch (err) {
    report('jina-homepage', err, origin)
  }

  // 走到这里 = 每一级都没凑够阈值，返回的是「最好的那一份残缺结果」。
  if (best.length > 0) {
    report('partial-best-effort', `no level reached ${MIN_DISCOVERED_URLS} URLs; returning best partial result`, origin)
  }
  return best
}

/**
 * Recursively fetch page URLs from a sitemap (or sitemap index) via Jina
 * Reader, so WAF-blocked domains resolve through Jina's IPs. Child sitemaps
 * (any same-request .xml locs) are recursed into with rate-limit spacing.
 * Exported for unit testing — production callers go through discoverSitemapUrls.
 */
export async function fetchSitemapPagesViaJina(
  url: string,
  depth: number,
  delayMs: number = JINA_SITEMAP_DELAY_MS,
  visited: Set<string> = new Set(),
  report: Report = () => {}
): Promise<string[]> {
  if (depth >= MAX_SITEMAP_DEPTH) {
    report('jina-sitemap-depth-limit', `depth limit ${MAX_SITEMAP_DEPTH} reached`, url)
    return []
  }
  if (visited.has(url)) return []
  visited.add(url)
  const { fetchUrlRaw } = await import('../brief/jina')
  const raw = await fetchUrlRaw(url)

  let locs = parseLocsFromXml(raw)
  if (locs.length === 0) {
    // Jina's markdown output has no <loc> tags — recover bare/markdown-link URLs
    locs = extractBareUrls(raw)
  }

  const isSitemapUrl = (u: string) => /\.xml(\?[^#]*)?$/i.test(u)
  const pages = locs.filter(u => !isSitemapUrl(u))
  // visited guards self-references: Jina's "URL Source:" header repeats the
  // fetched .xml URL, which would otherwise recurse into itself every level
  const children = locs.filter(u => isSitemapUrl(u) && !visited.has(u))

  const all = [...pages]
  for (const child of children) {
    if (visited.has(child)) continue
    try {
      if (delayMs > 0) await delay(delayMs)
      all.push(...(await fetchSitemapPagesViaJina(child, depth + 1, delayMs, visited, report)))
    } catch (err) {
      report('jina-child-sitemap', err, child)
    }
  }
  return all
}

/**
 * Extract every bare http(s) URL from a text blob (no same-origin filtering —
 * callers run the result through dedupeAndFilter). Used when Jina renders a
 * sitemap without its XML tags.
 */
export function extractBareUrls(text: string): string[] {
  const seen = new Set<string>()
  const re = /https?:\/\/[^\s"'<>)\]]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    seen.add(m[0])
  }
  return Array.from(seen)
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
async function resolveSitemapUrls(
  sitemapUrls: string[],
  origin: string,
  report: Report = () => {},
): Promise<string[]> {
  const all: string[] = []
  for (const url of sitemapUrls) {
    all.push(...(await fetchSitemapPageUrls(url, 0, report)))
  }
  return all
}

/** 失败上报口。默认空实现 = 既有行为。 */
type Report = (stage: string, error: unknown, url?: string) => void

const MAX_SITEMAP_DEPTH = 3

/**
 * Recursively fetch page URLs from a sitemap or sitemap index.
 * If the fetched XML is a <sitemapindex>, recurses into each child.
 * Depth-limited to MAX_SITEMAP_DEPTH to guard against malformed cycles.
 */
async function fetchSitemapPageUrls(url: string, depth: number, report: Report = () => {}): Promise<string[]> {
  if (depth >= MAX_SITEMAP_DEPTH) {
    // 截断跟「这棵子树是空的」长得一样 —— 深度上限也是一次没取到。
    report('sitemap-depth-limit', `depth limit ${MAX_SITEMAP_DEPTH} reached`, url)
    return []
  }
  try {
    const res = await fetch(url)
    if (!res.ok) {
      report('sitemap-fetch', `HTTP ${res.status}`, url)
      return []
    }
    const xml = await res.text()
    if (/<sitemapindex/i.test(xml)) {
      const childUrls = parseLocsFromXml(xml)
      const nested: string[] = []
      for (const childUrl of childUrls) {
        nested.push(...(await fetchSitemapPageUrls(childUrl, depth + 1, report)))
      }
      return nested
    }
    return parseLocsFromXml(xml)
  } catch (err) {
    report('sitemap-fetch', err, url)
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
