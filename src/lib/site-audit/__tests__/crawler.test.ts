/**
 * Site Auditor Crawler — TDD Test Suite
 *
 * Phase 2: RED — all tests written to fail first, then driven to GREEN.
 *
 * Coverage targets:
 *   discoverSitemapUrls — happy path + 4 fallback levels + edge cases
 *   crawlPages           — happy path + partial failure + rate limit + limit cap + timeout + title parsing
 *   helper functions     — normaliseDomain, parseLocsFromXml, parseSitemapDirectives,
 *                          isFullyCrawlBlocked, extractSameDomainLinks, extractTitle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  discoverSitemapUrls,
  fetchSitemapPagesViaJina,
  crawlPages,
  normaliseDomain,
  parseLocsFromXml,
  parseSitemapDirectives,
  isFullyCrawlBlocked,
  extractSameDomainLinks,
  extractBareUrls,
  extractTitle,
  delay,
  DEFAULT_LIMIT,
  DEFAULT_TIMEOUT,
  DEFAULT_RATE_LIMIT_MS,
  MAX_BFS_LINKS,
  MIN_DISCOVERED_URLS,
  type DiscoveryIssue,
} from '../crawler'
import { fetchUrlRaw, fetchUrlAsMarkdown } from '../../brief/jina'

// The crawler imports jina dynamically; mock it module-wide so discovery tests
// control the Jina escalation path. crawlPages tests override via vi.doMock.
vi.mock('../../brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
  fetchUrlRaw: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SITEMAP_XML_10_URLS = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page-1</loc></url>
  <url><loc>https://example.com/page-2</loc></url>
  <url><loc>https://example.com/page-3</loc></url>
  <url><loc>https://example.com/page-4</loc></url>
  <url><loc>https://example.com/page-5</loc></url>
  <url><loc>https://example.com/page-6</loc></url>
  <url><loc>https://example.com/page-7</loc></url>
  <url><loc>https://example.com/page-8</loc></url>
  <url><loc>https://example.com/page-9</loc></url>
  <url><loc>https://example.com/page-10</loc></url>
</urlset>`

const SITEMAP_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`

const SITEMAP_POSTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/post-1</loc></url>
  <url><loc>https://example.com/post-2</loc></url>
  <url><loc>https://example.com/post-3</loc></url>
</urlset>`

const SITEMAP_PAGES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/contact</loc></url>
  <url><loc>https://example.com/services</loc></url>
</urlset>`

const ROBOTS_TXT_WITH_SITEMAP = `User-agent: *
Allow: /

Sitemap: https://example.com/custom-sitemap.xml`

const CUSTOM_SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/custom-1</loc></url>
  <url><loc>https://example.com/custom-2</loc></url>
  <url><loc>https://example.com/custom-3</loc></url>
</urlset>`

const ROBOTS_TXT_BLOCKING_ALL = `User-agent: *
Disallow: /`

const ROBOTS_TXT_EMPTY = `User-agent: *
Allow: /`

const HOMEPAGE_HTML_WITH_LINKS = `<!DOCTYPE html>
<html>
<head><title>Example Site</title></head>
<body>
  <a href="/page-a">Page A</a>
  <a href="/page-b">Page B</a>
  <a href="https://example.com/page-c">Page C</a>
  <a href="/page-d">Page D</a>
  <a href="https://example.com/page-e">Page E</a>
  <a href="https://other-domain.com/external">External link</a>
  <a href="https://cdn.example.com/asset">Subdomain link (filtered)</a>
  <a href="mailto:info@example.com">Email (filtered)</a>
</body>
</html>`

const MARKDOWN_WITH_H1 = `# My Amazing Page Title

Some content here.`

const MARKDOWN_WITH_TITLE_TAG = `<title>HTML Title Tag Page</title>

Some content without H1.`

const MARKDOWN_NO_TITLE = `Just some plain text content without any heading.`

// ---------------------------------------------------------------------------
// Helper: build a fetch mock response
// ---------------------------------------------------------------------------

function mockResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function mockNotFound(): Response {
  return new Response('Not Found', { status: 404 })
}

// ---------------------------------------------------------------------------
// Helper utilities — Unit tests (always fast, no fetch)
// ---------------------------------------------------------------------------

describe('normaliseDomain', () => {
  it('strips path and query from full URL', () => {
    expect(normaliseDomain('https://example.com/path?q=1')).toBe('https://example.com')
  })

  it('adds https:// when scheme is missing', () => {
    expect(normaliseDomain('example.com')).toBe('https://example.com')
  })

  it('keeps https:// when already present', () => {
    expect(normaliseDomain('https://example.com')).toBe('https://example.com')
  })

  it('handles http:// input unchanged', () => {
    expect(normaliseDomain('http://example.com')).toBe('http://example.com')
  })

  it('removes trailing slash', () => {
    expect(normaliseDomain('https://example.com/')).toBe('https://example.com')
  })
})

describe('parseLocsFromXml', () => {
  it('extracts 10 URLs from a full sitemap', () => {
    const locs = parseLocsFromXml(SITEMAP_XML_10_URLS)
    expect(locs).toHaveLength(10)
    expect(locs[0]).toBe('https://example.com/page-1')
    expect(locs[9]).toBe('https://example.com/page-10')
  })

  it('returns empty array for XML with no <loc> tags', () => {
    expect(parseLocsFromXml('<urlset></urlset>')).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseLocsFromXml('')).toEqual([])
  })

  it('handles whitespace around URLs inside <loc>', () => {
    const xml = '<urlset><url><loc>  https://example.com/page  </loc></url></urlset>'
    const locs = parseLocsFromXml(xml)
    expect(locs).toHaveLength(1)
    expect(locs[0]).toBe('https://example.com/page')
  })

  it('extracts child sitemap URLs from a sitemap_index', () => {
    const locs = parseLocsFromXml(SITEMAP_INDEX_XML)
    expect(locs).toHaveLength(2)
    expect(locs[0]).toBe('https://example.com/sitemap-posts.xml')
  })
})

describe('parseSitemapDirectives', () => {
  it('extracts Sitemap: directive from robots.txt', () => {
    const directives = parseSitemapDirectives(ROBOTS_TXT_WITH_SITEMAP)
    expect(directives).toHaveLength(1)
    expect(directives[0]).toBe('https://example.com/custom-sitemap.xml')
  })

  it('returns empty array when no Sitemap directives present', () => {
    expect(parseSitemapDirectives(ROBOTS_TXT_EMPTY)).toEqual([])
  })

  it('returns empty array for empty robots.txt', () => {
    expect(parseSitemapDirectives('')).toEqual([])
  })

  it('handles multiple Sitemap directives', () => {
    const robots = `User-agent: *\nSitemap: https://example.com/s1.xml\nSitemap: https://example.com/s2.xml`
    const directives = parseSitemapDirectives(robots)
    expect(directives).toHaveLength(2)
  })
})

describe('isFullyCrawlBlocked', () => {
  it('returns true when User-agent: * has Disallow: /', () => {
    expect(isFullyCrawlBlocked(ROBOTS_TXT_BLOCKING_ALL)).toBe(true)
  })

  it('returns false when Disallow is absent', () => {
    expect(isFullyCrawlBlocked(ROBOTS_TXT_EMPTY)).toBe(false)
  })

  it('returns false when Disallow: / is under a specific bot, not wildcard', () => {
    const robots = `User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /`
    expect(isFullyCrawlBlocked(robots)).toBe(false)
  })

  it('returns false for empty robots.txt', () => {
    expect(isFullyCrawlBlocked('')).toBe(false)
  })
})

describe('extractSameDomainLinks', () => {
  const origin = 'https://example.com'

  it('returns 5 same-domain links and excludes external domains', () => {
    const links = extractSameDomainLinks(HOMEPAGE_HTML_WITH_LINKS, origin)
    expect(links).toHaveLength(5)
    expect(links.every(l => l.startsWith(origin))).toBe(true)
  })

  it('resolves relative hrefs to absolute URLs', () => {
    const html = '<a href="/about">About</a>'
    const links = extractSameDomainLinks(html, origin)
    expect(links).toContain('https://example.com/about')
  })

  it('de-duplicates URLs', () => {
    const html = '<a href="/page">P</a><a href="/page">P again</a>'
    const links = extractSameDomainLinks(html, origin)
    expect(links).toHaveLength(1)
  })

  it('respects the max parameter', () => {
    let html = ''
    for (let i = 0; i < 10; i++) html += `<a href="/p${i}">P</a>`
    const links = extractSameDomainLinks(html, origin, 3)
    expect(links).toHaveLength(3)
  })

  it('returns empty array for HTML with no links', () => {
    expect(extractSameDomainLinks('<p>No links</p>', origin)).toEqual([])
  })

  it('ignores mailto: and javascript: hrefs without throwing', () => {
    const html = '<a href="mailto:x@y.com">M</a><a href="javascript:void(0)">J</a>'
    const links = extractSameDomainLinks(html, origin)
    expect(links).toEqual([])
  })

  it('silently skips completely malformed href values (covers catch branch)', () => {
    // An href with null bytes cannot be parsed by URL() and triggers the catch
    const html = '<a href=" bad href">bad</a><a href="/valid">valid</a>'
    const links = extractSameDomainLinks(html, origin)
    // Only /valid should survive
    expect(links).toContain('https://example.com/valid')
  })

  it('does not throw when called with a non-URL origin (covers internal catch)', () => {
    // When origin is completely invalid, new URL(href, origin) throws for relative hrefs.
    // The function must silently skip those and not propagate the error.
    const html = '<a href="/page">page</a><a href="https://example.com/abs">abs</a>'
    expect(() => extractSameDomainLinks(html, 'not-a-valid-origin')).not.toThrow()
  })
})

describe('extractTitle', () => {
  it('extracts title from markdown H1 (priority 1)', () => {
    expect(extractTitle(MARKDOWN_WITH_H1, 'https://example.com/page')).toBe('My Amazing Page Title')
  })

  it('extracts title from <title> tag when no H1 present (priority 2)', () => {
    expect(extractTitle(MARKDOWN_WITH_TITLE_TAG, 'https://example.com/page')).toBe('HTML Title Tag Page')
  })

  it('falls back to hostname when neither H1 nor <title> present', () => {
    expect(extractTitle(MARKDOWN_NO_TITLE, 'https://example.com/page')).toBe('example.com')
  })

  it('H1 takes priority over <title> tag when both present', () => {
    const md = '# H1 Title\n<title>Title Tag</title>'
    expect(extractTitle(md, 'https://example.com')).toBe('H1 Title')
  })

  it('trims whitespace from extracted title', () => {
    const md = '#   Padded Title   \n'
    expect(extractTitle(md, 'https://example.com')).toBe('Padded Title')
  })

  it('falls back to raw url string when url is not parseable (covers catch branch)', () => {
    // Pass a non-URL string so new URL() throws
    const result = extractTitle(MARKDOWN_NO_TITLE, 'not-a-valid-url')
    expect(result).toBe('not-a-valid-url')
  })
})

// ---------------------------------------------------------------------------
// discoverSitemapUrls — integration-style (fetch mocked)
// ---------------------------------------------------------------------------

describe('discoverSitemapUrls', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    // Default: Jina unavailable — direct-fetch tests exercise levels 0-4 only
    vi.mocked(fetchUrlRaw).mockReset().mockRejectedValue(new Error('jina unavailable'))
    vi.mocked(fetchUrlAsMarkdown).mockReset().mockRejectedValue(new Error('jina unavailable'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('domain input normalisation', () => {
    it('accepts bare domain without scheme', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))          // robots.txt
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))       // sitemap.xml

      vi.stubGlobal('fetch', fetchMock)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls.length).toBeGreaterThan(0)
      // Verify fetch was called with https://
      expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/example\.com/)
    })

    it('accepts full https:// URL and normalises it', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))

      vi.stubGlobal('fetch', fetchMock)

      const urls = await discoverSitemapUrls('https://example.com')
      expect(urls.length).toBeGreaterThan(0)
    })
  })

  describe('happy path — sitemap.xml found', () => {
    it('returns 10 URLs from sitemap.xml', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))        // robots.txt
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))     // sitemap.xml
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(10)
      expect(urls[0]).toBe('https://example.com/page-1')
    })

    it('returns only same-domain URLs (filters cross-domain locs)', async () => {
      const mixedSitemap = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/local</loc></url>
  <url><loc>https://other.com/external</loc></url>
</urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(mixedSitemap))
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(1)
      expect(urls[0]).toBe('https://example.com/local')
    })

    it('de-duplicates URLs returned by sitemap', async () => {
      const dupeSitemap = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/page</loc></url>
  <url><loc>https://example.com/page</loc></url>
</urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(dupeSitemap))
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(1)
    })

    it('accepts sitemap URLs with www. prefix when domain has no www. (real-world case)', async () => {
      // Many sites redirect domain.com → www.domain.com and their sitemaps use www URLs
      // e.g. ctstours.co.nz sitemap contains https://www.ctstours.co.nz/* URLs
      const wwwSitemap = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://www.example.com/</loc></url>
  <url><loc>https://www.example.com/page-1</loc></url>
  <url><loc>https://www.example.com/page-2</loc></url>
  <url><loc>https://other.com/external</loc></url>
</urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(wwwSitemap))
      )

      // Domain passed without www — but sitemap uses www
      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(3)  // 3 www URLs, 1 external filtered out
      expect(urls[0]).toBe('https://www.example.com/')
    })

    it('accepts sitemap URLs without www. when domain has www.', async () => {
      const noWwwSitemap = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/page-a</loc></url>
  <url><loc>https://example.com/page-b</loc></url>
</urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(noWwwSitemap))
      )

      const urls = await discoverSitemapUrls('www.example.com')
      expect(urls).toHaveLength(2)
    })
  })

  describe('fallback 1 — sitemap.xml 404, sitemap_index.xml resolves', () => {
    it('fetches child sitemaps and returns 6 URLs total', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))         // robots.txt
        .mockResolvedValueOnce(mockNotFound())                         // sitemap.xml 404
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))        // sitemap_index.xml
        .mockResolvedValueOnce(mockResponse(SITEMAP_POSTS_XML))        // sitemap-posts.xml (3 URLs)
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))        // sitemap-pages.xml (3 URLs)
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(6)
      expect(urls).toContain('https://example.com/post-1')
      expect(urls).toContain('https://example.com/about')
    })

    it('skips unreachable child sitemaps and returns remaining URLs (covers L216 catch)', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))         // robots.txt
        .mockResolvedValueOnce(mockNotFound())                         // sitemap.xml 404
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))        // sitemap_index.xml (2 children)
        .mockRejectedValueOnce(new Error('Timeout'))                   // sitemap-posts.xml throws
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))        // sitemap-pages.xml succeeds (3 URLs)
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(3)
      expect(urls).toContain('https://example.com/about')
    })
  })

  /**
   * onIssue — 部分结果必须跟完整结果分得开（Issue #930）。
   *
   * 🔴 这些断言盯的是 discoverSitemapUrls 的**沉默**，不是它的返回值：
   *    每一级回退都会吞掉失败继续走，返回的数组跟完整发现长得一模一样 ——
   *    promise 正常 resolve、条数为正、没有任何异常。台账那边靠这个观察口
   *    才能把「这个站就这么多页」和「有一棵 sitemap 子树没取到」分开。
   *    上报点漏一个，就有一类缺页会重新变成静默的。
   */
  describe('onIssue — swallowed failures must be observable', () => {
    it('reports a child sitemap that throws', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))         // robots.txt
        .mockResolvedValueOnce(mockNotFound())                         // sitemap.xml 404
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))        // sitemap_index.xml
        .mockRejectedValueOnce(new Error('Timeout'))                   // sitemap-posts.xml throws
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))        // sitemap-pages.xml ok
      )
      const issues: DiscoveryIssue[] = []

      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      // 返回值跟「这个站只有 3 页」完全一样 —— 差别只在这个回调里。
      expect(urls).toHaveLength(3)
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ stage: 'child-sitemap', url: 'https://example.com/sitemap-posts.xml' })
      expect(issues[0].error).toContain('Timeout')
    })

    it('🔴 reports a child sitemap that answers non-OK (it never throws)', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))
        .mockResolvedValueOnce(new Response('nope', { status: 503 }))  // sitemap-posts.xml 503
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))
      )
      const issues: DiscoveryIssue[] = []

      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls).toHaveLength(3)
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ stage: 'child-sitemap', url: 'https://example.com/sitemap-posts.xml' })
      expect(issues[0].error).toContain('503')
    })

    it('reports sitemaps dropped on the robots.txt directive path', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))  // robots.txt (has Sitemap:)
        .mockRejectedValueOnce(new Error('ECONNRESET'))                // custom-sitemap.xml throws
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))      // sitemap.xml fallback
      )
      const issues: DiscoveryIssue[] = []

      await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(issues.some((i) => i.stage === 'sitemap-fetch' && i.url?.includes('custom-sitemap.xml'))).toBe(true)
    })

    it('reports a non-OK sitemap on the robots.txt directive path', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))
        .mockResolvedValueOnce(new Response('gone', { status: 410 }))  // custom-sitemap.xml 410
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))
      )
      const issues: DiscoveryIssue[] = []

      await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(issues.some((i) => i.stage === 'sitemap-fetch' && i.error.includes('410'))).toBe(true)
    })

    it('🔴 reports the depth-limit cut-off on the direct-fetch path', async () => {
      // robots.txt → custom-sitemap.xml → 一条只有 index 的链，第 4 层被截断。
      // 截断后返回的是空数组，跟「这棵子树本来就是空的」一模一样。
      const indexTo = (child: string) =>
        mockResponse(`<sitemapindex><sitemap><loc>${child}</loc></sitemap></sitemapindex>`)
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))              // robots.txt
        .mockResolvedValueOnce(indexTo('https://example.com/sitemap-b.xml'))       // depth 0
        .mockResolvedValueOnce(indexTo('https://example.com/sitemap-c.xml'))       // depth 1
        .mockResolvedValueOnce(indexTo('https://example.com/sitemap-d.xml'))       // depth 2
        .mockResolvedValue(mockResponse(SITEMAP_XML_10_URLS))                      // 后续回退
      )
      const issues: DiscoveryIssue[] = []

      await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(issues.some((i) => i.stage === 'sitemap-depth-limit')).toBe(true)
      expect(issues.find((i) => i.stage === 'sitemap-depth-limit')?.url).toBe(
        'https://example.com/sitemap-d.xml',
      )
    })

    it('🔴 reports when the result came from homepage BFS (best-effort, cannot enumerate a site)', async () => {
      // sitemap 全挂、靠首页链接凑出来的结果，跟「这个站就这么多页」长得一模一样。
      // 危险的不是 sitemap 404（那是正常回退），是**最后靠首页凑出来**这件事。
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse('<a href="/a">a</a><a href="/b">b</a>'))
      )
      const issues: DiscoveryIssue[] = []
      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls.length).toBeGreaterThanOrEqual(2)
      expect(issues.map((i) => i.stage)).toContain('homepage-bfs-only')
    })

    it('🔴 reports when homepage BFS hit the link cap (the rest are silently absent)', async () => {
      // 截到 MAX_BFS_LINKS 就返回，截断跟「这个站就这么多页」长得一样。
      const many = Array.from({ length: 80 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join('')
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(many))
      )
      const issues: DiscoveryIssue[] = []
      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls).toHaveLength(MAX_BFS_LINKS)
      expect(issues.map((i) => i.stage)).toContain('homepage-bfs-truncated')
    })

    it('stays silent when discovery is complete', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))
        .mockResolvedValueOnce(mockResponse(SITEMAP_POSTS_XML))
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))
      )
      const issues: DiscoveryIssue[] = []

      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      // sitemap.xml 的 404 是正常回退，不是「被吞掉的失败」—— 报它只会把噪音喂给
      // 「不完整必须有人认过」那道闸，认多了就没人认真看了。
      expect(urls).toHaveLength(6)
      expect(issues).toEqual([])
    })

    it('behaves exactly as before when no onIssue is passed', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))
      vi.stubGlobal('fetch', fetchMock)

      await expect(discoverSitemapUrls('example.com')).resolves.toHaveLength(3)
    })
  })

  describe('fallback 2 — robots.txt contains Sitemap directive', () => {
    it('discovers URLs from custom sitemap listed in robots.txt', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))  // robots.txt (has Sitemap:)
        .mockResolvedValueOnce(mockResponse(CUSTOM_SITEMAP_XML))       // custom-sitemap.xml
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(3)
      expect(urls).toContain('https://example.com/custom-1')
    })

    it('skips failed robots.txt sitemap directive fetch and falls through (covers resolveSitemapUrls catch)', async () => {
      // robots.txt has Sitemap: but fetching it throws — should fall through to sitemap.xml
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))  // robots.txt (has Sitemap:)
        .mockRejectedValueOnce(new Error('DNS failure'))               // custom-sitemap.xml throws
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))      // sitemap.xml succeeds
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(10)
    })
  })

  describe('fallback 3 — BFS homepage link extraction', () => {
    it('returns 5 same-domain links when all sitemaps fail', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))         // robots.txt (no Sitemap:)
        .mockResolvedValueOnce(mockNotFound())                         // sitemap.xml 404
        .mockResolvedValueOnce(mockNotFound())                         // sitemap_index.xml 404
        .mockResolvedValueOnce(mockResponse(HOMEPAGE_HTML_WITH_LINKS, 200)) // homepage
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(5)
      expect(urls.every(u => u.startsWith('https://example.com'))).toBe(true)
    })

    it('excludes external domain links from BFS results', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(HOMEPAGE_HTML_WITH_LINKS, 200))
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls.every(u => !u.startsWith('https://other-domain.com'))).toBe(true)
    })
  })

  describe('edge case — robots.txt blocks all crawling', () => {
    it('returns empty array when Disallow: / is set', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_BLOCKING_ALL))  // robots.txt
      )

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('disallows all crawling'))
      warnSpy.mockRestore()
    })

    it('logs a warning message when blocked', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_BLOCKING_ALL))
      )

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await discoverSitemapUrls('example.com')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      warnSpy.mockRestore()
    })
  })

  describe('edge case — all strategies fail', () => {
    it('returns empty array when fetch throws on every attempt', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toEqual([])
    })
  })

  describe('WAF-blocked domain — Jina escalation (2026-08-01 Oztop/SiteGround)', () => {
    const CHALLENGE_HTML_ONE_LINK = `<!DOCTYPE html>
<html><head><title>Checking your browser</title></head>
<body><h1>One moment please...</h1>
<a href="https://example.com/">Retry</a>
</body></html>`

    it('discovers full sitemap via Jina when every direct fetch is blocked', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse('Forbidden', 403)))
      vi.mocked(fetchUrlRaw).mockResolvedValue(SITEMAP_XML_10_URLS)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(10)
      expect(vi.mocked(fetchUrlRaw)).toHaveBeenCalledWith('https://example.com/sitemap.xml')
    })

    it('escalates past a 1-link challenge page instead of returning it (the Oztop bug)', async () => {
      // Direct homepage fetch "succeeds" but returns a WAF challenge page with
      // exactly one same-domain link — previously the crawler returned that
      // single URL and never reached the Jina levels.
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockNotFound())                             // robots.txt
        .mockResolvedValueOnce(mockNotFound())                             // sitemap.xml
        .mockResolvedValueOnce(mockNotFound())                             // sitemap_index.xml
        .mockResolvedValueOnce(mockResponse(CHALLENGE_HTML_ONE_LINK, 200)) // homepage (challenge)
      )
      vi.mocked(fetchUrlRaw).mockResolvedValue(SITEMAP_XML_10_URLS)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(10)
      expect(urls).toContain('https://example.com/page-1')
    })

    it('falls back to the best direct result when Jina also fails', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockNotFound())                             // robots.txt
        .mockResolvedValueOnce(mockNotFound())                             // sitemap.xml
        .mockResolvedValueOnce(mockNotFound())                             // sitemap_index.xml
        .mockResolvedValueOnce(mockResponse(CHALLENGE_HTML_ONE_LINK, 200)) // homepage (challenge)
      )
      // Jina mocks stay rejected (beforeEach default)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toEqual(['https://example.com/'])
    })

    it('recovers URLs when Jina strips the XML tags (bare-URL fallback)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('blocked')))
      vi.mocked(fetchUrlRaw).mockResolvedValue(`XML Sitemap
https://example.com/page-1
https://example.com/page-2
https://example.com/page-3
https://other-domain.com/external`)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(3)
      expect(urls.every(u => u.startsWith('https://example.com'))).toBe(true)
    })

    it('does not call Jina when a direct level already found enough URLs', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))
      )

      await discoverSitemapUrls('example.com')
      expect(vi.mocked(fetchUrlRaw)).not.toHaveBeenCalled()
      expect(vi.mocked(fetchUrlAsMarkdown)).not.toHaveBeenCalled()
    })

    it('MIN_DISCOVERED_URLS is 2', () => {
      expect(MIN_DISCOVERED_URLS).toBe(2)
    })
  })
})

