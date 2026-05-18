/**
 * Unit tests for src/lib/local-directory/client.ts
 *
 * Reference: ROADMAP.md P8.12.S3.5
 *
 * Mock strategy: Jina module is mocked via vi.hoisted; the five exported
 * pure functions (buildYellowPagesUrl, buildLocalsearchUrl, parseDirectoryMarkdown)
 * are tested with static imports; discoverLocalCompetitors relies on the same mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildYellowPagesUrl,
  buildLocalsearchUrl,
  parseDirectoryMarkdown,
  discoverLocalCompetitors,
} from '../client'

const { mockFetchUrl } = vi.hoisted(() => ({ mockFetchUrl: vi.fn() }))
vi.mock('@/lib/brief/jina', () => ({ fetchUrlAsMarkdown: mockFetchUrl }))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const YP_MARKDOWN = `
# Yellow Pages - Plumbers in Sydney NSW

## Joe's Plumbing Services
Licensed plumber | Emergency
📞 02 9123 4567
📍 123 Main St, Sydney NSW 2000
⭐ 4.8 (245 reviews)

## ABC Plumbing Co
Residential plumbing
☎ 0412 345 678
45 Park Ave, North Sydney NSW 2060
4.5 out of 5 (89 reviews)

## Fast Fix Plumbing
02 8765 4321
Surry Hills NSW 2010
3.9 stars 12 reviews
`

const LS_MARKDOWN = `
# Find Plumbers in Sydney

### [Joe's Plumbing Services](https://localsearch.com.au/businesses/123)
Sydney plumbing
Phone: 02 9123 4567
Sydney, NSW 2000
4.8 (89 ratings)

### Smith Plumbing
Plumbing Sydney
0412 987 654
456 George St, Sydney NSW 2000
Rating: 4.7/5 (156 reviews)
`

function jinaResponse(markdown: string) {
  return { url: 'https://example.com', title: 'Test', markdown, chars: markdown.length }
}

// ─── buildYellowPagesUrl ──────────────────────────────────────────────────────

describe('buildYellowPagesUrl', () => {
  it('builds a URL pointing at yellowpages.com.au/search/listings', () => {
    const url = buildYellowPagesUrl('plumber', 'Sydney NSW')
    expect(url).toContain('yellowpages.com.au/search/listings')
  })

  it('includes the industry as "clue" parameter', () => {
    const url = buildYellowPagesUrl('plumber', 'Sydney NSW')
    expect(url).toContain('clue=plumber')
  })

  it('includes the location as "locationClue" parameter', () => {
    const url = buildYellowPagesUrl('plumber', 'Sydney NSW')
    expect(url).toContain('locationClue=')
    expect(url).toContain('Sydney')
  })

  it('encodes multi-word industry', () => {
    const url = buildYellowPagesUrl('travel agent', 'Sydney NSW')
    // URLSearchParams encodes spaces as "+"
    expect(url).toContain('clue=travel')
    expect(url).toContain('agent')
  })
})

// ─── buildLocalsearchUrl ──────────────────────────────────────────────────────

describe('buildLocalsearchUrl', () => {
  it('builds a slug URL on localsearch.com.au', () => {
    const url = buildLocalsearchUrl('plumber', 'Sydney NSW')
    expect(url).toBe('https://www.localsearch.com.au/find/plumber/sydney-nsw/')
  })

  it('slugifies multi-word industry with hyphens', () => {
    const url = buildLocalsearchUrl('travel agent', 'Sydney NSW')
    expect(url).toBe('https://www.localsearch.com.au/find/travel-agent/sydney-nsw/')
  })

  it('strips commas from location', () => {
    const url = buildLocalsearchUrl('dentist', 'Melbourne, VIC')
    expect(url).toBe('https://www.localsearch.com.au/find/dentist/melbourne-vic/')
  })

  it('lowercases everything', () => {
    const url = buildLocalsearchUrl('PLUMBER', 'SYDNEY NSW')
    expect(url).toBe('https://www.localsearch.com.au/find/plumber/sydney-nsw/')
  })
})

// ─── parseDirectoryMarkdown ───────────────────────────────────────────────────

describe('parseDirectoryMarkdown', () => {
  const SRC_URL = 'https://yellowpages.com.au/test'

  it('extracts business names from H2 headings', () => {
    const entries = parseDirectoryMarkdown(YP_MARKDOWN, 'yellowpages_au', SRC_URL)
    expect(entries.length).toBeGreaterThanOrEqual(3)
    expect(entries[0].name).toBe("Joe's Plumbing Services")
    expect(entries[1].name).toBe('ABC Plumbing Co')
    expect(entries[2].name).toBe('Fast Fix Plumbing')
  })

  it('strips Markdown link syntax from business names', () => {
    const entries = parseDirectoryMarkdown(LS_MARKDOWN, 'localsearch', 'https://ls.com.au/test')
    expect(entries[0].name).toBe("Joe's Plumbing Services")
    expect(entries[0].name).not.toContain('[')
    expect(entries[0].name).not.toContain('http')
  })

  it('extracts AU landline phone numbers', () => {
    const entries = parseDirectoryMarkdown(YP_MARKDOWN, 'yellowpages_au', SRC_URL)
    expect(entries[0].phone).toBe('02 9123 4567')
  })

  it('extracts AU mobile phone numbers', () => {
    const entries = parseDirectoryMarkdown(YP_MARKDOWN, 'yellowpages_au', SRC_URL)
    expect(entries[1].phone).toBe('0412 345 678')
  })

  it('extracts ratings from "X.X out of 5" pattern', () => {
    const entries = parseDirectoryMarkdown(YP_MARKDOWN, 'yellowpages_au', SRC_URL)
    expect(entries[1].rating).toBe(4.5)
  })

  it('extracts ratings from "X.X stars" pattern', () => {
    const entries = parseDirectoryMarkdown(YP_MARKDOWN, 'yellowpages_au', SRC_URL)
    expect(entries[2].rating).toBe(3.9)
  })

  it('extracts ratings from "⭐ X.X" pattern', () => {
    const entries = parseDirectoryMarkdown(YP_MARKDOWN, 'yellowpages_au', SRC_URL)
    expect(entries[0].rating).toBe(4.8)
  })

  it('extracts ratings from "X.X/5" pattern (Localsearch)', () => {
    const entries = parseDirectoryMarkdown(LS_MARKDOWN, 'localsearch', 'https://ls.com.au/test')
    const smith = entries.find(e => e.name === 'Smith Plumbing')
    expect(smith?.rating).toBe(4.7)
  })

  it('extracts ratings from "X.X (N ratings)" pattern', () => {
    const entries = parseDirectoryMarkdown(LS_MARKDOWN, 'localsearch', 'https://ls.com.au/test')
    expect(entries[0].rating).toBe(4.8)
  })

  it('extracts review counts', () => {
    const entries = parseDirectoryMarkdown(YP_MARKDOWN, 'yellowpages_au', SRC_URL)
    expect(entries[0].reviewCount).toBe(245)
    expect(entries[1].reviewCount).toBe(89)
    expect(entries[2].reviewCount).toBe(12)
  })

  it('extracts addresses containing AU state abbreviations', () => {
    const entries = parseDirectoryMarkdown(YP_MARKDOWN, 'yellowpages_au', SRC_URL)
    expect(entries[0].address).toMatch(/NSW/)
    expect(entries[0].address).toContain('Sydney')
  })

  it('assigns the correct source and sourceUrl to all entries', () => {
    const yp = parseDirectoryMarkdown(YP_MARKDOWN, 'yellowpages_au', SRC_URL)
    const ls = parseDirectoryMarkdown(LS_MARKDOWN, 'localsearch', 'https://ls.com.au/test')
    expect(yp.every(e => e.source === 'yellowpages_au' && e.sourceUrl === SRC_URL)).toBe(true)
    expect(ls.every(e => e.source === 'localsearch')).toBe(true)
  })

  it('returns empty array when markdown has no H2/H3 headings', () => {
    const entries = parseDirectoryMarkdown(
      'No listings here — just prose.',
      'yellowpages_au',
      SRC_URL,
    )
    expect(entries).toEqual([])
  })

  it('skips navigation headings (Home, Search, Categories, etc.)', () => {
    const navMarkdown = `
## Home
nav item

## Categories
Browse categories

## Joe\\'s Plumbing
02 9999 0000
Sydney NSW 2000
4.0 out of 5 (5 reviews)
`
    const entries = parseDirectoryMarkdown(navMarkdown, 'yellowpages_au', SRC_URL)
    expect(entries.every(e => e.name !== 'Home' && e.name !== 'Categories')).toBe(true)
    expect(entries.some(e => e.name === "Joe\\'s Plumbing")).toBe(true)
  })

  it('caps output at 20 entries regardless of input size', () => {
    const bigMarkdown = Array.from(
      { length: 30 },
      (_, i) =>
        `## Business ${i + 1}\n02 9000 0000\n123 Street, Sydney NSW 2000\n4.0 out of 5 (10 reviews)`,
    ).join('\n\n')
    const entries = parseDirectoryMarkdown(bigMarkdown, 'yellowpages_au', SRC_URL)
    expect(entries.length).toBeLessThanOrEqual(20)
  })
})

// ─── discoverLocalCompetitors ─────────────────────────────────────────────────

describe('discoverLocalCompetitors', () => {
  beforeEach(() => mockFetchUrl.mockReset())

  it('combines entries from both sources and includes both in sources[]', async () => {
    mockFetchUrl
      .mockResolvedValueOnce(jinaResponse(YP_MARKDOWN))
      .mockResolvedValueOnce(jinaResponse(LS_MARKDOWN))

    const result = await discoverLocalCompetitors('plumber', 'Sydney NSW')

    expect(result.entries.length).toBeGreaterThan(0)
    expect(result.sources).toHaveLength(2)
    expect(result.query).toEqual({ industry: 'plumber', location: 'Sydney NSW' })
  })

  it('deduplicates entries with the same normalised name across sources', async () => {
    // "Joe's Plumbing Services" appears in both YP and LS fixtures
    mockFetchUrl
      .mockResolvedValueOnce(jinaResponse(YP_MARKDOWN))
      .mockResolvedValueOnce(jinaResponse(LS_MARKDOWN))

    const result = await discoverLocalCompetitors('plumber', 'Sydney NSW')
    const keys = result.entries.map(e => e.name.toLowerCase().replace(/[^a-z0-9]/g, ''))
    const unique = new Set(keys)
    expect(keys.length).toBe(unique.size)
  })

  it('respects the limit parameter', async () => {
    mockFetchUrl
      .mockResolvedValueOnce(jinaResponse(YP_MARKDOWN))
      .mockResolvedValueOnce(jinaResponse(LS_MARKDOWN))

    const result = await discoverLocalCompetitors('plumber', 'Sydney NSW', 2)
    expect(result.entries.length).toBeLessThanOrEqual(2)
  })

  it('degrades gracefully when Yellow Pages fails — returns Localsearch-only results', async () => {
    mockFetchUrl
      .mockRejectedValueOnce(new Error('YP blocked'))
      .mockResolvedValueOnce(jinaResponse(LS_MARKDOWN))

    const result = await discoverLocalCompetitors('plumber', 'Sydney NSW')

    expect(result.entries.length).toBeGreaterThan(0)
    expect(result.sources).toHaveLength(1)
    expect(result.entries.every(e => e.source === 'localsearch')).toBe(true)
  })

  it('degrades gracefully when Localsearch fails — returns YP-only results', async () => {
    mockFetchUrl
      .mockResolvedValueOnce(jinaResponse(YP_MARKDOWN))
      .mockRejectedValueOnce(new Error('LS blocked'))

    const result = await discoverLocalCompetitors('plumber', 'Sydney NSW')

    expect(result.entries.length).toBeGreaterThan(0)
    expect(result.sources).toHaveLength(1)
    expect(result.entries.every(e => e.source === 'yellowpages_au')).toBe(true)
  })

  it('returns empty entries (never throws) when both sources fail', async () => {
    mockFetchUrl
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))

    const result = await discoverLocalCompetitors('plumber', 'Sydney NSW')
    expect(result.entries).toEqual([])
    expect(result.sources).toEqual([])
  })

  it('clamps limit to 20 maximum', async () => {
    const bigMarkdown = Array.from(
      { length: 25 },
      (_, i) => `## Business ${i + 1}\n02 9000 0000\nSydney NSW 2000`,
    ).join('\n\n')
    mockFetchUrl
      .mockResolvedValueOnce(jinaResponse(bigMarkdown))
      .mockRejectedValueOnce(new Error('LS unavailable'))

    const result = await discoverLocalCompetitors('plumber', 'Sydney NSW', 99)
    expect(result.entries.length).toBeLessThanOrEqual(20)
  })

  it('always includes fetchedAt timestamp', async () => {
    mockFetchUrl
      .mockRejectedValueOnce(new Error())
      .mockRejectedValueOnce(new Error())
    const result = await discoverLocalCompetitors('plumber', 'Sydney NSW')
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
