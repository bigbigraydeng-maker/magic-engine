/**
 * Test suite v2 for GET /api/clients/[id]/site-audit/pages
 *
 * Tests the CORRECTED implementation that:
 * - Queries client_site_pages directly (not the defunct site_audit_pages table)
 * - Returns all required fields: title, word_count, primary_keyword, crawled_at, status_code
 * - Supports sort/order parameters
 * - Supports statusCode range filter (2xx, 4xx, 5xx)
 * - Enforces multi-tenant isolation via client_id
 * - Returns extended pagination envelope: { pages, total, limit, offset, sort, order }
 *
 * Reference: ROADMAP.md P8.0.8-Phase1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { supabaseAdmin } from '@/lib/supabase'

// Phase X.S2: paid-tier auth bypass — these route tests target the business
// logic, not the auth path. Real wiring is covered in
// src/lib/auth/__tests__/client-access.test.ts.
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'test@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
  requirePaidClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'test@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
}))


// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Full page record as returned by the corrected API */
const makeFullPage = (overrides: Record<string, unknown> = {}) => ({
  id: 'page-uuid-1',
  url: 'https://example.com/blog/post',
  title: 'Test Blog Post',
  page_type: 'blog',
  topics: ['topic-a', 'topic-b'],
  primary_keyword: 'test keyword',
  word_count: 1500,
  has_geo_block: true,
  status_code: 200,
  crawled_at: '2026-05-05T10:30:00Z',
  created_at: '2026-05-05T10:30:00Z',
  updated_at: '2026-05-05T10:30:00Z',
  ...overrides,
})

/**
 * Build a Supabase query mock chain that resolves to `response`
 * Supports chaining: .from().select().eq().order().range() or .gte().lt()...
 */
function buildQueryChain(response: unknown) {
  // Build an infinitely chainable mock that resolves on await
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'lt', 'gt', 'order', 'range', 'overlaps', 'limit', 'single', 'maybeSingle']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Override .then so await chain returns the response
  ;(chain as Record<string, unknown>)['then'] = (
    resolve: (v: unknown) => unknown,
    _reject: unknown
  ) => Promise.resolve(response).then(resolve)
  return chain
}

function setupClientMock(clientData: unknown) {
  const mockFrom = vi.fn()
  vi.mocked(supabaseAdmin).from = mockFrom

  // Client lookup chain
  const clientChain = buildQueryChain({ data: clientData, error: null })
  mockFrom.mockReturnValueOnce(clientChain)

  return { mockFrom, clientChain }
}

function setupFullFlow(
  clientData: unknown,
  pagesData: unknown[],
  totalCount: number
) {
  const mockFrom = vi.fn()
  vi.mocked(supabaseAdmin).from = mockFrom

  // Client lookup
  const clientChain = buildQueryChain({ data: clientData, error: null })
  mockFrom.mockReturnValueOnce(clientChain)

  // Pages query (with count)
  const pagesChain = buildQueryChain({ data: pagesData, count: totalCount, error: null })
  mockFrom.mockReturnValueOnce(pagesChain)

  return { mockFrom }
}

