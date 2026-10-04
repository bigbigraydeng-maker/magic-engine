/**
 * Site Auditor Crawler
 *
 * Two public functions:
 *   discoverSitemapUrls(domain) — four-level fallback URL discovery
 *   crawlPages(urls, opts)       — rate-limited, fault-tolerant page fetcher
 *
 * Reference: ROADMAP.md P8.0.2 DNZ collection infrastructure
 */

import { isSitemapIndexDocument } from './sitemap-root'
import { createSitemapFetchBudget, type SitemapFetchBudget } from './sitemap-budget'
import { fetchSitemapXmlSafely, type Report } from './sitemap-fetch'

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
  /** <meta name="description"> from Jina's JSON envelope; null = page has none / not captured. */
  metaDescription?: string | null
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

/**
 * Levels 1 and 2 probe well-known paths, so a 404 is the ordinary "try the next
 * level" signal and stays silent — the behaviour every onIssue test asserts. A
 * child named inside an index is the opposite: the document promised it exists,
 * so its 404 is a missing subtree and is reported.
 */
const LEVEL_1_PROBE = { failureStage: 'sitemap.xml', silentOnHttpError: true } as const
const LEVEL_2_PROBE = { failureStage: 'sitemap_index.xml', silentOnHttpError: true } as const
const CHILD_SITEMAP_READ = { failureStage: 'child-sitemap' } as const

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
 * XML 1.0 §2.2 legal character range:
 *   Char ::= #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
 * Rejects surrogate halves (0xD800–0xDFFF, the gap between the second and
 * third range) and anything past the Unicode ceiling (0x10FFFF) — both of
 * which make String.fromCodePoint() throw RangeError.
 */
function isValidXmlCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}

/**
 * Decode XML entities in <loc> text (Codex review on PR #963, P2).
 *
 * 🔴 Sitemap XML is required to escape `&` as `&amp;` — a query string like
 *    `?type=post&page=2` is written `?type=post&amp;page=2` in valid XML.
 *    parseLocsFromXml() used to return that text verbatim, and callers fetch
 *    it as-is: the literal `amp;page=2` param goes out on the wire instead of
 *    `page=2`, so multi-param sitemap/page URLs 404 or resolve to the wrong
 *    resource. This is a single left-to-right pass — each entity match is
 *    consumed once, so `&amp;amp;` (an XML-escaped literal "&amp;" string)
 *    decodes to `&amp;`, not `&` — no double-decoding of already-normal text.
 */
function decodeXmlEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X'
      const codePoint = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      // 🔴 Codex review on PR #963 (P2): a malformed sitemap can carry an
      //    out-of-range numeric entity (&#1114112;, a surrogate half, or a
      //    digit string long enough to overflow to Infinity). parseInt()
      //    never throws, but String.fromCodePoint() does — and this runs
      //    inside the one parse call for the whole XML document, so one bad
      //    <loc> would abort parsing and drop every valid page in the same
      //    file. Validate the range first; an illegal entity keeps its
      //    original source text instead of decoding (or crashing).
      if (!Number.isFinite(codePoint) || !isValidXmlCodePoint(codePoint)) return match
      return String.fromCodePoint(codePoint)
    }
    switch (entity) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      default: return match
    }
  })
}

/**
 * Parse <loc> text nodes from a sitemap XML string.
 * XML entities (&amp;, &#38;, &#x26;, ...) are decoded here — this is the
 * one shared parsing boundary every caller (Level 1, Level 2, robots.txt
 * directive, sitemap-index recursion, Jina fallback) goes through, so fixing
 * it here fixes it everywhere instead of patching individual call sites.
 */
