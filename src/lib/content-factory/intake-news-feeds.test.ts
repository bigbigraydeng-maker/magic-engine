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

  it('falls back to recent items when keywords do not match', async () => {
    const fetchFeedFn = vi.fn().mockResolvedValue([
      {
        title: 'Unrelated headline in English',
        url: 'https://example.com/b',
        publishedAt: '2026-10-01T00:00:00Z',
        excerpt: 'body',
      },
      {
        title: 'Newer unrelated',
        url: 'https://example.com/c',
        publishedAt: '2026-11-01T00:00:00Z',
        excerpt: 'body',
      },
    ])

    const { items } = await fetchNewsViralsForIntake({
      keywords: ['出海'],
      maxItems: 2,
      feedUrls: ['https://example.com/feed'],
      fetchFeedFn,
    })

    expect(items.map((i) => i.title)).toEqual(['Newer unrelated', 'Unrelated headline in English'])
  })
})