// ---------------------------------------------------------------------------
// Suite A: Required fields in response
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/site-audit/pages (v2 — corrected implementation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Suite A: Required fields', () => {
    it('returns pages with all 12 required columns', async () => {
      const mockClient = { id: 'client-1', domain: 'example.com' }
      const fullPage = makeFullPage()
      setupFullFlow(mockClient, [fullPage], 1)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('pages')
      expect(body.pages).toHaveLength(1)

      const page = body.pages[0]
      // All 12 required fields must be present
      expect(page).toHaveProperty('id')
      expect(page).toHaveProperty('url')
      expect(page).toHaveProperty('title')
      expect(page).toHaveProperty('page_type')
      expect(page).toHaveProperty('topics')
      expect(page).toHaveProperty('primary_keyword')
      expect(page).toHaveProperty('word_count')
      expect(page).toHaveProperty('has_geo_block')
      expect(page).toHaveProperty('status_code')
      expect(page).toHaveProperty('crawled_at')
      expect(page).toHaveProperty('created_at')
      expect(page).toHaveProperty('updated_at')
    })

    it('returns correct field types', async () => {
      const mockClient = { id: 'client-1', domain: 'example.com' }
      const fullPage = makeFullPage()
      setupFullFlow(mockClient, [fullPage], 1)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()
      const page = body.pages[0]

      expect(typeof page.id).toBe('string')
      expect(typeof page.url).toBe('string')
      expect(typeof page.word_count).toBe('number')
      expect(typeof page.has_geo_block).toBe('boolean')
      expect(typeof page.status_code).toBe('number')
      expect(Array.isArray(page.topics)).toBe(true)
    })

    it('returns extended pagination envelope with sort and order', async () => {
      const mockClient = { id: 'client-1', domain: 'example.com' }
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages?sort=word_count&order=desc')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()

      // Must return the new envelope (not the old hasMore structure)
      expect(body).toHaveProperty('pages')
      expect(body).toHaveProperty('total')
      expect(body).toHaveProperty('limit')
      expect(body).toHaveProperty('offset')
      expect(body).toHaveProperty('sort')
      expect(body).toHaveProperty('order')
      expect(body.sort).toBe('word_count')
      expect(body.order).toBe('desc')
    })
  })

  // ---------------------------------------------------------------------------
  // Suite B: Filters
  // ---------------------------------------------------------------------------

  describe('Suite B: Filters', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }

    it('accepts pageType=service filter (extended page types)', async () => {
      setupFullFlow(mockClient, [], 0)

      // The old implementation only accepted blog|landing|product
      // New implementation must accept all 7 types
      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?pageType=service'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('accepts pageType=about filter', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?pageType=about'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('accepts pageType=contact filter', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?pageType=contact'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('accepts pageType=other filter', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?pageType=other'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('rejects unknown pageType with 400', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?pageType=invalid_type'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(400)
    })

    it('accepts statusCode=2xx filter', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?statusCode=2xx'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('accepts statusCode=4xx filter', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?statusCode=4xx'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('accepts statusCode=5xx filter', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?statusCode=5xx'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('accepts hasGeoBlock=true filter', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?hasGeoBlock=true'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('accepts hasGeoBlock=false filter', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?hasGeoBlock=false'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })
  })

  // ---------------------------------------------------------------------------
  // Suite C: Sorting
  // ---------------------------------------------------------------------------

  describe('Suite C: Sorting', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }

    it('accepts sort=url&order=asc', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?sort=url&order=asc'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.sort).toBe('url')
      expect(body.order).toBe('asc')
    })

    it('accepts sort=word_count&order=desc', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?sort=word_count&order=desc'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('accepts sort=crawled_at (default)', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?sort=crawled_at'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('accepts sort=has_geo_block', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?sort=has_geo_block'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
    })

    it('rejects invalid sort column with 400', async () => {
      // Do NOT call setupFullFlow here — the route should return 400 before any DB call
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValue(buildQueryChain({ data: { id: 'client-1', domain: 'example.com' }, error: null }))

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?sort=malicious_column'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/invalid sort/i)
    })

    it('rejects invalid order value with 400', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValue(buildQueryChain({ data: { id: 'client-1', domain: 'example.com' }, error: null }))

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?order=sideways'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/invalid order/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Suite D: Pagination envelope
  // ---------------------------------------------------------------------------

  describe('Suite D: Pagination envelope', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }

    it('default limit is 50 (not 10)', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()

      // New default is 50, not the old default of 10
      expect(body.limit).toBe(50)
    })

    it('max limit is 500', async () => {
      setupFullFlow(mockClient, [], 0)

      // Requesting more than 500 should be clamped to 500
      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages?limit=600')
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.limit).toBeLessThanOrEqual(500)
    })

    it('includes offset in response', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages?offset=20')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()
      expect(body.offset).toBe(20)
    })
  })

  // ---------------------------------------------------------------------------
  // Suite E: Direct client_id scoping (no job_id intermediary)
  // ---------------------------------------------------------------------------

  describe('Suite E: Direct client_id scoping (no job lookup)', () => {
    it('does NOT require a site_audit_jobs lookup to return pages', async () => {
      // The corrected implementation queries client_site_pages directly
      // by client_id — it must NOT make a preliminary site_audit_jobs lookup
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup
      mockFrom.mockReturnValueOnce(
        buildQueryChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
      )
      // Pages query
      mockFrom.mockReturnValueOnce(
        buildQueryChain({ data: [makeFullPage()], count: 1, error: null })
      )
      // site_audit_jobs lookup (should NOT be called)
      const jobLookup = vi.fn()
      mockFrom.mockReturnValue({ select: jobLookup })

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })

      expect(res.status).toBe(200)
      // The third call should never happen — from() should be called exactly twice
      // (clients table + client_site_pages table)
      expect(jobLookup).not.toHaveBeenCalled()
    })

    it('returns 200 with empty pages when client has no crawled pages (no job needed)', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup
      mockFrom.mockReturnValueOnce(
        buildQueryChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
      )
      // Pages query returns empty
      mockFrom.mockReturnValueOnce(
        buildQueryChain({ data: [], count: 0, error: null })
      )

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.pages).toEqual([])
      expect(body.total).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Suite F: Index status (收录状态) — derived fields + not-indexed filter
  // ---------------------------------------------------------------------------

  describe('Suite F: Index status', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }

    it('未收录页面：not_indexed=true + index_class=thin，并原样带回 index_verdict/first_not_indexed_at', async () => {
      const thin = makeFullPage({
        word_count: 120,
        index_verdict: 'Crawled - currently not indexed',
        first_not_indexed_at: '2026-08-01T00:00:00Z',
        crawl_status: 'crawled',
        crawled_at: new Date().toISOString(),
      })
      setupFullFlow(mockClient, [thin], 1)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()
      const page = body.pages[0]
      expect(page.not_indexed).toBe(true)
      expect(page.index_class).toBe('thin')
      expect(page.first_not_indexed_at).toBe('2026-08-01T00:00:00Z')
      expect(page.index_verdict).toBe('Crawled - currently not indexed')
    })

    it('谷歌不认识的网址 → index_class=unknown（优先于字数判定）', async () => {
      const unknown = makeFullPage({
        word_count: 50,
        index_verdict: 'URL is unknown to Google',
        first_not_indexed_at: '2026-08-01T00:00:00Z',
      })
      setupFullFlow(mockClient, [unknown], 1)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()
      expect(body.pages[0].index_class).toBe('unknown')
    })

    it('已收录页面 → not_indexed=false, index_class=null', async () => {
      const indexed = makeFullPage({
        index_verdict: 'Submitted and indexed',
        first_not_indexed_at: null,
      })
      setupFullFlow(mockClient, [indexed], 1)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()
      expect(body.pages[0].not_indexed).toBe(false)
      expect(body.pages[0].index_class).toBeNull()
    })

    it('indexStatus=not-indexed → 对 first_not_indexed_at 施加 not-null 过滤（真的接上了，不只是接受参数）', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(buildQueryChain({ data: mockClient, error: null }))
      const pagesChain = buildQueryChain({ data: [], count: 0, error: null }) as Record<string, ReturnType<typeof vi.fn>>
      mockFrom.mockReturnValueOnce(pagesChain)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?indexStatus=not-indexed'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
      expect(pagesChain.not).toHaveBeenCalledWith('first_not_indexed_at', 'is', null)
    })

    it('不带 indexStatus 时不施加 not-null 过滤（默认看全部）', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(buildQueryChain({ data: mockClient, error: null }))
      const pagesChain = buildQueryChain({ data: [], count: 0, error: null }) as Record<string, ReturnType<typeof vi.fn>>
      mockFrom.mockReturnValueOnce(pagesChain)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      await GET(req, { params: { id: 'client-1' } })
      expect(pagesChain.not).not.toHaveBeenCalled()
    })

    it('accepts sort=first_not_indexed_at (oldest-first triage order)', async () => {
      setupFullFlow(mockClient, [], 0)

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages?sort=first_not_indexed_at&order=asc'
      )
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.sort).toBe('first_not_indexed_at')
    })

    it('🔴 被防火墙挡住的行不判 thin → index_class=crawled', async () => {
      const blocked = makeFullPage({
        word_count: 59,
        index_verdict: 'Crawled - currently not indexed',
        first_not_indexed_at: '2026-08-01T00:00:00Z',
        crawl_status: 'antibot_challenged',
        crawled_at: new Date().toISOString(),
      })
      setupFullFlow(mockClient, [blocked], 1)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()
      expect(body.pages[0].index_class).toBe('crawled')
    })

    it('谷歌还没爬（Discovered）→ index_class=discovered，不是 thin', async () => {
      const discovered = makeFullPage({
        word_count: 59,
        index_verdict: 'Discovered - currently not indexed',
        first_not_indexed_at: '2026-08-01T00:00:00Z',
        crawl_status: 'crawled',
        crawled_at: new Date().toISOString(),
      })
      setupFullFlow(mockClient, [discovered], 1)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()
      expect(body.pages[0].index_class).toBe('discovered')
    })

    it('跳转页 → index_class=not_a_problem', async () => {
      const redirect = makeFullPage({
        index_verdict: 'Page with redirect',
        first_not_indexed_at: '2026-08-01T00:00:00Z',
        crawl_status: 'crawled',
        crawled_at: new Date().toISOString(),
      })
      setupFullFlow(mockClient, [redirect], 1)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })
      const body = await res.json()
      expect(body.pages[0].index_class).toBe('not_a_problem')
    })

    it('🔴 取数必须带上 crawl_status（漏列时 thin 会悄悄消失）', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(buildQueryChain({ data: mockClient, error: null }))
      const pagesChain = buildQueryChain({ data: [], count: 0, error: null }) as Record<string, ReturnType<typeof vi.fn>>
      mockFrom.mockReturnValueOnce(pagesChain)

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      await GET(req, { params: { id: 'client-1' } })
      expect(String(pagesChain.select.mock.calls[0][0])).toContain('crawl_status')
      expect(String(pagesChain.select.mock.calls[0][0])).toContain('crawled_at')
    })
  })

  // ---------------------------------------------------------------------------
  // Existing Suite: Client validation (must still pass)
  // ---------------------------------------------------------------------------

  describe('Client validation (backward compat)', () => {
    it('returns 404 when client does not exist', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(
        buildQueryChain({ data: null, error: { code: 'PGRST116', message: 'No rows found' } })
      )

      const req = new NextRequest('http://localhost/api/clients/client-x/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-x' } })
      expect(res.status).toBe(404)
    })

    it('returns 404 when client has no domain', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(
        buildQueryChain({ data: { id: 'client-1', domain: null }, error: null })
      )

      const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages')
      const res = await GET(req, { params: { id: 'client-1' } })
      expect(res.status).toBe(404)
    })
  })
})
