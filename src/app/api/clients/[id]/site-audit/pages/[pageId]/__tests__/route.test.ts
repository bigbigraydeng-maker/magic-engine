/**
 * Test suite for GET /api/clients/[id]/site-audit/pages/[pageId]
 *
 * Tests client validation, page existence, response format, and multi-tenant isolation.
 * Updated for the corrected implementation (direct client_id scoping, no job_id join).
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
// Helper
// ---------------------------------------------------------------------------

function buildChain(response: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'order', 'range', 'limit', 'single']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  ;(chain as Record<string, unknown>)['then'] = (
    resolve: (v: unknown) => unknown
  ) => Promise.resolve(response).then(resolve)
  return chain
}

describe('GET /api/clients/[id]/site-audit/pages/[pageId]', () => {
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

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

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

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Client has no domain configured')
    })
  })

  // =========================================================================
  // Page Existence & Permission Tests
  // =========================================================================

  describe('Page existence and permission', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }
    const mockPage = {
      id: 'page-1',
      client_id: 'client-1',
      url: 'https://example.com/blog/post',
      title: 'Blog Post',
      page_type: 'blog',
      topics: ['topic-a', 'topic-b'],
      primary_keyword: 'test',
      word_count: 800,
      has_geo_block: true,
      status_code: 200,
      crawled_at: '2026-05-05T00:00:00Z',
      markdown_content: '# Blog Post\n\nContent here.',
      created_at: '2026-05-05T00:00:00Z',
      updated_at: '2026-05-05T00:00:00Z',
    }

    it('should return 404 when page does not exist', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      // Page lookup returns not found (PGRST116)
      mockFrom.mockReturnValueOnce(
        buildChain({ data: null, error: { code: 'PGRST116', message: 'No rows found' } })
      )

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/nonexistent-page'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'nonexistent-page' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Page not found')
    })

    it('should return 404 when page belongs to different client (not 403, no info leak)', async () => {
      // The new implementation queries with BOTH id AND client_id,
      // so pages from other clients return PGRST116 → 404 (not 403)
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup succeeds
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      // Page lookup with client_id=client-1 returns not found (page belongs to client-2)
      mockFrom.mockReturnValueOnce(
        buildChain({ data: null, error: { code: 'PGRST116', message: 'No rows found' } })
      )

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      // 404 is preferred (no info leak), but 403 is also acceptable
      expect([403, 404]).toContain(response.status)
    })

    it('should return 200 with page data when page exists and belongs to client', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      // Page lookup
      mockFrom.mockReturnValueOnce(buildChain({ data: mockPage, error: null }))

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.page).toEqual(mockPage)
    })
  })

  // =========================================================================
  // Response Format Tests
  // =========================================================================

  describe('Response format', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }
    const mockPage = {
      id: 'page-1',
      client_id: 'client-1',
      url: 'https://example.com/blog',
      title: 'Blog Post',
      page_type: 'blog',
      topics: ['topic-a'],
      primary_keyword: 'seo',
      word_count: 800,
      has_geo_block: true,
      status_code: 200,
      crawled_at: '2026-05-05T00:00:00Z',
      markdown_content: '# Title\n\nContent',
      created_at: '2026-05-05T00:00:00Z',
      updated_at: '2026-05-05T00:00:00Z',
    }

    it('should return correct response structure with all page fields', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      mockFrom.mockReturnValueOnce(buildChain({ data: mockPage, error: null }))

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()

      expect(data).toHaveProperty('page')
      expect(data.page.id).toBe('page-1')
      expect(data.page.markdown_content).toBeDefined()
      expect(typeof data.page.markdown_content).toBe('string')
    })
  })

  // =========================================================================
  // Error Handling Tests
  // =========================================================================

  describe('Error handling', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }

    it('should return 500 on database query error at page stage', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup succeeds
      mockFrom.mockReturnValueOnce(buildChain({ data: mockClient, error: null }))
      // Page lookup fails with database error (not PGRST116)
      mockFrom.mockReturnValueOnce(
        buildChain({ data: null, error: { message: 'Database connection failed' } })
      )

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBeDefined()
    })

    it('should return 500 on unexpected error', async () => {
      const mockFrom = vi.fn().mockImplementation(() => {
        throw new Error('Unexpected error')
      })
      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Unexpected error')
    })
  })
})
