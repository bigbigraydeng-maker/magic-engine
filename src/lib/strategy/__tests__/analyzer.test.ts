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

// ---------------------------------------------------------------------------
// Per-table Supabase fake for fetchKeywordOpportunities.
//
// 🔴 Deliberately NOT the call-order chain above. The bug this function had —
//    querying a `keywords` table archived on 2026-05-30 — survived two months
//    precisely because a call-order fake answers happily no matter which table
//    you ask for. This one is keyed by table name and throws on anything it
//    does not model.
//
//    It also serves **real database column names** and applies `alias:source`
//    projection only when the select string asks for it. So if the aliases in
//    the implementation are dropped, volume/kd come back `undefined` and the
//    tests below go red — which is the whole point.
// ---------------------------------------------------------------------------

interface SnapshotRow {
  client_id: string
  keyword: string
  search_volume: number | null
  keyword_difficulty: number | null
  intent: string
  location_code: number
  snapshot_date: string
}

interface QueryState {
  columns: string
  eqs: Array<[string, unknown]>
  gts: Array<[string, number]>
  lts: Array<[string, number]>
  // Recorded, not ignored: a fake that swallows .order() arguments cannot tell
  // "newest snapshot" from "oldest snapshot", which is the exact silent-zero
  // failure this whole change exists to kill.
  orderBy: { column: string; ascending: boolean } | null
}

function projectRow(row: SnapshotRow, columns: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const part of columns.split(',').map((s) => s.trim())) {
    const [alias, source] = part.includes(':')
      ? (part.split(':').map((s) => s.trim()) as [string, string])
      : [part, part]
    out[alias] = (row as unknown as Record<string, unknown>)[source]
  }
  return out
}

function matches(row: SnapshotRow, state: QueryState): boolean {
  const value = (col: string) => (row as unknown as Record<string, unknown>)[col]
  return (
    state.eqs.every(([c, v]) => value(c) === v) &&
    // SQL semantics: a comparison against NULL is never true.
    state.gts.every(([c, v]) => typeof value(c) === 'number' && (value(c) as number) > v) &&
    state.lts.every(([c, v]) => typeof value(c) === 'number' && (value(c) as number) < v)
  )
}

function fakeKeywordSupabase(opts: {
  semrushDb?: string | null
  rows?: SnapshotRow[]
  rowsError?: { message: string } | null
  clientMissing?: boolean
  clientError?: { message: string } | null
}) {
  const rows = opts.rows ?? []

  return (table: string) => {
    if (table === 'clients') {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.eq = self
      chain.maybeSingle = () =>
        Promise.resolve(
          opts.clientError
            ? { data: null, error: opts.clientError }
            : { data: opts.clientMissing ? null : { semrush_db: opts.semrushDb ?? 'au' }, error: null },
        )
      return chain
    }

    if (table === 'keyword_snapshots') {
      const state: QueryState = { columns: '', eqs: [], gts: [], lts: [], orderBy: null }
      const chain: Record<string, unknown> = {}
      chain.select = (cols: string) => {
        state.columns = cols
        return chain
      }
      chain.eq = (col: string, val: unknown) => {
        state.eqs.push([col, val])
        return chain
      }
      chain.gt = (col: string, val: number) => {
        state.gts.push([col, val])
        return chain
      }
      chain.lt = (col: string, val: number) => {
        state.lts.push([col, val])
        return chain
      }
      chain.order = (column: string, opts?: { ascending?: boolean }) => {
        state.orderBy = { column, ascending: opts?.ascending !== false }
        return chain
      }
      chain.limit = () => chain

      // The date probe ends in .maybeSingle(); the row read is awaited.
      chain.maybeSingle = () => {
        const hits = rows.filter((r) => matches(r, state))
        if (state.orderBy) {
          const { column, ascending } = state.orderBy
          const key = (r: SnapshotRow) => String((r as unknown as Record<string, unknown>)[column] ?? '')
          hits.sort((a, b) => (ascending ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))))
        }
        return Promise.resolve({
          data: hits.length > 0 ? projectRow(hits[0], state.columns) : null,
          error: null,
        })
      }
      chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
        const result = opts.rowsError
          ? { data: null, error: opts.rowsError }
          : { data: rows.filter((r) => matches(r, state)).map((r) => projectRow(r, state.columns)), error: null }
        resolve(result)
        return Promise.resolve(result)
      }
      return chain
    }

    throw new Error(`fake supabase: table '${table}' is not modelled`)
  }
}

function snapshot(over: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    client_id: CLIENT_ID,
    keyword: 'china tours nz',
    search_volume: 200,
    keyword_difficulty: 30,
    intent: 'commercial',
    location_code: 2036,
    snapshot_date: '2026-08-03',
    ...over,
  }
}

