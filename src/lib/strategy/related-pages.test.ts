/**
 * Tests for related-pages.ts (Phase 8.D.2.1)
 *
 * findRelatedPages takes a query (topic / primary keyword / topic tags)
 * and returns the top N existing site pages that share content with it.
 * The output feeds the blog generator prompt as "existing_pages_context"
 * to prevent the new article from duplicating existing content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/site-pages', () => ({
  listSitePages: vi.fn(),
}))

import { findRelatedPages, formatPagesForPrompt } from './related-pages'
import { listSitePages } from '@/lib/db/site-pages'
import type { SitePage } from '@/types/magic-engine'

function page(overrides: Partial<SitePage> = {}): SitePage {
  return {
    id: 'p',
    client_id: 'c',
    url: 'https://example.com/x',
    path: '/x',
    page_type: 'service',
    title: 'X',
    h1: null,
    meta_description: null,
    content_summary: null,
    word_count: 800,
    topics: [],
    primary_keyword: null,
    has_geo_block: false,
    geo_block_version: null,
    crawl_status: 'crawled',
    last_crawled_at: null,
    crawl_error: null,
    created_at: 'now',
    updated_at: 'now',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findRelatedPages', () => {
  it('ranks pages with shared topics highest', async () => {
    vi.mocked(listSitePages).mockResolvedValue([
      page({
        id: 'p1',
        url: 'https://example.com/unrelated',
        topics: ['unrelated'],
        title: 'Unrelated',
      }),
      page({
        id: 'p2',
        url: 'https://example.com/china-tours',
        topics: ['china-tours', 'nz-travellers'],
        title: 'China Tours',
        primary_keyword: 'china tours',
      }),
      page({
        id: 'p3',
        url: 'https://example.com/some-other-tour',
        topics: ['china-tours'],
        title: 'Some other tour',
      }),
    ])

    const out = await findRelatedPages('c', {
      topics: ['china-tours'],
    })

    expect(out.length).toBe(2)
    expect(out[0].url).toBe('https://example.com/china-tours')
  })

  it('uses primary_keyword exact match as a strong signal', async () => {
    vi.mocked(listSitePages).mockResolvedValue([
      page({ id: 'p1', topics: ['unrelated'], title: 'A' }),
      page({
        id: 'p2',
        primary_keyword: 'china visa nz',
        title: 'NZ visa to China',
        topics: ['china-visa'],
      }),
    ])

    const out = await findRelatedPages('c', {
      primary_keyword: 'china visa nz',
    })

    expect(out[0].primary_keyword).toBe('china visa nz')
  })

  it('falls back to title keyword overlap when no topic tags', async () => {
    vi.mocked(listSitePages).mockResolvedValue([
      page({ id: 'p1', title: 'Auckland café guide', topics: [] }),
      page({ id: 'p2', title: 'China tour from NZ', topics: [] }),
    ])

    const out = await findRelatedPages('c', { topic: 'tours from new zealand to china' })
    expect(out[0].title).toBe('China tour from NZ')
  })

  it('respects limit', async () => {
    vi.mocked(listSitePages).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        page({
          id: `p${i}`,
          url: `https://example.com/p${i}`,
          topics: ['china-tours'],
        })
      )
    )

    const out = await findRelatedPages('c', { topics: ['china-tours'] }, 3)
    expect(out.length).toBe(3)
  })

  it('returns empty array when no signals match', async () => {
    vi.mocked(listSitePages).mockResolvedValue([
      page({ id: 'p1', title: 'A', topics: ['unrelated'] }),
    ])
    const out = await findRelatedPages('c', { topics: ['china-tours'] })
    expect(out).toEqual([])
  })

  it('only considers crawled pages', async () => {
    vi.mocked(listSitePages).mockResolvedValue([
      page({
        id: 'p1',
        topics: ['china-tours'],
        crawl_status: 'failed',
      }),
    ])
    await findRelatedPages('c', { topics: ['china-tours'] })
    // listSitePages should be called with crawl_status filter
    expect(listSitePages).toHaveBeenCalledWith('c', expect.objectContaining({ crawl_status: 'crawled' }))
  })
})

describe('formatPagesForPrompt', () => {
  it('renders compact human-readable lines', () => {
    const formatted = formatPagesForPrompt([
      {
        url: 'https://example.com/a',
        title: 'A',
        topics: ['x'],
        primary_keyword: 'a',
        word_count: 600,
        has_geo_block: true,
        content_summary: 'Lorem ipsum dolor.',
      },
    ])
    expect(formatted).toContain('https://example.com/a')
    expect(formatted).toContain('A')
    expect(formatted).toContain('Lorem ipsum')
  })

  it('returns a friendly message when given empty list', () => {
    const formatted = formatPagesForPrompt([])
    expect(formatted).toMatch(/no existing pages/i)
  })
})
