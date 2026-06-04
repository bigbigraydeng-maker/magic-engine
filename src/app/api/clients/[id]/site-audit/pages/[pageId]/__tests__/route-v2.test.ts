/**
 * Test suite v2 for GET /api/clients/[id]/site-audit/pages/[pageId]
 *
 * Tests the CORRECTED implementation that:
 * - Queries client_site_pages directly (not site_audit_pages)
 * - Performs multi-tenant isolation via client_id directly (no job_id join)
 * - Returns 404 for pages belonging to a different client
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


vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildChain(response: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'neq', 'gte', 'lte', 'lt', 'gt', 'order', 'range', 'limit', 'single', 'maybeSingle']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  ;(chain as Record<string, unknown>)['then'] = (
    resolve: (v: unknown) => unknown
  ) => Promise.resolve(response).then(resolve)
  return chain
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/site-audit/pages/[pageId] (v2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Direct client_id isolation', () => {
    it('returns page when client_id matches directly (no job_id lookup)', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup
      mockFrom.mockReturnValueOnce(
        buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
      )

      // Page lookup — new impl queries client_site_pages with .eq('client_id', clientId)
      // The page has client_id embedded, no need for job lookup
      const page = {
        id: 'page-1',
        client_id: 'client-1',
        url: 'https://example.com/blog',
        title: 'Blog Post',
        page_type: 'blog',
        topics: ['seo'],
        primary_keyword: 'seo tips',
        word_count: 800,
        has_geo_block: false,
        status_code: 200,
        crawled_at: '2026-05-05T10:00:00Z',
        markdown_content: '# Blog Post\n\nContent here.',
        created_at: '2026-05-05T10:00:00Z',
        updated_at: '2026-05-05T10:00:00Z',
      }

      mockFrom.mockReturnValueOnce(
        buildChain({ data: page, error: null })
      )

      // There should be NO third DB call (no site_audit_jobs lookup)
      const jobLookupSpy = vi.fn()
      mockFrom.mockReturnValue({ select: jobLookupSpy })

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages/page-1'
      )
      const res = await GET(req, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('page')
      expect(body.page.id).toBe('page-1')
      expect(body.page.title).toBe('Blog Post')

      // The corrected implementation MUST NOT make a site_audit_jobs lookup
      expect(jobLookupSpy).not.toHaveBeenCalled()
    })

    it('returns 404 when page not found in client_site_pages', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup succeeds
      mockFrom.mockReturnValueOnce(
        buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
      )
      // Page lookup returns not found
      mockFrom.mockReturnValueOnce(
        buildChain({ data: null, error: { code: 'PGRST116', message: 'No rows found' } })
      )

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages/nonexistent'
      )
      const res = await GET(req, { params: { id: 'client-1', pageId: 'nonexistent' } })
      expect(res.status).toBe(404)
    })

    it('returns 404 when querying a page from another client', async () => {
      // The new implementation queries with BOTH .eq('id', pageId) AND .eq('client_id', clientId)
      // so pages from other clients automatically return 404, no 403 needed
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      // Client lookup for client-1
      mockFrom.mockReturnValueOnce(
        buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
      )
      // Page lookup with client_id=client-1 returns null (page belongs to client-2)
      mockFrom.mockReturnValueOnce(
        buildChain({ data: null, error: { code: 'PGRST116', message: 'No rows found' } })
      )

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages/client2-page'
      )
      const res = await GET(req, { params: { id: 'client-1', pageId: 'client2-page' } })
      // Either 404 (preferred, no info leak) or 403 are both acceptable
      expect([403, 404]).toContain(res.status)
    })

    it('returns all fields including markdown_content', async () => {
      const mockFrom = vi.fn()
      vi.mocked(supabaseAdmin).from = mockFrom

      mockFrom.mockReturnValueOnce(
        buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
      )

      const fullPage = {
        id: 'page-1',
        client_id: 'client-1',
        url: 'https://example.com/page',
        title: 'Page Title',
        page_type: 'service',
        topics: ['nz-travel', 'tours'],
        primary_keyword: 'new zealand tours',
        word_count: 2000,
        has_geo_block: true,
        status_code: 200,
        crawled_at: '2026-05-05T10:00:00Z',
        markdown_content: '# Service Page\n\nFull markdown content here.',
        classification_confidence: 0.9,
        geo_detection_method: 'aria-hidden attribute',
        geo_confidence: 0.95,
        created_at: '2026-05-05T10:00:00Z',
        updated_at: '2026-05-05T10:00:00Z',
      }

      mockFrom.mockReturnValueOnce(buildChain({ data: fullPage, error: null }))

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages/page-1'
      )
      const res = await GET(req, { params: { id: 'client-1', pageId: 'page-1' } })
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.page.markdown_content).toBeDefined()
      expect(typeof body.page.markdown_content).toBe('string')
      expect(body.page.title).toBe('Page Title')
      expect(body.page.word_count).toBe(2000)
      expect(body.page.status_code).toBe(200)
    })
  })

  describe('Error handling', () => {
    it('returns 500 on unexpected DB error', async () => {
      const mockFrom = vi.fn().mockImplementation(() => {
        throw new Error('DB crash')
      })
      vi.mocked(supabaseAdmin).from = mockFrom

      const req = new NextRequest(
        'http://localhost/api/clients/client-1/site-audit/pages/page-1'
      )
      const res = await GET(req, { params: { id: 'client-1', pageId: 'page-1' } })
      expect(res.status).toBe(500)
    })
  })
})
