/**
 * google-ads/keyword-planner — request-shape & response-parsing tests.
 *
 * Pins the wire contract:
 *   - Google Ads `generateKeywordIdeas` REST body uses `languageConstants/{id}`
 *     and `geoTargetConstants/{id}` — not raw numeric IDs — and the seed list
 *     lives at `keywordSeed.keywords`.
 *   - Micros divide by 1_000_000 (a common regression: dividing by 100 or
 *     forgetting to divide altogether inflates bids 10,000x or 1M×).
 *   - Missing metrics come back as null, not 0 — a "no data" keyword must
 *     stay distinguishable from a "zero-search" keyword downstream.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeywordIdeas, GEO_TARGET_CONSTANT_ID, LANGUAGE_CONSTANT_ID } from '../keyword-planner'
import type { GoogleAdsCreds } from '../client'

const CREDS: GoogleAdsCreds = {
  developerToken:    'dev-token',
  clientId:          'oauth-cid',
  clientSecret:      'oauth-secret',
  refreshToken:      'rt',
  customerId:        '1234567890',
  managerCustomerId: '9999999999',
}

function tokenOk(): Response {
  return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600, token_type: 'Bearer' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

function ideasOk(rows: Array<Record<string, unknown>>): Response {
  return new Response(JSON.stringify({ results: rows }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

describe('generateKeywordIdeas · request shape', () => {
  let calls: Array<{ url: string; init: RequestInit }>

  beforeEach(() => {
    calls = []
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} })
      // First call = OAuth token, second call = API
      return calls.length === 1 ? tokenOk() : ideasOk([])
    }) as unknown as typeof fetch
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('POSTs to /customers/{id}:generateKeywordIdeas with the correct REST body shape', async () => {
    await generateKeywordIdeas(CREDS, {
      keywords:     ['china tour', '  china travel  ', ''],  // whitespace + empty stripped
      geoTargetIds: [GEO_TARGET_CONSTANT_ID.NZ, GEO_TARGET_CONSTANT_ID.AU],
      languageId:   LANGUAGE_CONSTANT_ID.en,
      network:      'GOOGLE_SEARCH',
    })

    const apiCall = calls[1]
    expect(apiCall.url).toBe(
      'https://googleads.googleapis.com/v25/customers/1234567890:generateKeywordIdeas',
    )
    expect(apiCall.init.method).toBe('POST')

    const body = JSON.parse(apiCall.init.body as string)
    expect(body).toEqual({
      language:             'languageConstants/1000',
      geoTargetConstants:   ['geoTargetConstants/2554', 'geoTargetConstants/2036'],
      includeAdultKeywords: false,
      keywordPlanNetwork:   'GOOGLE_SEARCH',
      keywordSeed:          { keywords: ['china tour', 'china travel'] },
    })

    // MCC header must ride along when managerCustomerId is set
    const headers = apiCall.init.headers as Record<string, string>
    expect(headers['developer-token']).toBe('dev-token')
    expect(headers['login-customer-id']).toBe('9999999999')
    expect(headers['Authorization']).toBe('Bearer AT')
  })

  it('defaults to NZ + English + partners network when no scope params given', async () => {
    await generateKeywordIdeas(CREDS, { keywords: ['china tour'] })
    const body = JSON.parse(calls[1].init.body as string)
    expect(body.geoTargetConstants).toEqual(['geoTargetConstants/2554'])
    expect(body.language).toBe('languageConstants/1000')
    expect(body.keywordPlanNetwork).toBe('GOOGLE_SEARCH_AND_PARTNERS')
  })

  it('rejects an empty seed list with a clear error', async () => {
    await expect(generateKeywordIdeas(CREDS, { keywords: ['   ', ''] }))
      .rejects.toThrow(/at least one non-empty seed keyword/)
    // No API call fired; the empty-seed guard is pre-fetch
    expect(calls.length).toBe(0)
  })
})

describe('generateKeywordIdeas · response parsing', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('divides micros → currency units and normalises competition labels', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(ideasOk([
        {
          text: 'china tour',
          keywordIdeaMetrics: {
            avgMonthlySearches:      '1000',
            competition:             'HIGH',
            competitionIndex:        '85',
            lowTopOfPageBidMicros:   '1500000',   // NZ$1.50
            highTopOfPageBidMicros:  '4500000',   // NZ$4.50
            averageCpcMicros:        '2500000',   // NZ$2.50
          },
        },
      ])) as unknown as typeof fetch

    const [idea] = await generateKeywordIdeas(CREDS, { keywords: ['china tour'] })
    expect(idea.text).toBe('china tour')
    expect(idea.avg_monthly_searches).toBe(1000)
    expect(idea.competition).toBe('HIGH')
    expect(idea.competition_index).toBe(85)
    expect(idea.low_top_of_page_bid).toBeCloseTo(1.5, 4)
    expect(idea.high_top_of_page_bid).toBeCloseTo(4.5, 4)
    expect(idea.average_cpc).toBeCloseTo(2.5, 4)
  })

  it('returns null (not 0) for missing metric fields so "no data" ≠ "zero"', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(ideasOk([
        {
          text: 'china private tour',
          keywordIdeaMetrics: {
            competition: 'MEDIUM',
            // avgMonthlySearches / bids / cpc all absent
          },
        },
      ])) as unknown as typeof fetch

    const [idea] = await generateKeywordIdeas(CREDS, { keywords: ['china private tour'] })
    expect(idea.avg_monthly_searches).toBeNull()
    expect(idea.competition_index).toBeNull()
    expect(idea.low_top_of_page_bid).toBeNull()
    expect(idea.high_top_of_page_bid).toBeNull()
    expect(idea.average_cpc).toBeNull()
    expect(idea.competition).toBe('MEDIUM')
  })

  it('skips rows without text and normalises unknown competition to UNKNOWN', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(ideasOk([
        { text: '', keywordIdeaMetrics: { competition: 'HIGH' } },       // dropped
        { text: 'valid kw', keywordIdeaMetrics: { competition: 'WEIRD_VALUE' } },
      ])) as unknown as typeof fetch

    const ideas = await generateKeywordIdeas(CREDS, { keywords: ['seed'] })
    expect(ideas.length).toBe(1)
    expect(ideas[0].text).toBe('valid kw')
    expect(ideas[0].competition).toBe('UNKNOWN')
  })

  it('returns [] on API HTTP error instead of throwing (matches client.ts pattern)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(new Response('quota exceeded', { status: 429 })) as unknown as typeof fetch

    const ideas = await generateKeywordIdeas(CREDS, { keywords: ['seed'] })
    expect(ideas).toEqual([])
  })
})
