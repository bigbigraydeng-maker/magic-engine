import { describe, expect, it, vi } from 'vitest'
import { fetchNewsViralsForIntake } from './intake-news-feeds'

describe('fetchNewsViralsForIntake', () => {
  it('returns mapped items and swallows per-feed errors', async () => {
    const fetchFeedFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([
        {
          title: 'OpenAI ships tool',
          url: 'https://example.com/a',
          publishedAt: '2026-11-01T00:00:00Z',
          excerpt: 'AI update',
        },
      ])

    const { items, warnings } = await fetchNewsViralsForIntake({
      keywords: ['AI'],
      maxItems: 5,
      feedUrls: ['https://bad.example/feed', 'https://good.example/feed'],
      fetchFeedFn,
    })

    expect(warnings).toHaveLength(1)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('OpenAI ships tool')
    expect(items[0].engagement).toContain('新闻热点')
  })
})