// ---------------------------------------------------------------------------
// fetchSitemapPagesViaJina — sitemap-index recursion through Jina
// ---------------------------------------------------------------------------

describe('fetchSitemapPagesViaJina', () => {
  beforeEach(() => {
    vi.mocked(fetchUrlRaw).mockReset()
  })

  it('recurses into child sitemaps of a sitemap index', async () => {
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      if (url === 'https://example.com/sitemap.xml') return SITEMAP_INDEX_XML
      if (url === 'https://example.com/sitemap-posts.xml') return SITEMAP_POSTS_XML
      if (url === 'https://example.com/sitemap-pages.xml') return SITEMAP_PAGES_XML
      throw new Error(`Unexpected URL: ${url}`)
    })

    const urls = await fetchSitemapPagesViaJina('https://example.com/sitemap.xml', 0, 0)
    expect(urls).toHaveLength(6)
    expect(urls).toContain('https://example.com/post-1')
    expect(urls).toContain('https://example.com/about')
  })

  it('skips unreachable child sitemaps and keeps the rest', async () => {
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      if (url === 'https://example.com/sitemap.xml') return SITEMAP_INDEX_XML
      if (url === 'https://example.com/sitemap-pages.xml') return SITEMAP_PAGES_XML
      throw new Error('Timeout')
    })

    const urls = await fetchSitemapPagesViaJina('https://example.com/sitemap.xml', 0, 0)
    expect(urls).toHaveLength(3)
    expect(urls).toContain('https://example.com/about')
  })

  it('fetches a self-referencing sitemap only once (Jina "URL Source:" header)', async () => {
    // Jina's markdown output repeats the fetched URL, which looks like a child
    // sitemap — the visited set must stop it from recursing into itself.
    vi.mocked(fetchUrlRaw).mockResolvedValue(
      'URL Source: https://example.com/sitemap.xml\n\nhttps://example.com/page-1'
    )

    const urls = await fetchSitemapPagesViaJina('https://example.com/sitemap.xml', 0, 0)
    expect(urls).toEqual(['https://example.com/page-1'])
    expect(vi.mocked(fetchUrlRaw)).toHaveBeenCalledTimes(1)
  })

  it('stops recursion at max depth', async () => {
    // Chain of distinct sitemaps a → b → c → d; depth 3 must be refused
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      const next = { a: 'b', b: 'c', c: 'd', d: 'e' }[url.match(/sitemap-(\w)/)![1]]
      return `<sitemapindex><sitemap><loc>https://example.com/sitemap-${next}.xml</loc></sitemap></sitemapindex>`
    })

    const urls = await fetchSitemapPagesViaJina('https://example.com/sitemap-a.xml', 0, 0)
    expect(urls).toEqual([])
    // depth 0 (a), 1 (b), 2 (c) fetched; d at depth 3 refused
    expect(vi.mocked(fetchUrlRaw)).toHaveBeenCalledTimes(3)
  })

  it('🔴 reports the depth-limit cut-off — truncation looks like an empty subtree', async () => {
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      const next = { a: 'b', b: 'c', c: 'd', d: 'e' }[url.match(/sitemap-(\w)/)![1]]
      return `<sitemapindex><sitemap><loc>https://example.com/sitemap-${next}.xml</loc></sitemap></sitemapindex>`
    })
    const issues: DiscoveryIssue[] = []

    await fetchSitemapPagesViaJina('https://example.com/sitemap-a.xml', 0, 0, new Set(), (stage, error, url) =>
      issues.push({ stage, error: String(error), url }),
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      stage: 'jina-sitemap-depth-limit',
      url: 'https://example.com/sitemap-d.xml',
    })
  })

  it('reports a child sitemap that throws', async () => {
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      if (url === 'https://example.com/sitemap.xml') return SITEMAP_INDEX_XML
      if (url === 'https://example.com/sitemap-pages.xml') return SITEMAP_PAGES_XML
      throw new Error('Timeout')
    })
    const issues: DiscoveryIssue[] = []

    await fetchSitemapPagesViaJina('https://example.com/sitemap.xml', 0, 0, new Set(), (stage, error, url) =>
      issues.push({ stage, error: String(error), url }),
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      stage: 'jina-child-sitemap',
      url: 'https://example.com/sitemap-posts.xml',
    })
  })
})