describe('fetchKeywordOpportunities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('🔴 假件本身的护栏：问一张没建模的表要直接炸，不许静默兜底', () => {
    const from = fakeKeywordSupabase({})
    expect(() => from('keywords')).toThrow(/not modelled/)
  })

  it('reads keyword_snapshots, never the archived keywords table', async () => {
    mockFrom.mockImplementation(
      fakeKeywordSupabase({ rows: [snapshot()] }) as unknown as typeof mockFrom,
    )
    await fetchKeywordOpportunities(CLIENT_ID)
    expect(mockFrom).toHaveBeenCalledWith('keyword_snapshots')
    expect(mockFrom).not.toHaveBeenCalledWith('keywords')
  })

  it('🔴 列名必须起别名 —— 少一个别名，volume/kd 就是 undefined 而不是数字', async () => {
    mockFrom.mockImplementation(
      fakeKeywordSupabase({ rows: [snapshot({ search_volume: 200, keyword_difficulty: 30 })] }) as unknown as typeof mockFrom,
    )
    const result = await fetchKeywordOpportunities(CLIENT_ID)
    expect(result).toHaveLength(1)
    expect(result[0].keyword).toBe('china tours nz')
    expect(result[0].volume).toBe(200)
    expect(result[0].kd).toBe(30)
  })

  it('🔴 只取最新一期 —— 这是时序表，不限日期会把整年历史都拉回来', async () => {
    mockFrom.mockImplementation(
      fakeKeywordSupabase({
        rows: [
          snapshot({ keyword: 'this week', snapshot_date: '2026-08-03' }),
          snapshot({ keyword: 'last week', snapshot_date: '2026-07-27' }),
        ],
      }) as unknown as typeof mockFrom,
    )
    const result = await fetchKeywordOpportunities(CLIENT_ID)
    expect(result.map((r) => r.keyword)).toEqual(['this week'])
  })

  it('🔴 难度未知（null）不算机会 —— 「不知道」不能当成「容易」', async () => {
    mockFrom.mockImplementation(
      fakeKeywordSupabase({ rows: [snapshot({ keyword_difficulty: null })] }) as unknown as typeof mockFrom,
    )
    expect(await fetchKeywordOpportunities(CLIENT_ID)).toEqual([])
  })

  it('filters out low volume and high difficulty', async () => {
    mockFrom.mockImplementation(
      fakeKeywordSupabase({
        rows: [
          snapshot({ keyword: 'too small', search_volume: 20 }),
          snapshot({ keyword: 'too hard', keyword_difficulty: 80 }),
          snapshot({ keyword: 'just right' }),
        ],
      }) as unknown as typeof mockFrom,
    )
    const result = await fetchKeywordOpportunities(CLIENT_ID)
    expect(result.map((r) => r.keyword)).toEqual(['just right'])
  })

  it('scopes to the client market — an NZ client does not pick up AU rows', async () => {
    mockFrom.mockImplementation(
      fakeKeywordSupabase({
        semrushDb: 'nz',
        rows: [
          snapshot({ keyword: 'au row', location_code: 2036 }),
          snapshot({ keyword: 'nz row', location_code: 2554 }),
        ],
      }) as unknown as typeof mockFrom,
    )
    const result = await fetchKeywordOpportunities(CLIENT_ID)
    expect(result.map((r) => r.keyword)).toEqual(['nz row'])
  })

  it('🔴 别的客户的词绝不许混进来 —— 这是跨客户串数据那根线', async () => {
    mockFrom.mockImplementation(
      fakeKeywordSupabase({
        rows: [
          snapshot({ keyword: 'mine' }),
          snapshot({ keyword: 'someone elses', client_id: 'another-client' }),
        ],
      }) as unknown as typeof mockFrom,
    )
    const result = await fetchKeywordOpportunities(CLIENT_ID)
    expect(result.map((r) => r.keyword)).toEqual(['mine'])
  })

  // 空数组有两种来路：**主动放弃**，和**炸了被 catch 吞掉**。
  // 只断言 `[]` 两者都过 —— 这正是原 bug 活两个月的机制。所以这里断言它
  // 说出了原因：守卫被拿掉时不会有这句话，测试就红。
  it('🔴 客户读不出来时主动放弃并说明原因，绝不擅自当成 AU', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockFrom.mockImplementation(
        fakeKeywordSupabase({
          clientMissing: true,
          rows: [snapshot({ location_code: 2036 })],
        }) as unknown as typeof mockFrom,
      )
      expect(await fetchKeywordOpportunities(CLIENT_ID)).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(CLIENT_ID), undefined)

      warn.mockClear()
      mockFrom.mockImplementation(
        fakeKeywordSupabase({
          clientError: { message: 'boom' },
          rows: [snapshot({ location_code: 2036 })],
        }) as unknown as typeof mockFrom,
      )
      expect(await fetchKeywordOpportunities(CLIENT_ID)).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(CLIENT_ID), 'boom')
    } finally {
      warn.mockRestore()
    }
  })

  it('returns empty array when the client has no snapshots at all', async () => {
    mockFrom.mockImplementation(fakeKeywordSupabase({ rows: [] }) as unknown as typeof mockFrom)
    expect(await fetchKeywordOpportunities(CLIENT_ID)).toEqual([])
  })

  it('returns empty array on DB error', async () => {
    mockFrom.mockImplementation(
      fakeKeywordSupabase({
        rows: [snapshot()],
        rowsError: { message: 'DB error' },
      }) as unknown as typeof mockFrom,
    )
    expect(await fetchKeywordOpportunities(CLIENT_ID)).toEqual([])
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
