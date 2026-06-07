/**
 * Test suite for GET /api/clients/[id]/site-audit/pages
 *
 * Tests client validation, page filtering, pagination, multi-tenant isolation.
 * Updated for the corrected implementation (queries client_site_pages directly).
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
// Helper — builds a chainable mock that resolves to `response` on await
// ---------------------------------------------------------------------------

function buildChain(response: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = [
    'select', 'eq', 'neq', 'gte', 'lte', 'lt', 'gt',
    'order', 'range', 'overlaps', 'limit', 'single',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  ;(chain as Record<string, unknown>)['then'] = (
    resolve: (v: unknown) => unknown
  ) => Promise.resolve(response).then(resolve)
  return chain
}

describe('GET /api/clients/[id]/site-audit/pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // Client Validation Tests
  // =========================================================================

  describe('Client validation', () => {
    it('should return 404 when client does not exist', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(
        buildChain({ data: null, error: { code: 'PGRST116', message: 'No rows found' } })
      )

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Client not found')
    })

    it('should return 404 when client has no domain configured', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(
        buildChain({ data: { id: 'client-1', domain: null }, error: null })
      )

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Client has no domain configured')
    })
  })

  // =========================================================================
  // Pagination Tests
  // =========================================================================

  describe('Pagination', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }

    it('should return paginated results with default limit=50, offset=0', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      // Pages query
      mockFrom.mockReturnValueOnce(
        buildChain({
          data: [{ id: 'page-1', url: 'https://example.com/blog1' }],
          count: 1,
          error: null,
        })
      )

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pages).toHaveLength(1)
      expect(data.limit).toBe(50)
      expect(data.offset).toBe(0)
    })

    it('should clamp limit to 500 when value exceeds 500', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      // Pages query (called after client lookup, clamped limit)
      mockFrom.mockReturnValueOnce(
        buildChain({ data: [], count: 0, error: null })
      )

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages?limit=600'
      )
      const response = await GET(request, { params: { id: 'client-1' } })

      // Clamped to 500, not rejected
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.limit).toBe(500)
    })

    it('should return 400 when offset is negative', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages?offset=-5'
      )
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('offset must be >= 0')
    })

    it('should return 400 when limit is not a positive integer', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages?limit=abc'
      )
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('limit must be')
    })
  })

  // =========================================================================
  // Filtering Tests
  // =========================================================================

  describe('Page type filtering', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }

    it('should return 400 for invalid page_type', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages?pageType=invalid'
      )
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('pageType must be one of')
    })
  })

  // =========================================================================
  // Error Handling Tests
  // =========================================================================

  describe('Error handling', () => {
    it('should return 500 on database query error', async () => {
      const mockClient = { id: 'client-1', domain: 'example.com' }

      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup succeeds
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      // Pages query fails
      mockFrom.mockReturnValueOnce(
        buildChain({ data: null, count: null, error: { message: 'Database connection failed' } })
      )

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBeDefined()
    })

    it('should return 500 on unexpected error', async () => {
      const mockFrom = vi.fn().mockImplementation(() => {
        throw new Error('Unexpected error')
      })
      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Unexpected error')
    })
  })

  // =========================================================================
  // Response Format Tests
  // =========================================================================

  describe('Response format', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }

    it('should return correct response structure', async () => {
      const mockPage = {
        id: 'page-1',
        url: 'https://example.com/blog1',
        title: 'Blog Post',
        page_type: 'blog',
        topics: ['topic-a'],
        primary_keyword: 'test',
        word_count: 500,
        has_geo_block: true,
        status_code: 200,
        crawled_at: '2026-05-05T00:00:00Z',
        created_at: '2026-05-05T00:00:00Z',
        updated_at: '2026-05-05T00:00:00Z',
      }

      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      mockFrom.mockReturnValueOnce(
        buildChain({ data: [mockPage], count: 1, error: null })
      )

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()

      // New response format (no hasMore, includes sort/order)
      expect(data).toHaveProperty('pages')
      expect(data).toHaveProperty('total')
      expect(data).toHaveProperty('limit')
      expect(data).toHaveProperty('offset')
      expect(data).toHaveProperty('sort')
      expect(data).toHaveProperty('order')
      expect(Array.isArray(data.pages)).toBe(true)
      expect(typeof data.total).toBe('number')
      expect(typeof data.limit).toBe('number')
      expect(typeof data.offset).toBe('number')
    })

    it('should return empty pages array when no results', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      mockFrom.mockReturnValueOnce(
        buildChain({ data: [], count: 0, error: null })
      )

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pages).toEqual([])
      expect(data.total).toBe(0)
    })
  })
})