export function parseLocsFromXml(xml: string): string[] {
  const locs: string[] = []
  const re = /<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    locs.push(decodeXmlEntities(m[1].trim()))
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
 * A BFS candidate has to be a web page. 🔴 Codex review on PR #963 (P2):
 * `new URL()` parses `ftp://example.com/f`, `data://…` and `javascript://…`
 * into a hostname *equal* to the audited site's, so hostname equality alone
 * admits them — and they would consume MAX_BFS_LINKS slots, ending discovery
 * early and handing Jina URLs it cannot fetch. The `startsWith(origin)` prefix
 * test this PR replaced rejected them as a side effect; keep that explicitly.
 * A link-candidate filter, not a network guard (that is safe-fetch.ts).
 */
function isWebPageScheme(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:'
}

/**
 * Extract same-origin href values from raw HTML.
 * Returns de-duped absolute http(s) URLs limited to `max` entries.
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
      const parsed = new URL(raw, origin)
      // Rejected candidates are never added, so they cannot occupy a `max` slot.
      if (isWebPageScheme(parsed) && isSameHost(parsed.href, origin) && !seen.has(parsed.href)) {
        seen.add(parsed.href)
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

  // Match markdown links: [text](https://...)
  const mdRe = /\]\((https?:\/\/[^\s)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = mdRe.exec(markdown)) !== null && seen.size < max) {
    try {
      const abs = new URL(m[1]).href
      if (isSameHost(abs, origin)) seen.add(abs)
    } catch { /* skip */ }
  }

  // Match bare URLs: https://domain/path
  const bareRe = /https?:\/\/[^\s)"'<>]+/g
  while ((m = bareRe.exec(markdown)) !== null && seen.size < max) {
    try {
      const abs = new URL(m[0]).href
      if (isSameHost(abs, origin)) seen.add(abs)
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

  /**
   * Pages found by the **sitemap** levels (robots.txt directives, Level 1,
   * Level 2), already same-host filtered, accumulated across the whole run.
   *
   * 🔴 Codex review on PR #963 (P2). The run-wide fetch ledger means a sitemap
   *    named by two levels is only *read* once — correct, but it made the
   *    second level see nothing. With a per-level "best single result" rule, a
   *    robots.txt directive yielding `/a` and a Level 1 index yielding `/b`
   *    each stayed under MIN_DISCOVERED_URLS, and discovery silently returned
   *    one page instead of two. Merging is the fix that keeps de-duplication:
   *    the document is still fetched once, its pages just are not thrown away.
   *
   *    Deliberately kept here in the orchestration layer, not in
   *    SitemapFetchBudget — that ledger owns "may this URL be requested", not
   *    XML, parse results or caching.
   */
  const discovered = new Set<string>()

  /** Sitemap levels: merge into the run, then answer once the run is big enough. */
  const collectSitemapPages = (urls: string[]): string[] | null => {
    for (const url of urls) discovered.add(url)
    return discovered.size >= MIN_DISCOVERED_URLS ? Array.from(discovered) : null
  }

  /** Non-sitemap levels (homepage BFS): unchanged "best single result" rule. */
  const keepOrEscalate = (urls: string[]): string[] | null => {
    if (urls.length >= MIN_DISCOVERED_URLS) return urls
    if (urls.length > best.length) best = urls
    return null
  }

  // 🔴 Scope note (PR #963 / issue #965): every **sitemap** read below goes
  //    through safeFetchText(). The robots.txt and homepage-BFS reads here
  //    deliberately still use a plain fetch(): they only ever hit `origin`,
  //    which this function derived itself from the client's registered domain,
  //    not a URL some fetched document handed us. Migrating them is a separate,
  //    separately-verified change — do not "fix" one of them in isolation.

  // One allowance for the whole run, shared by Level 1, the robots.txt
  // directives, Level 2 and every recursion level (Codex review on PR #963).
  const budget = createSitemapFetchBudget()

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
        const directiveLocs = await resolveSitemapUrls(directives, origin, report, budget)
        const urls = collectSitemapPages(dedupeAndFilter(directiveLocs, origin))
        if (urls) return urls
      }
    }
  } catch (err) {
    report('robots.txt', err, `${origin}/robots.txt`)
  }

  // Level 1: /sitemap.xml
  //
  // 🔴 Issue #955: 一个 <urlset> 里的 <loc> 都是真实页面，可以直接解析；但 /sitemap.xml
  //    也可能本身是一个 <sitemapindex>（尤其大站），那样 <loc> 指向的是子 sitemap 文档，
  //    不是页面。判断只能看响应内容里有没有 <sitemapindex>，不能靠 URL 后缀猜 —— 子
  //    sitemap 常见写法里就有 /sitemap/posts（无扩展名）、/sitemap.php?type=post（带 query）。
  //    命中 index 就复用 fetchSitemapPageUrls() 的递归展开，跟其它入口（robots.txt
  //    directive、/sitemap_index.xml）共用同一套深度限制和失败上报。
  //    「是不是 index」由 isSitemapIndexDocument() 按 XML 根元素判定 —— Level 1 和
  //    递归路径共用同一个判据，不能两处分叉。
  try {
    const level1 = await fetchSitemapXmlSafely(`${origin}/sitemap.xml`, report, budget, LEVEL_1_PROBE)
    if (level1.ok) {
      const locs = isSitemapIndexDocument(level1.xml)
        ? await expandSitemapIndexChildren(parseLocsFromXml(level1.xml), 1, report, budget)
        : parseLocsFromXml(level1.xml)
      const urls = collectSitemapPages(dedupeAndFilter(locs, origin))
      if (urls) return urls
    }
  } catch (err) {
    report('sitemap.xml', err, `${origin}/sitemap.xml`)
  }

  // Level 2: /sitemap_index.xml
  try {
    const level2 = await fetchSitemapXmlSafely(`${origin}/sitemap_index.xml`, report, budget, LEVEL_2_PROBE)
    if (level2.ok) {
      // sitemap_index contains <loc> entries pointing to child sitemaps
      const allLocs: string[] = []
      for (const childUrl of parseLocsFromXml(level2.xml)) {
        // Same SSRF guard as fetchSitemapPageUrls() (Codex review on PR #963):
        // childUrl comes straight out of /sitemap_index.xml's <loc> entries,
        // which the audited site controls — it must never reach a raw fetch().
        const result = await fetchSitemapXmlSafely(childUrl, report, budget, CHILD_SITEMAP_READ)
        if (result.ok) allLocs.push(...parseLocsFromXml(result.xml))
      }
      const urls = collectSitemapPages(dedupeAndFilter(allLocs, origin))
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
  // 🔴 Codex review on PR #963 (P2): the sitemap levels' accumulated pages are
  //    unioned in, not discarded in favour of the single longest level. A run
  //    that found /a via a robots.txt directive and /b via Level 1 must return
  //    both here, exactly as it would have if either level had reached the
  //    threshold on its own.
  const partial = Array.from(discovered)
  for (const url of best) if (!discovered.has(url)) partial.push(url)
  if (partial.length > 0) {
    report('partial-best-effort', `no level reached ${MIN_DISCOVERED_URLS} URLs; returning best partial result`, origin)
  }
  return partial
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
      const { fetchUrlWithMeta } = await import('../brief/jina')
      const { detectAntibotChallenge } = await import('./antibot-detector')
      const jinaResult = await withTimeout(fetchUrlWithMeta(url), timeout)
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
        metaDescription: antibot ? null : jinaResult.description,
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
  budget: SitemapFetchBudget = createSitemapFetchBudget(),
): Promise<string[]> {
  const all: string[] = []
  for (const url of sitemapUrls) {
    all.push(...(await fetchSitemapPageUrls(url, 0, report, budget)))
  }
  return all
}

const MAX_SITEMAP_DEPTH = 3

/**
 * Expand a sitemap index's child <loc> URLs into real page URLs, reusing
 * fetchSitemapPageUrls() so nested indexes, non-.xml sitemap paths, and
 * fetch failures are all handled by the one existing recursive implementation.
 */
async function expandSitemapIndexChildren(
  childUrls: string[],
  depth: number,
  report: Report = () => {},
  budget: SitemapFetchBudget = createSitemapFetchBudget(),
): Promise<string[]> {
  const nested: string[] = []
  for (const childUrl of childUrls) {
    nested.push(...(await fetchSitemapPageUrls(childUrl, depth, report, budget)))
  }
  return nested
}

/**
 * Recursively fetch page URLs from a sitemap or sitemap index.
 * If the fetched XML's root element is <sitemapindex>, recurses into each child.
 *
 * Two independent bounds, both required: MAX_SITEMAP_DEPTH caps how deep the
 * recursion nests, and `budget` caps how many documents the whole run may
 * request in total (a single level can be 50,000 entries wide). Neither
 * substitutes for the other.
 */
async function fetchSitemapPageUrls(
  url: string,
  depth: number,
  report: Report = () => {},
  budget: SitemapFetchBudget = createSitemapFetchBudget(),
): Promise<string[]> {
  if (depth >= MAX_SITEMAP_DEPTH) {
    // 截断跟「这棵子树是空的」长得一样 —— 深度上限也是一次没取到。
    report('sitemap-depth-limit', `depth limit ${MAX_SITEMAP_DEPTH} reached`, url)
    return []
  }
  const result = await fetchSitemapXmlSafely(url, report, budget)
  if (!result.ok) return []
  if (isSitemapIndexDocument(result.xml)) {
    return expandSitemapIndexChildren(parseLocsFromXml(result.xml), depth + 1, report, budget)
  }
  return parseLocsFromXml(result.xml)
}

/**
 * A URL's hostname reduced to the form the crawler compares, or null if it
 * cannot be parsed:
 *
 *   1. lower-cased;
 *   2. **one** trailing DNS root dot removed — `example.com.` is the absolute
 *      form of `example.com` and WHATWG URL keeps the dot in `hostname`
 *      (Codex review on PR #963, P2). Exactly one, so `example.com..` — which
 *      is not a legal rooted name — still reduces to `example.com.` and stays
 *      a different host;
 *   3. a leading `www.` removed, the crawler's pre-existing equivalence.
 */
function comparableHost(url: string): string | null {
  try {
    const host = new URL(url).hostname
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^www\./, '')
    return host === '' ? null : host
  } catch {
    return null
  }
}

/**
 * True when `candidate` and `origin` reduce to exactly the same hostname.
 *
 * 🔴 SSRF review on PR #963: this used to be a string-prefix check
 *    (`normU.startsWith(normOrigin)`), which wrongly accepts
 *    https://example.com.evil.test as belonging to example.com — the literal
 *    string "https://example.com" IS a prefix of that hostname. Comparing
 *    reduced hostnames for exact equality closes that hole, and the root-dot
 *    normalisation above does not reopen it: `example.com.evil.test` and
 *    `example.com..evil.test` have no trailing dot to remove.
 */
function isSameHost(candidate: string, origin: string): boolean {
  const candidateHost = comparableHost(candidate)
  const originHost = comparableHost(origin)
  return candidateHost !== null && candidateHost === originHost
}

/**
 * Remove duplicates and filter to same-host URLs only.
 * Treats www.domain.com and domain.com as the same host.
 */
function dedupeAndFilter(urls: string[], origin: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const u of urls) {
    if (!seen.has(u) && isSameHost(u, origin)) {
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