describe('extractBareUrls', () => {
  it('extracts and de-duplicates bare URLs from text', () => {
    const text = 'see https://example.com/a and https://example.com/b plus https://example.com/a again'
    expect(extractBareUrls(text)).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('returns empty array when no URLs present', () => {
    expect(extractBareUrls('no links here')).toEqual([])
  })

  it('stops URLs at quotes and angle brackets', () => {
    const text = '<loc>https://example.com/x</loc> href="https://example.com/y"'
    expect(extractBareUrls(text)).toEqual(['https://example.com/x', 'https://example.com/y'])
  })
})

// ---------------------------------------------------------------------------
// crawlPages — integration-style (jina module mocked)
// ---------------------------------------------------------------------------

describe('crawlPages', () => {
  // Mock the jina module before importing crawler
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Build a vi.fn() that simulates fetchUrlAsMarkdown for a given URL.
   */
  function buildJinaMock(
    responses: Record<string, { markdown: string; title: string } | 'timeout' | 'error'>
  ) {
    return vi.fn().mockImplementation(async (url: string) => {
      const response = responses[url]
      if (!response) throw new Error(`Unexpected URL: ${url}`)
      if (response === 'timeout') throw new Error('Timeout after 10000ms')
      if (response === 'error') throw new Error('Network error')
      return { url, markdown: response.markdown, title: response.title, chars: response.markdown.length }
    })
  }

  describe('happy path — all URLs succeed', () => {
    it('returns CrawlResult for each URL with correct fields', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: buildJinaMock({
          'https://example.com/p1': { markdown: '# Page 1\nContent', title: 'Page 1' },
          'https://example.com/p2': { markdown: '# Page 2\nContent', title: 'Page 2' },
          'https://example.com/p3': { markdown: '# Page 3\nContent', title: 'Page 3' },
          'https://example.com/p4': { markdown: '# Page 4\nContent', title: 'Page 4' },
          'https://example.com/p5': { markdown: '# Page 5\nContent', title: 'Page 5' },
        }),
      }))

      const { crawlPages: cp } = await import('../crawler')

      const urls = Array.from({ length: 5 }, (_, i) => `https://example.com/p${i + 1}`)
      const results = await cp(urls, { rateLimitMs: 0 })

      expect(results).toHaveLength(5)
      results.forEach((r, i) => {
        expect(r.url).toBe(`https://example.com/p${i + 1}`)
        expect(r.statusCode).toBe(200)
        expect(r.error).toBeUndefined()
        expect(r.crawledAt).toBeInstanceOf(Date)
        expect(r.title).toBe(`Page ${i + 1}`)
      })
    })
  })

  describe('partial failure — some URLs fail', () => {
    it('marks failed URLs with error field, does not throw', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: buildJinaMock({
          'https://example.com/ok1': { markdown: '# OK1', title: 'OK1' },
          'https://example.com/ok2': { markdown: '# OK2', title: 'OK2' },
          'https://example.com/ok3': { markdown: '# OK3', title: 'OK3' },
          'https://example.com/fail1': 'error',
          'https://example.com/fail2': 'timeout',
        }),
      }))

      const { crawlPages: cp } = await import('../crawler')

      const urls = [
        'https://example.com/ok1',
        'https://example.com/ok2',
        'https://example.com/ok3',
        'https://example.com/fail1',
        'https://example.com/fail2',
      ]

      const results = await cp(urls, { rateLimitMs: 0 })
      expect(results).toHaveLength(5)

      const successes = results.filter(r => !r.error)
      const failures = results.filter(r => r.error)
      expect(successes).toHaveLength(3)
      expect(failures).toHaveLength(2)

      failures.forEach(f => {
        expect(f.statusCode).toBe(0)
        expect(f.markdown).toBe('')
        expect(typeof f.error).toBe('string')
        expect(f.error!.length).toBeGreaterThan(0)
      })
    })

    it('still returns results for successful URLs even when others fail', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: buildJinaMock({
          'https://example.com/good': { markdown: '# Good', title: 'Good' },
          'https://example.com/bad': 'error',
        }),
      }))

      const { crawlPages: cp } = await import('../crawler')
      const results = await cp(['https://example.com/good', 'https://example.com/bad'], { rateLimitMs: 0 })
      const good = results.find(r => r.url === 'https://example.com/good')
      expect(good?.statusCode).toBe(200)
      expect(good?.error).toBeUndefined()
    })
  })

  describe('limit cap', () => {
    it('only crawls first opts.limit URLs when input exceeds limit', async () => {
      const allResponses: Record<string, { markdown: string; title: string }> = {}
      for (let i = 1; i <= 150; i++) {
        allResponses[`https://example.com/p${i}`] = { markdown: `# Page ${i}`, title: `Page ${i}` }
      }

      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: buildJinaMock(allResponses),
      }))

      const { crawlPages: cp } = await import('../crawler')
      const urls = Array.from({ length: 150 }, (_, i) => `https://example.com/p${i + 1}`)
      const results = await cp(urls, { limit: 100, rateLimitMs: 0 })

      expect(results).toHaveLength(100)
      expect(results[0].url).toBe('https://example.com/p1')
      expect(results[99].url).toBe('https://example.com/p100')
    })

    it('uses DEFAULT_LIMIT (100) when limit not specified', async () => {
      const allResponses: Record<string, { markdown: string; title: string }> = {}
      for (let i = 1; i <= 120; i++) {
        allResponses[`https://example.com/p${i}`] = { markdown: `# Page ${i}`, title: `Page ${i}` }
      }

      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: buildJinaMock(allResponses),
      }))

      const { crawlPages: cp } = await import('../crawler')
      const urls = Array.from({ length: 120 }, (_, i) => `https://example.com/p${i + 1}`)
      const results = await cp(urls, { rateLimitMs: 0 })

      expect(results).toHaveLength(DEFAULT_LIMIT)
    })
  })

  describe('rate limiting', () => {
    it('enforces minimum delay between requests', async () => {
      const timestamps: number[] = []

      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: vi.fn().mockImplementation(async (url: string) => {
          timestamps.push(Date.now())
          return { url, markdown: '# Page', title: 'Page', chars: 6 }
        }),
      }))

      const { crawlPages: cp } = await import('../crawler')
      const urls = ['https://example.com/p1', 'https://example.com/p2', 'https://example.com/p3']
      const rateLimitMs = 50 // use 50ms for test speed

      await cp(urls, { rateLimitMs })

      expect(timestamps).toHaveLength(3)
      // Gap between consecutive requests must be >= rateLimitMs
      for (let i = 1; i < timestamps.length; i++) {
        const gap = timestamps[i] - timestamps[i - 1]
        expect(gap).toBeGreaterThanOrEqual(rateLimitMs - 5) // 5ms tolerance for timer imprecision
      }
    }, 10_000)

    it('does not delay after the last request', async () => {
      const callCount = { delays: 0 }
      const originalSetTimeout = globalThis.setTimeout

      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: vi.fn().mockResolvedValue({
          url: 'https://example.com/p1',
          markdown: '# Page',
          title: 'Page',
          chars: 6,
        }),
      }))

      const { crawlPages: cp } = await import('../crawler')
      // With 1 URL there should be no delay at all
      const urls = ['https://example.com/only']
      const start = Date.now()
      await cp(urls, { rateLimitMs: 500 })
      const elapsed = Date.now() - start

      // Should not have waited 500ms since only one URL
      expect(elapsed).toBeLessThan(400)
    })
  })

  describe('title extraction', () => {
    it('uses title from Jina result directly', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: vi.fn().mockResolvedValue({
          url: 'https://example.com/p',
          markdown: '# H1 Title',
          title: 'Jina Extracted Title',
          chars: 10,
        }),
      }))

      const { crawlPages: cp } = await import('../crawler')
      const results = await cp(['https://example.com/p'], { rateLimitMs: 0 })
      expect(results[0].title).toBe('Jina Extracted Title')
    })

    it('falls back to H1 extraction when Jina title is empty', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: vi.fn().mockResolvedValue({
          url: 'https://example.com/p',
          markdown: '# My H1 Title\nContent',
          title: '',
          chars: 20,
        }),
      }))

      const { crawlPages: cp } = await import('../crawler')
      const results = await cp(['https://example.com/p'], { rateLimitMs: 0 })
      expect(results[0].title).toBe('My H1 Title')
    })

    it('falls back to hostname when markdown has no title signals', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: vi.fn().mockResolvedValue({
          url: 'https://example.com/p',
          markdown: 'Plain content, no title signals.',
          title: '',
          chars: 30,
        }),
      }))

      const { crawlPages: cp } = await import('../crawler')
      const results = await cp(['https://example.com/p'], { rateLimitMs: 0 })
      expect(results[0].title).toBe('example.com')
    })
  })

  describe('crawledAt timestamp', () => {
    it('sets crawledAt to a Date instance for each result', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: vi.fn().mockResolvedValue({
          url: 'https://example.com/p',
          markdown: '# Page',
          title: 'Page',
          chars: 6,
        }),
      }))

      const { crawlPages: cp } = await import('../crawler')
      const before = new Date()
      const results = await cp(['https://example.com/p'], { rateLimitMs: 0 })
      const after = new Date()

      expect(results[0].crawledAt).toBeInstanceOf(Date)
      expect(results[0].crawledAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(results[0].crawledAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })
  })

  describe('empty input', () => {
    it('returns empty array for empty URL list', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlAsMarkdown: vi.fn(),
      }))

      const { crawlPages: cp } = await import('../crawler')
      const results = await cp([])
      expect(results).toEqual([])
    })
  })

  describe('default constants', () => {
    it('DEFAULT_LIMIT is 100', () => {
      expect(DEFAULT_LIMIT).toBe(100)
    })

    it('DEFAULT_TIMEOUT is 10000', () => {
      expect(DEFAULT_TIMEOUT).toBe(10_000)
    })

    it('DEFAULT_RATE_LIMIT_MS is 1000', () => {
      expect(DEFAULT_RATE_LIMIT_MS).toBe(1_000)
    })

    it('MAX_BFS_LINKS is 50', () => {
      expect(MAX_BFS_LINKS).toBe(50)
    })
  })
})

// ---------------------------------------------------------------------------
// delay utility
// ---------------------------------------------------------------------------

describe('delay', () => {
  it('resolves after approximately the given ms', async () => {
    const start = Date.now()
    await delay(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45)
  })

  it('resolves with undefined', async () => {
    const result = await delay(0)
    expect(result).toBeUndefined()
  })
})
