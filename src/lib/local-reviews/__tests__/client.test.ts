/**
 * Unit tests for src/lib/local-reviews/client.ts — GBP + ProductReview connector.
 *
 * Reference: ROADMAP.md P8.12.S1.2
 *
 * Mock strategy: global fetch is stubbed (SerpAPI); the Jina Reader module
 * is mocked via vi.hoisted so the mock survives vi.resetModules(); the
 * client module is re-imported each test so getSerpApiKey re-reads env.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { mockFetchUrl } = vi.hoisted(() => ({ mockFetchUrl: vi.fn() }))
vi.mock('@/lib/brief/jina', () => ({ fetchUrlAsMarkdown: mockFetchUrl }))

// ─── Response helpers ────────────────────────────────────────────────────────

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response)
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SERPAPI_PLACE = {
  place_results: {
    title: 'Oztop Building Supplies',
    rating: 3.8,
    reviews: 87,
    place_id: 'ChIJabc123',
    user_reviews: {
      most_relevant: [
        { username: 'Happy Customer', rating: 5, description: 'Great service!', date: '2 months ago' },
        { username: 'Angry Customer', rating: 1, description: 'Never delivered.', date: '1 week ago' },
        { username: 'Mild Customer', rating: 2, description: 'Slow and unhelpful.', date: '3 days ago' },
      ],
    },
  },
}

const SERPAPI_LOCAL_LIST = {
  local_results: [
    { title: 'Oztop Building Supplies', rating: 4.0, reviews: 50, place_id: 'ChIJlocal1' },
  ],
}

// ─── Env restore ─────────────────────────────────────────────────────────────

let savedSerpKey: string | undefined

beforeEach(() => {
  savedSerpKey = process.env.SERPAPI_API_KEY
  mockFetch.mockReset()
  mockFetchUrl.mockReset()
})

afterEach(() => {
  if (savedSerpKey !== undefined) process.env.SERPAPI_API_KEY = savedSerpKey
  else delete process.env.SERPAPI_API_KEY
  vi.resetModules()
})

// ─── fetchGbpReviews ─────────────────────────────────────────────────────────

describe('fetchGbpReviews', () => {
  it('throws when SERPAPI_API_KEY is missing', async () => {
    delete process.env.SERPAPI_API_KEY
    const { fetchGbpReviews } = await import('../client')
    await expect(fetchGbpReviews('Oztop Building Supplies QLD')).rejects.toThrow(
      /SERPAPI_API_KEY/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps place_results and keeps only negative review samples', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse(SERPAPI_PLACE))
    const { fetchGbpReviews } = await import('../client')

    const result = await fetchGbpReviews('Oztop Building Supplies Slacks Creek QLD')
    expect(result).not.toBeNull()
    expect(result!.source).toBe('google')
    expect(result!.rating).toBe(3.8)
    expect(result!.review_count).toBe(87)
    expect(result!.url).toContain('place_id:ChIJabc123')
    // 5-star review excluded; only the 1- and 2-star reviews kept.
    expect(result!.recent_negative_samples).toHaveLength(2)
    expect(result!.recent_negative_samples.every(r => r.rating <= 2)).toBe(true)
  })

  it('falls back to the first local_results entry when no place_results', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse(SERPAPI_LOCAL_LIST))
    const { fetchGbpReviews } = await import('../client')

    const result = await fetchGbpReviews('building supplies brisbane')
    expect(result!.rating).toBe(4.0)
    expect(result!.review_count).toBe(50)
    expect(result!.recent_negative_samples).toEqual([])
  })

  it('returns null when SerpAPI finds no place', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse({}))
    const { fetchGbpReviews } = await import('../client')

    expect(await fetchGbpReviews('no such business xyz')).toBeNull()
  })

  it('throws on a non-ok HTTP status', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse({}, 429))
    const { fetchGbpReviews } = await import('../client')

    await expect(fetchGbpReviews('anything')).rejects.toThrow(/SerpAPI error: 429/)
  })

  it('throws when SerpAPI returns an error field', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() =>
      jsonResponse({ error: 'Invalid API key' }),
    )
    const { fetchGbpReviews } = await import('../client')

    await expect(fetchGbpReviews('anything')).rejects.toThrow(/Invalid API key/)
  })

  // ── brand-token verification (P8.12.S1.7 — Apapaya regression) ────────────

  it('returns null when SerpAPI place title does not match the brand (Apapaya regression)', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    // SerpAPI returns a fuzzy match — a same-city unrelated business with a
    // different name. Without brand verification we'd surface it as "Apapaya".
    mockFetch.mockImplementation(() =>
      jsonResponse({
        place_results: {
          title: 'Some Unrelated Cafe',
          rating: 4.2,
          reviews: 1744,
          place_id: 'ChIJwrong',
        },
      }),
    )
    const { fetchGbpReviews } = await import('../client')

    expect(await fetchGbpReviews('Apapaya Wantirna South VIC')).toBeNull()
  })

  it('matches title case-insensitively', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() =>
      jsonResponse({
        place_results: {
          title: 'APAPAYA Wantirna',
          rating: 4.2,
          reviews: 1744,
          place_id: 'ChIJright',
        },
      }),
    )
    const { fetchGbpReviews } = await import('../client')

    const result = await fetchGbpReviews('Apapaya Wantirna South VIC')
    expect(result).not.toBeNull()
    expect(result!.rating).toBe(4.2)
  })

  it('drops a local_results fallback when no entry title matches the brand', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() =>
      jsonResponse({
        local_results: [
          { title: 'Random Other Business', rating: 4.0, reviews: 50, place_id: 'ChIJfuzzy' },
        ],
      }),
    )
    const { fetchGbpReviews } = await import('../client')

    expect(await fetchGbpReviews('Apapaya Melbourne')).toBeNull()
  })

  it('scans all local_results and picks the first brand-matching entry, not just [0]', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    // Codex review P2 on PR #24: real match may not be local_results[0].
    mockFetch.mockImplementation(() =>
      jsonResponse({
        local_results: [
          { title: 'Some Other Business', rating: 3.0, reviews: 10, place_id: 'ChIJfirst' },
          { title: 'Apapaya Cafe', rating: 4.5, reviews: 200, place_id: 'ChIJsecond' },
        ],
      }),
    )
    const { fetchGbpReviews } = await import('../client')

    const result = await fetchGbpReviews('Apapaya Melbourne')
    expect(result).not.toBeNull()
    expect(result!.rating).toBe(4.5)
    expect(result!.url).toContain('place_id:ChIJsecond')
  })
})

// ─── fetchProductReviewReviews ───────────────────────────────────────────────

describe('fetchProductReviewReviews', () => {
  it('returns null for a non-ProductReview URL without fetching', async () => {
    const { fetchProductReviewReviews } = await import('../client')
    const result = await fetchProductReviewReviews('https://example.com/reviews')
    expect(result).toBeNull()
    expect(mockFetchUrl).not.toHaveBeenCalled()
  })

  it('parses rating and review count from Jina markdown', async () => {
    mockFetchUrl.mockResolvedValue({
      url: 'https://www.productreview.com.au/listings/example',
      title: 'Example',
      markdown: '# Example\n\n4.2 out of 5\n\nBased on 134 reviews from real customers.',
      chars: 60,
    })
    const { fetchProductReviewReviews } = await import('../client')

    const result = await fetchProductReviewReviews(
      'https://www.productreview.com.au/listings/example',
    )
    expect(result).not.toBeNull()
    expect(result!.source).toBe('productreview')
    expect(result!.rating).toBe(4.2)
    expect(result!.review_count).toBe(134)
  })

  it('returns null when neither rating nor count can be parsed', async () => {
    mockFetchUrl.mockResolvedValue({
      url: 'https://www.productreview.com.au/listings/example',
      title: 'Example',
      markdown: '# Example\n\nNo structured rating data on this page.',
      chars: 40,
    })
    const { fetchProductReviewReviews } = await import('../client')

    expect(
      await fetchProductReviewReviews('https://www.productreview.com.au/listings/example'),
    ).toBeNull()
  })

  it('degrades gracefully to null when Jina throws (anti-scraping)', async () => {
    mockFetchUrl.mockRejectedValue(new Error('Jina fetch failed: HTTP 403'))
    const { fetchProductReviewReviews } = await import('../client')

    expect(
      await fetchProductReviewReviews('https://www.productreview.com.au/listings/example'),
    ).toBeNull()
  })
})

// ─── aggregateLocalReviews (non-fatal wrapper) ───────────────────────────────

describe('aggregateLocalReviews', () => {
  it('returns an empty array (never throws) when SERPAPI_API_KEY is missing', async () => {
    delete process.env.SERPAPI_API_KEY
    const { aggregateLocalReviews } = await import('../client')

    const result = await aggregateLocalReviews({ businessQuery: 'Oztop QLD' })
    expect(result).toEqual([])
  })

  it('aggregates both GBP and ProductReview snapshots when both succeed', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse(SERPAPI_PLACE))
    mockFetchUrl.mockResolvedValue({
      url: 'https://www.productreview.com.au/listings/example',
      title: 'Example',
      markdown: '4.2 out of 5 from 134 reviews',
      chars: 30,
    })
    const { aggregateLocalReviews } = await import('../client')

    const result = await aggregateLocalReviews({
      businessQuery: 'Oztop Building Supplies QLD',
      productReviewUrl: 'https://www.productreview.com.au/listings/example',
    })
    expect(result).toHaveLength(2)
    expect(result.map(s => s.source).sort()).toEqual(['google', 'productreview'])
  })

  it('skips ProductReview when no listing URL is provided', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse(SERPAPI_PLACE))
    const { aggregateLocalReviews } = await import('../client')

    const result = await aggregateLocalReviews({ businessQuery: 'Oztop QLD' })
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('google')
    expect(mockFetchUrl).not.toHaveBeenCalled()
  })
})
