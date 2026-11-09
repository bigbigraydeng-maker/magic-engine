/**
 * Unit tests for src/lib/local-reviews/client.ts — GBP + ProductReview +
 * Tripadvisor connector.
 *
 * Reference: ROADMAP.md P8.12.S1.2 / P8.13.C.2
 *
 * Mock strategy: global fetch is stubbed (DataForSEO Business Data transport);
 * the Jina Reader module is mocked via vi.hoisted. DataForSEO credentials are
 * injected with vi.stubEnv so the suite never depends on the real environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { mockFetchUrl } = vi.hoisted(() => ({ mockFetchUrl: vi.fn() }))
vi.mock('@/lib/brief/jina', () => ({ fetchUrlAsMarkdown: mockFetchUrl }))

import {
  fetchGbpReviews,
  fetchProductReviewReviews,
  fetchTripadvisorReviews,
  aggregateLocalReviews,
} from '../client'

// ─── Response helpers ────────────────────────────────────────────────────────

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response)
}

/** Wrap items in the DataForSEO `tasks[0].result[0].items` envelope. */
function dataforseoItems(items: unknown[]) {
  return { tasks: [{ status_code: 20000, result: [{ items }] }] }
}

type Route = {
  gmbInfo?:     () => Promise<Response>
  reviews?:     () => Promise<Response>
  tripadvisor?: () => Promise<Response>
}

