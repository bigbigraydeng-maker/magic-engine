import { describe, expect, it } from 'vitest'
import { MAX_NEWS_FEEDS, normalizeNewsFeedUrls } from './intake-config'

describe('normalizeNewsFeedUrls', () => {
  it('keeps http/https, dedupes, and caps count', () => {
    const urls = Array.from({ length: MAX_NEWS_FEEDS + 5 }, (_, i) => `https://example.com/feed-${i}.xml`)
    urls.push('https://example.com/feed-0.xml', 'ftp://bad.example/feed')
    const out = normalizeNewsFeedUrls(urls)
    expect(out).toHaveLength(MAX_NEWS_FEEDS)
    expect(out.every((u) => u.startsWith('https://'))).toBe(true)
    expect(out).not.toContain('ftp://bad.example/feed')
  })

  it('drops invalid entries', () => {
    expect(normalizeNewsFeedUrls(['not-a-url', '', 42, 'http://ok.example/rss'])).toEqual([
      'http://ok.example/rss',
    ])
  })
})
