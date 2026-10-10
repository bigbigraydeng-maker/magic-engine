/**
 * Site Auditor Crawler — crawlPages() and delay() tests.
 *
 * Split out of crawler.test.ts (Codex review on PR #963, P1 — the combined
 * file exceeded the repo's 800-line-per-file cap). crawlPages tests mock the
 * jina module per-test via vi.doMock + dynamic import (see beforeEach below),
 * so this file needs no module-wide vi.mock of '../../brief/jina'.
 * See crawler-test-files.ts for the fixed manifest of all split files.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  crawlPages,
  delay,
  DEFAULT_LIMIT,
  DEFAULT_TIMEOUT,
  DEFAULT_RATE_LIMIT_MS,
  MAX_BFS_LINKS,
} from '../crawler'

describe('crawlPages', () => {
  // Mock the jina module before importing crawler
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Build a vi.fn() that simulates fetchUrlWithMeta for a given URL.
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
        fetchUrlWithMeta: buildJinaMock({
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
        fetchUrlWithMeta: buildJinaMock({
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
        fetchUrlWithMeta: buildJinaMock({
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
        fetchUrlWithMeta: buildJinaMock(allResponses),
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
        fetchUrlWithMeta: buildJinaMock(allResponses),
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
        fetchUrlWithMeta: vi.fn().mockImplementation(async (url: string) => {
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
        fetchUrlWithMeta: vi.fn().mockResolvedValue({
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

  describe('meta description capture', () => {
    it('passes Jina description through as metaDescription', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlWithMeta: vi.fn().mockResolvedValue({
          url: 'https://example.com/p',
          markdown: '# H1 Title\nbody',
          title: 'H1 Title',
          chars: 15,
          description: 'A real meta description.',
        }),
      }))
      const { crawlPages: cp } = await import('../crawler')
      const [r] = await cp(['https://example.com/p'], { rateLimitMs: 0 })
      expect(r.metaDescription).toBe('A real meta description.')
    })

    it('keeps null when the page has no description', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlWithMeta: vi.fn().mockResolvedValue({
          url: 'https://example.com/p', markdown: '# T\nbody', title: 'T', chars: 8, description: null,
        }),
      }))
      const { crawlPages: cp } = await import('../crawler')
      const [r] = await cp(['https://example.com/p'], { rateLimitMs: 0 })
      expect(r.metaDescription).toBeNull()
    })
  })

  describe('title extraction', () => {
    it('uses title from Jina result directly', async () => {
      vi.doMock('../../brief/jina', () => ({
        fetchUrlWithMeta: vi.fn().mockResolvedValue({
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
        fetchUrlWithMeta: vi.fn().mockResolvedValue({
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
        fetchUrlWithMeta: vi.fn().mockResolvedValue({
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
        fetchUrlWithMeta: vi.fn().mockResolvedValue({
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
        fetchUrlWithMeta: vi.fn(),
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