/** Route fetch calls by DataForSEO endpoint path. */
function routeFetch(routes: Route) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/business_data/google/my_business_info/live')) {
      return (routes.gmbInfo ?? (() => jsonResponse(dataforseoItems([]))))()
    }
    if (url.includes('/business_data/google/reviews/live')) {
      return (routes.reviews ?? (() => jsonResponse(dataforseoItems([]))))()
    }
    if (url.includes('/business_data/tripadvisor/search/live')) {
      return (routes.tripadvisor ?? (() => jsonResponse(dataforseoItems([]))))()
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

function callsTo(pathFragment: string): Array<[string, RequestInit]> {
  return (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(([url]) =>
    url.includes(pathFragment),
  )
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const GMB_PLACE = dataforseoItems([
  {
    place_id: 'ChIJabc123',
    title:    'Oztop Building Supplies',
    address:  '1 Example St, Slacks Creek QLD 4127',
    phone:    '+61 7 0000 0000',
    url:      'https://oztop.com.au',
    maps_url: 'https://maps.google.com/?cid=123',
    rating:   { value: 3.8, votes_count: 87 },
  },
])

const GOOGLE_REVIEWS = dataforseoItems([
  { rating: { value: 5 }, review_text: 'Great service!',       timestamp: '2026-07-01', author_name: 'Happy Customer' },
  { rating: { value: 1 }, review_text: 'Never delivered.',     timestamp: '2026-08-20', author_name: 'Angry Customer' },
  { rating: { value: 2 }, review_text: 'Slow and unhelpful.',  timestamp: '2026-08-28', author_name: 'Mild Customer' },
  { rating: { value: 4 }, review_text: 'Fine.',                timestamp: '2026-08-29', author_name: null },
])

const TRIPADVISOR_LISTING = dataforseoItems([
  {
    title:         'CTS Tours',
    url:           'https://www.tripadvisor.co.nz/Attraction_Review-cts-tours',
    rating:        4.6,
    reviews_count: 312,
  },
])

// ─── Env + mock lifecycle ────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv('DATAFORSEO_LOGIN', 'test-login')
  vi.stubEnv('DATAFORSEO_PASSWORD', 'test-password')
  mockFetch.mockReset()
  mockFetchUrl.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ─── fetchGbpReviews ─────────────────────────────────────────────────────────

describe('fetchGbpReviews', () => {
  it('throws when DATAFORSEO_LOGIN is missing and never hits the network', async () => {
    vi.stubEnv('DATAFORSEO_LOGIN', '')
    await expect(fetchGbpReviews('Oztop Building Supplies QLD')).rejects.toThrow(
      /DATAFORSEO_LOGIN/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends Basic auth built from the stubbed credentials and the business keyword', async () => {
    routeFetch({ gmbInfo: () => jsonResponse(GMB_PLACE) })

    await fetchGbpReviews('Oztop Building Supplies Slacks Creek QLD')

    const [, init] = callsTo('my_business_info')[0]
    const expectedAuth = `Basic ${Buffer.from('test-login:test-password').toString('base64')}`
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(expectedAuth)
    expect(JSON.parse(init.body as string)).toEqual([
      { keyword: 'Oztop Building Supplies Slacks Creek QLD', language_code: 'en' },
    ])
  })

  it('maps the GMB place card and keeps only negative review samples', async () => {
    routeFetch({
      gmbInfo: () => jsonResponse(GMB_PLACE),
      reviews: () => jsonResponse(GOOGLE_REVIEWS),
    })

    const result = await fetchGbpReviews('Oztop Building Supplies Slacks Creek QLD')

    expect(result).toEqual({
      source:              'google',
      url:                 'https://maps.google.com/?cid=123',
      rating:              3.8,
      review_count:        87,
      rating_distribution: null,
      response_rate:       null,
      recent_negative_samples: [
        { rating: 1, text: 'Never delivered.',    date: '2026-08-20', author: 'Angry Customer' },
        { rating: 2, text: 'Slow and unhelpful.', date: '2026-08-28', author: 'Mild Customer' },
      ],
    })
    // Reviews are requested for the same keyword, 20 deep.
    const [, reviewsInit] = callsTo('google/reviews')[0]
    expect(JSON.parse(reviewsInit.body as string)[0]).toMatchObject({
      keyword: 'Oztop Building Supplies Slacks Creek QLD',
      depth:   20,
    })
  })

  it('caps negative samples at 5', async () => {
    const many = dataforseoItems(
      Array.from({ length: 8 }, (_, i) => ({
        rating: { value: 1 }, review_text: `bad ${i}`, timestamp: null, author_name: null,
      })),
    )
    routeFetch({
      gmbInfo: () => jsonResponse(GMB_PLACE),
      reviews: () => jsonResponse(many),
    })

    const result = await fetchGbpReviews('Oztop')
    expect(result!.recent_negative_samples).toHaveLength(5)
    expect(result!.recent_negative_samples.map(r => r.text)).toEqual(
      ['bad 0', 'bad 1', 'bad 2', 'bad 3', 'bad 4'],
    )
  })

  it('returns null (and skips the reviews call) when DataForSEO finds no place', async () => {
    routeFetch({ gmbInfo: () => jsonResponse(dataforseoItems([])) })

    expect(await fetchGbpReviews('no such business xyz')).toBeNull()
    expect(callsTo('google/reviews')).toHaveLength(0)
  })

  it('returns null when the response has no tasks at all', async () => {
    routeFetch({ gmbInfo: () => jsonResponse({}) })

    expect(await fetchGbpReviews('no such business xyz')).toBeNull()
  })

  it('throws on a non-ok HTTP status from the place lookup', async () => {
    routeFetch({ gmbInfo: () => jsonResponse({}, 429) })

    await expect(fetchGbpReviews('anything')).rejects.toThrow(/DataForSEO GMB info error: 429/)
  })

  it('still returns the snapshot when the reviews call fails (samples are enrichment)', async () => {
    routeFetch({
      gmbInfo: () => jsonResponse(GMB_PLACE),
      reviews: () => jsonResponse({}, 500),
    })

    const result = await fetchGbpReviews('Oztop')
    expect(result).not.toBeNull()
    expect(result!.rating).toBe(3.8)
    expect(result!.recent_negative_samples).toEqual([])
  })

  it('returns an empty sample list when there are no reviews', async () => {
    routeFetch({
      gmbInfo: () => jsonResponse(GMB_PLACE),
      reviews: () => jsonResponse(dataforseoItems([])),
    })

    const result = await fetchGbpReviews('Oztop')
    expect(result!.recent_negative_samples).toEqual([])
  })

  it('leaves url/rating/review_count null when the place card omits them', async () => {
    routeFetch({
      gmbInfo: () => jsonResponse(dataforseoItems([{ place_id: 'ChIJbare', title: 'Bare Listing' }])),
    })

    const result = await fetchGbpReviews('Bare Listing')
    expect(result).toMatchObject({ source: 'google', url: null, rating: null, review_count: null })
  })
})

// ─── fetchProductReviewReviews ───────────────────────────────────────────────

describe('fetchProductReviewReviews', () => {
  it('returns null for a non-ProductReview URL without fetching', async () => {
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

    expect(
      await fetchProductReviewReviews('https://www.productreview.com.au/listings/example'),
    ).toBeNull()
  })

  it('degrades gracefully to null when Jina throws (anti-scraping)', async () => {
    mockFetchUrl.mockRejectedValue(new Error('Jina fetch failed: HTTP 403'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(
      await fetchProductReviewReviews('https://www.productreview.com.au/listings/example'),
    ).toBeNull()
    spy.mockRestore()
  })
})

// ─── fetchTripadvisorReviews ─────────────────────────────────────────────────

describe('fetchTripadvisorReviews', () => {
  it('maps the first Tripadvisor listing', async () => {
    routeFetch({ tripadvisor: () => jsonResponse(TRIPADVISOR_LISTING) })

    const result = await fetchTripadvisorReviews('CTS Tours New Zealand')
    expect(result).toEqual({
      source:                  'tripadvisor',
      url:                     'https://www.tripadvisor.co.nz/Attraction_Review-cts-tours',
      rating:                  4.6,
      review_count:            312,
      rating_distribution:     null,
      recent_negative_samples: [],
      response_rate:           null,
    })
  })

  it('returns null when the listing has no URL', async () => {
    routeFetch({
      tripadvisor: () => jsonResponse(dataforseoItems([{ title: 'CTS Tours', rating: 4.6 }])),
    })

    expect(await fetchTripadvisorReviews('CTS Tours')).toBeNull()
  })

  it('never throws — HTTP errors degrade to null', async () => {
    routeFetch({ tripadvisor: () => jsonResponse({}, 503) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await fetchTripadvisorReviews('CTS Tours')).toBeNull()
    spy.mockRestore()
  })
})

// ─── aggregateLocalReviews (non-fatal wrapper) ───────────────────────────────

describe('aggregateLocalReviews', () => {
  it('returns an empty array (never throws) when DataForSEO credentials are missing', async () => {
    vi.stubEnv('DATAFORSEO_LOGIN', '')

    const result = await aggregateLocalReviews({ businessQuery: 'Oztop QLD' })
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('aggregates both GBP and ProductReview snapshots when both succeed', async () => {
    routeFetch({
      gmbInfo: () => jsonResponse(GMB_PLACE),
      reviews: () => jsonResponse(GOOGLE_REVIEWS),
    })
    mockFetchUrl.mockResolvedValue({
      url: 'https://www.productreview.com.au/listings/example',
      title: 'Example',
      markdown: '4.2 out of 5 from 134 reviews',
      chars: 30,
    })

    const result = await aggregateLocalReviews({
      businessQuery: 'Oztop Building Supplies QLD',
      productReviewUrl: 'https://www.productreview.com.au/listings/example',
    })
    expect(result).toHaveLength(2)
    expect(result.map(s => s.source).sort()).toEqual(['google', 'productreview'])
  })

  it('skips ProductReview when no listing URL is provided', async () => {
    routeFetch({ gmbInfo: () => jsonResponse(GMB_PLACE) })

    const result = await aggregateLocalReviews({ businessQuery: 'Oztop QLD' })
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('google')
    expect(mockFetchUrl).not.toHaveBeenCalled()
  })

  it('adds a Tripadvisor snapshot when a tripadvisorKeyword is provided', async () => {
    routeFetch({
      gmbInfo:     () => jsonResponse(GMB_PLACE),
      tripadvisor: () => jsonResponse(TRIPADVISOR_LISTING),
    })

    const result = await aggregateLocalReviews({
      businessQuery: 'CTS Tours Auckland',
      tripadvisorKeyword: 'CTS Tours New Zealand',
    })
    expect(result.map(s => s.source).sort()).toEqual(['google', 'tripadvisor'])
  })

  it('a GBP transport failure does not block the other sources', async () => {
    routeFetch({
      gmbInfo:     () => jsonResponse({}, 500),
      tripadvisor: () => jsonResponse(TRIPADVISOR_LISTING),
    })
    mockFetchUrl.mockResolvedValue({
      url: 'https://www.productreview.com.au/listings/example',
      title: 'Example',
      markdown: '4.2 out of 5 from 134 reviews',
      chars: 30,
    })

    const result = await aggregateLocalReviews({
      businessQuery: 'Oztop QLD',
      productReviewUrl: 'https://www.productreview.com.au/listings/example',
      tripadvisorKeyword: 'Oztop',
    })
    expect(result.map(s => s.source).sort()).toEqual(['productreview', 'tripadvisor'])
  })

  it('drops null snapshots so callers only see resolved sources', async () => {
    routeFetch({ gmbInfo: () => jsonResponse(dataforseoItems([])) })
    mockFetchUrl.mockResolvedValue({
      url: 'https://www.productreview.com.au/listings/example',
      title: 'Example',
      markdown: 'nothing parseable here',
      chars: 22,
    })

    const result = await aggregateLocalReviews({
      businessQuery: 'ghost business',
      productReviewUrl: 'https://www.productreview.com.au/listings/example',
    })
    expect(result).toEqual([])
  })
})
