/**
 * Tests for src/lib/strategy/analyzer.ts
 *
 * TDD: RED phase — all tests written before implementation.
 * Mocks Supabase via vi.mock('@/lib/supabase', ...).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import {
  fetchClientPages,
  fetchWeakAIQueries,
  fetchKeywordOpportunities,
  analyzeOpportunities,
} from '../analyzer'
import { supabaseAdmin } from '@/lib/supabase'
import type {
  ClientSitePageSummary,
  WeakAIQuery,
  KeywordOpportunity,
} from '../types'

// ---------------------------------------------------------------------------
// Typed mock reference
// ---------------------------------------------------------------------------

const mockFrom = vi.mocked(supabaseAdmin.from)

// ---------------------------------------------------------------------------
// Helpers to build chainable Supabase query mock
// ---------------------------------------------------------------------------

function makeSelectChain(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    then: undefined as unknown,
  }
  // Make it thenable so `await chain` resolves
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
    resolve({ data, error })
    return Promise.resolve({ data, error })
  }
  return chain
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-abc'

const SAMPLE_PAGE: ClientSitePageSummary = {
  id: 'page-1',
  url: 'https://example.com/china-tours',
  title: 'China Tours',
  page_type: 'service',
  topics: ['china', 'tours', 'travel'],
  primary_keyword: 'china tours nz',
  word_count: 800,
  has_geo_block: true,
}

const WEAK_PAGE: ClientSitePageSummary = {
  id: 'page-2',
  url: 'https://example.com/products',
  title: 'Our Products',
  page_type: 'product',
  topics: ['products'],
  primary_keyword: 'nz products',
  word_count: 300,
  has_geo_block: false,
}

const SAMPLE_QUERY: WeakAIQuery = {
  id: 'query-1',
  question: 'best china tour operators in new zealand',
  avg_rank: 5,
  weak_model_count: 3,
}

const UNRELATED_QUERY: WeakAIQuery = {
  id: 'query-2',
  question: 'best sydney hotels for families',
  avg_rank: null,
  weak_model_count: 2,
}

const SAMPLE_KEYWORD: KeywordOpportunity = {
  keyword: 'china tours nz',
  volume: 200,
  kd: 30,
  intent: 'commercial',
}

// ---------------------------------------------------------------------------
// fetchClientPages tests
// ---------------------------------------------------------------------------

describe('fetchClientPages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when DB returns an error', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain(null, { message: 'DB error', code: 'PGRST500' }) as unknown as ReturnType<typeof mockFrom>
    )
    const result = await fetchClientPages(CLIENT_ID)
    expect(result).toEqual([])
  })

  it('returns empty array when DB returns null data', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain(null, null) as unknown as ReturnType<typeof mockFrom>
    )
    const result = await fetchClientPages(CLIENT_ID)
    expect(result).toEqual([])
  })

  it('returns mapped pages when DB call succeeds', async () => {
    const dbRows = [
      {
        id: 'page-1',
        url: 'https://example.com/china-tours',
        title: 'China Tours',
        page_type: 'service',
        topics: ['china', 'tours'],
        primary_keyword: 'china tours nz',
        word_count: 800,
        has_geo_block: true,
      },
    ]
    mockFrom.mockReturnValue(
      makeSelectChain(dbRows, null) as unknown as ReturnType<typeof mockFrom>
    )
    const result = await fetchClientPages(CLIENT_ID)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('page-1')
    expect(result[0].url).toBe('https://example.com/china-tours')
    expect(result[0].has_geo_block).toBe(true)
    expect(result[0].topics).toEqual(['china', 'tours'])
  })

  it('queries the correct table with client_id filter', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain([], null) as unknown as ReturnType<typeof mockFrom>
    )
    await fetchClientPages(CLIENT_ID)
    expect(mockFrom).toHaveBeenCalledWith('client_site_pages')
  })
})

// ---------------------------------------------------------------------------
// fetchWeakAIQueries tests
// ---------------------------------------------------------------------------

describe('fetchWeakAIQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when first DB query (queries fetch) errors', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain(null, { message: 'Network error' }) as unknown as ReturnType<typeof mockFrom>
    )
    const result = await fetchWeakAIQueries(CLIENT_ID)
    expect(result).toEqual([])
  })

  it('returns empty array when DB returns null queries', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain(null, null) as unknown as ReturnType<typeof mockFrom>
    )
    const result = await fetchWeakAIQueries(CLIENT_ID)
    expect(result).toEqual([])
  })

  it('returns only queries with weak_model_count > 0', async () => {
    // First call: get enabled queries
    // Second call: get runs for query 'q1' → 2 weak runs
    // Third call: get runs for query 'q2' → 0 weak runs
    const queries = [
      { id: 'q1', question: 'best china tours', enabled: true },
      { id: 'q2', question: 'another question', enabled: true },
    ]
    const runsForQ1 = [
      { client_brand_rank: null, ran_at: new Date().toISOString() },
      { client_brand_rank: 5, ran_at: new Date().toISOString() },
    ]
    const runsForQ2: unknown[] = []

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return makeSelectChain(queries, null) as unknown as ReturnType<typeof mockFrom>
      } else if (callCount === 2) {
        return makeSelectChain(runsForQ1, null) as unknown as ReturnType<typeof mockFrom>
      } else {
        return makeSelectChain(runsForQ2, null) as unknown as ReturnType<typeof mockFrom>
      }
    })

    const result = await fetchWeakAIQueries(CLIENT_ID)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('q1')
    expect(result[0].weak_model_count).toBe(2)
  })

  it('sets avg_rank to null when no runs have valid ranks', async () => {
    const queries = [{ id: 'q1', question: 'test question', enabled: true }]
    const runs = [
      { client_brand_rank: null, ran_at: new Date().toISOString() },
    ]

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return makeSelectChain(queries, null) as unknown as ReturnType<typeof mockFrom>
      }
      return makeSelectChain(runs, null) as unknown as ReturnType<typeof mockFrom>
    })

    const result = await fetchWeakAIQueries(CLIENT_ID)
    expect(result[0].avg_rank).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// fetchKeywordOpportunities tests
// ---------------------------------------------------------------------------

describe('fetchKeywordOpportunities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array on DB error', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain(null, { message: 'DB error' }) as unknown as ReturnType<typeof mockFrom>
    )
    const result = await fetchKeywordOpportunities(CLIENT_ID)
    expect(result).toEqual([])
  })

  it('returns mapped keyword opportunities when DB succeeds', async () => {
    const dbRows = [
      { keyword: 'china tours nz', volume: 200, kd: 30, intent: 'commercial' },
      { keyword: 'nz travel packages', volume: 150, kd: 25, intent: 'informational' },
    ]
    mockFrom.mockReturnValue(
      makeSelectChain(dbRows, null) as unknown as ReturnType<typeof mockFrom>
    )
    const result = await fetchKeywordOpportunities(CLIENT_ID)
    expect(result).toHaveLength(2)
    expect(result[0].keyword).toBe('china tours nz')
    expect(result[0].volume).toBe(200)
    expect(result[0].kd).toBe(30)
  })

  it('queries the keywords table', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain([], null) as unknown as ReturnType<typeof mockFrom>
    )
    await fetchKeywordOpportunities(CLIENT_ID)
    expect(mockFrom).toHaveBeenCalledWith('keywords')
  })

  it('returns empty array when data is null with no error', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain(null, null) as unknown as ReturnType<typeof mockFrom>
    )
    const result = await fetchKeywordOpportunities(CLIENT_ID)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// analyzeOpportunities tests
// ---------------------------------------------------------------------------

describe('analyzeOpportunities', () => {
  // Page with no geo_block and low word count → should generate upgrade opportunity
  it('generates upgrade_page opportunity for page without geo_block', async () => {
    const pages: ClientSitePageSummary[] = [WEAK_PAGE]
    const weakQueries: WeakAIQuery[] = []
    const keywords: KeywordOpportunity[] = []

    const result = await analyzeOpportunities(CLIENT_ID, pages, weakQueries, keywords)
    expect(result.length).toBeGreaterThanOrEqual(1)
    const upgrade = result.find(o => o.action_type === 'upgrade_page')
    expect(upgrade).toBeDefined()
    expect(upgrade!.source_page_id).toBe('page-2')
  })

  // Page fully covered (has_geo_block=true AND word_count>=500) → no upgrade
  it('does not generate upgrade_page for a page with geo_block and sufficient word count', async () => {
    const pages: ClientSitePageSummary[] = [SAMPLE_PAGE] // has_geo_block=true, word_count=800
    const weakQueries: WeakAIQuery[] = []
    const keywords: KeywordOpportunity[] = []

    const result = await analyzeOpportunities(CLIENT_ID, pages, weakQueries, keywords)
    const upgrade = result.find(o => o.action_type === 'upgrade_page')
    expect(upgrade).toBeUndefined()
  })

  // AI weak query with no matching page → generates new_blog
  it('generates new_blog opportunity for AI weak query with no matching page', async () => {
    const pages: ClientSitePageSummary[] = [] // no pages
    const weakQueries: WeakAIQuery[] = [UNRELATED_QUERY] // "best sydney hotels for families"
    const keywords: KeywordOpportunity[] = []

    const result = await analyzeOpportunities(CLIENT_ID, pages, weakQueries, keywords)
    const newBlog = result.find(o => o.action_type === 'new_blog' || o.action_type === 'social_content')
    expect(newBlog).toBeDefined()
    expect(newBlog!.source_query_id).toBe('query-2')
  })

  // AI weak query + matching keyword → content_mode = 'unified'
  it('sets content_mode unified for new_blog when weak query has matching keyword', async () => {
    const pages: ClientSitePageSummary[] = []
    const weakQueries: WeakAIQuery[] = [SAMPLE_QUERY] // "best china tour operators in new zealand"
    const keywords: KeywordOpportunity[] = [SAMPLE_KEYWORD] // "china tours nz"

    const result = await analyzeOpportunities(CLIENT_ID, pages, weakQueries, keywords)
    expect(result.length).toBeGreaterThanOrEqual(1)
    const opp = result.find(o => o.source_query_id === 'query-1')
    expect(opp).toBeDefined()
    expect(opp!.content_mode).toBe('unified')
  })

  // AI weak query, no keyword match → content_mode = 'geo_only'
  it('sets content_mode geo_only for new_blog when no matching keyword', async () => {
    const pages: ClientSitePageSummary[] = []
    const weakQueries: WeakAIQuery[] = [
      { id: 'q-99', question: 'best obscure niche widget suppliers', avg_rank: null, weak_model_count: 2 },
    ]
    const keywords: KeywordOpportunity[] = [SAMPLE_KEYWORD] // keyword doesn't match query

    const result = await analyzeOpportunities(CLIENT_ID, pages, weakQueries, keywords)
    const opp = result.find(o => o.source_query_id === 'q-99')
    expect(opp).toBeDefined()
    expect(opp!.content_mode).toBe('geo_only')
  })

  // Deduplication: same page generates only 1 opportunity
  it('deduplicates — same page only generates 1 opportunity', async () => {
    // Page has no geo_block (triggers upgrade), AND a weak query matches → should produce 1 not 2
    const page: ClientSitePageSummary = {
      id: 'page-dup',
      url: 'https://example.com/china-tours',
      title: 'China Tours',
      page_type: 'service',
      topics: ['china', 'tours'],
      primary_keyword: 'china tours',
      word_count: 200,
      has_geo_block: false,
    }
    const pages: ClientSitePageSummary[] = [page]
    const weakQueries: WeakAIQuery[] = [
      { id: 'q-china', question: 'best china tours nz', avg_rank: 5, weak_model_count: 2 },
    ]
    const keywords: KeywordOpportunity[] = []

    const result = await analyzeOpportunities(CLIENT_ID, pages, weakQueries, keywords)
    const forPage = result.filter(o => o.source_page_id === 'page-dup')
    expect(forPage.length).toBe(1)
  })

  // AI weak query covered by existing page → no new_blog for that query
  it('does not generate new_blog if existing page already covers the weak query topic', async () => {
    const page: ClientSitePageSummary = {
      id: 'page-covers',
      url: 'https://example.com/china-tours',
      title: 'China Tours',
      page_type: 'service',
      topics: ['china', 'tours', 'travel'],
      primary_keyword: 'china tours nz',
      word_count: 800,
      has_geo_block: true, // fully covered page
    }
    const pages: ClientSitePageSummary[] = [page]
    const weakQueries: WeakAIQuery[] = [SAMPLE_QUERY] // "best china tour operators in new zealand"
    const keywords: KeywordOpportunity[] = []

    const result = await analyzeOpportunities(CLIENT_ID, pages, weakQueries, keywords)
    // No new_blog since page covers the query
    const newBlogs = result.filter(o => o.source_query_id === 'query-1' && o.source_page_id === null)
    expect(newBlogs).toHaveLength(0)
  })

  // Upgrade page: existing page with no geo_block has matching weak query → ai_weak=true in scoring
  it('sets ai_weak=true in scoring_context when page matches a weak query', async () => {
    const page: ClientSitePageSummary = {
      id: 'page-weak',
      url: 'https://example.com/china-tours',
      title: 'China Tours',
      page_type: 'service',
      topics: ['china', 'tours'],
      primary_keyword: 'china tours',
      word_count: 300,
      has_geo_block: false,
    }
    const pages: ClientSitePageSummary[] = [page]
    const weakQueries: WeakAIQuery[] = [
      { id: 'q-china', question: 'best china tours nz', avg_rank: 5, weak_model_count: 2 },
    ]
    const keywords: KeywordOpportunity[] = []

    const result = await analyzeOpportunities(CLIENT_ID, pages, weakQueries, keywords)
    const upgrade = result.find(o => o.action_type === 'upgrade_page')
    expect(upgrade).toBeDefined()
    expect(upgrade!.scoring_context.ai_weak).toBe(true)
  })

  it('does not attach a broad first-trip query to every generic China tour page', async () => {
    const pages: ClientSitePageSummary[] = [
      {
        id: 'china-tours',
        url: 'https://example.com/china-tours',
        title: 'China Tours from New Zealand',
        page_type: 'service',
        topics: ['china', 'tours', 'new zealand'],
        primary_keyword: 'china tours nz',
        word_count: 300,
        has_geo_block: false,
      },
      {
        id: 'yunnan-tours',
        url: 'https://example.com/yunnan-tours',
        title: 'Yunnan Tours from New Zealand',
        page_type: 'service',
        topics: ['china', 'yunnan', 'tours'],
        primary_keyword: 'yunnan tours nz',
        word_count: 300,
        has_geo_block: false,
      },
    ]
    const weakQueries: WeakAIQuery[] = [
      {
        id: 'q-first-trip',
        question: 'How do I plan my first trip to China from New Zealand?',
        avg_rank: 5,
        weak_model_count: 3,
      },
    ]

    const result = await analyzeOpportunities(CLIENT_ID, pages, weakQueries, [])
    const upgradesForQuery = result.filter(
      o => o.source_query_id === 'q-first-trip' && o.source_page_id !== null,
    )
    const newBlog = result.find(
      o => o.source_query_id === 'q-first-trip' && o.source_page_id === null,
    )

    expect(upgradesForQuery).toHaveLength(0)
    expect(newBlog).toBeDefined()
  })

  it('keeps a specific query-to-page match when non-generic tokens overlap', async () => {
    const page: ClientSitePageSummary = {
      id: 'small-group',
      url: 'https://example.com/small-group-china-tours',
      title: 'Small Group China Tours',
      page_type: 'service',
      topics: ['small group', 'china tours'],
      primary_keyword: 'small group china tours',
      word_count: 300,
      has_geo_block: false,
    }
    const weakQueries: WeakAIQuery[] = [
      {
        id: 'q-small-group',
        question: 'Small group China tours versus large coach tours for New Zealand travellers',
        avg_rank: 5,
        weak_model_count: 3,
      },
    ]

    const result = await analyzeOpportunities(CLIENT_ID, [page], weakQueries, [])
    const upgrade = result.find(o => o.source_page_id === 'small-group')

    expect(upgrade).toBeDefined()
    expect(upgrade!.source_query_id).toBe('q-small-group')
    expect(upgrade!.scoring_context.ai_weak).toBe(true)
  })

  // Max 50 opportunities returned
  it('returns at most 50 opportunities', async () => {
    // Create 60 pages all needing upgrade
    const pages: ClientSitePageSummary[] = Array.from({ length: 60 }, (_, i) => ({
      id: `page-${i}`,
      url: `https://example.com/page-${i}`,
      title: `Page ${i}`,
      page_type: 'blog',
      topics: [`topic${i}`],
      primary_keyword: `keyword${i}`,
      word_count: 100,
      has_geo_block: false,
    }))

    const result = await analyzeOpportunities(CLIENT_ID, pages, [], [])
    expect(result.length).toBeLessThanOrEqual(50)
  })

  // proposed_title format for upgrade
  it('sets proposed_title with "Upgrade: " prefix for upgrade_page opportunities', async () => {
    const pages: ClientSitePageSummary[] = [WEAK_PAGE]
    const result = await analyzeOpportunities(CLIENT_ID, pages, [], [])
    const upgrade = result.find(o => o.action_type === 'upgrade_page')
    expect(upgrade!.proposed_title).toMatch(/^Upgrade:/)
  })

  // proposed_title format for new_blog
  it('sets proposed_title with "New: " prefix for new_blog opportunities', async () => {
    const pages: ClientSitePageSummary[] = []
    const result = await analyzeOpportunities(CLIENT_ID, pages, [UNRELATED_QUERY], [])
    const newBlog = result.find(o => o.source_query_id === 'query-2')
    expect(newBlog!.proposed_title).toMatch(/^New:/)
  })
})
