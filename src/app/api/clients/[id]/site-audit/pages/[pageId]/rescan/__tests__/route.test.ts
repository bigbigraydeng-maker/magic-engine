/**
 * Test suite for POST /api/clients/[id]/site-audit/pages/[pageId]/rescan
 *
 * Tests the rescan endpoint that:
 * - Fetches the page record from client_site_pages
 * - Re-crawls the URL via Jina Reader
 * - Re-classifies the page type
 * - Re-detects GEO block
 * - Updates the DB record
 * - Returns the updated page
 *
 * Reference: ROADMAP.md P8.0.8-Phase1 Step 4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
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

vi.mock('@/lib/site-audit/crawler', () => ({
  crawlPages: vi.fn(),
}))

vi.mock('@/lib/site-audit/classifier', () => ({
  classifyPage: vi.fn(),
}))

vi.mock('@/lib/site-audit/geo-detector', () => ({
  detectGEOBlock: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildChain(response: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'order', 'range', 'limit', 'single', 'update']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  ;(chain as Record<string, unknown>)['then'] = (
    resolve: (v: unknown) => unknown
  ) => Promise.resolve(response).then(resolve)
  return chain
}

async function getRoute() {
  const mod = await import('../route')
  return mod
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/clients/[id]/site-audit/pages/[pageId]/rescan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  const existingPage = {
    id: 'page-1',
    client_id: 'client-1',
    url: 'https://example.com/blog/post',
    title: 'Old Title',
    page_type: 'other',
    topics: [],
    primary_keyword: null,
    word_count: 0,
    has_geo_block: false,
    status_code: 200,
    crawled_at: '2026-05-01T00:00:00Z',
    markdown_content: 'Old content',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  }

  const updatedPage = {
    ...existingPage,
    title: 'New Title',
    page_type: 'blog',
    topics: ['seo', 'content'],
    primary_keyword: 'seo tips',
    word_count: 1500,
    has_geo_block: true,
    status_code: 200,
    crawled_at: '2026-05-06T10:00:00Z',
    updated_at: '2026-05-06T10:00:00Z',
  }

  it('returns 200 with updated page after successful rescan', async () => {
    const { crawlPages } = await import('@/lib/site-audit/crawler')
    const { classifyPage } = await import('@/lib/site-audit/classifier')
    const { detectGEOBlock } = await import('@/lib/site-audit/geo-detector')

    vi.mocked(crawlPages).mockResolvedValue([{
      url: existingPage.url,
      markdown: '# New Title\n\nSEO tips content.',
      title: 'New Title',
      statusCode: 200,
      crawledAt: new Date('2026-05-06T10:00:00Z'),
    }])

    vi.mocked(classifyPage).mockResolvedValue({
      page_type: 'blog',
      topics: ['seo', 'content'],
      primary_keyword: 'seo tips',
      confidence: 0.92,
    })

    vi.mocked(detectGEOBlock).mockReturnValue({
      has_geo_block: true,
      detection_method: 'aria-hidden attribute',
      confidence: 0.95,
    })

    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom

    // Client lookup
    mockFrom.mockReturnValueOnce(
      buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
    )
    // Page lookup
    mockFrom.mockReturnValueOnce(
      buildChain({ data: existingPage, error: null })
    )
    // Page update
    mockFrom.mockReturnValueOnce(
      buildChain({ data: updatedPage, error: null })
    )

    const { POST } = await getRoute()
    const req = new NextRequest(
      'http://localhost/api/clients/client-1/site-audit/pages/page-1/rescan',
      { method: 'POST' }
    )
    const res = await POST(req, { params: { id: 'client-1', pageId: 'page-1' } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('id')
    expect(body.title).toBe('New Title')
    expect(body.page_type).toBe('blog')
    expect(body.has_geo_block).toBe(true)
  })

  it('returns 404 when page does not exist', async () => {
    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom

    // Client lookup
    mockFrom.mockReturnValueOnce(
      buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
    )
    // Page lookup returns not found
    mockFrom.mockReturnValueOnce(
      buildChain({ data: null, error: { code: 'PGRST116', message: 'No rows found' } })
    )

    const { POST } = await getRoute()
    const req = new NextRequest(
      'http://localhost/api/clients/client-1/site-audit/pages/nonexistent/rescan',
      { method: 'POST' }
    )
    const res = await POST(req, { params: { id: 'client-1', pageId: 'nonexistent' } })
    expect(res.status).toBe(404)
  })

  it('returns 404 when client does not exist', async () => {
    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom

    mockFrom.mockReturnValueOnce(
      buildChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    )

    const { POST } = await getRoute()
    const req = new NextRequest(
      'http://localhost/api/clients/bad-client/site-audit/pages/page-1/rescan',
      { method: 'POST' }
    )
    const res = await POST(req, { params: { id: 'bad-client', pageId: 'page-1' } })
    expect(res.status).toBe(404)
  })

  it('returns 500 when crawler fails', async () => {
    const { crawlPages } = await import('@/lib/site-audit/crawler')
    vi.mocked(crawlPages).mockRejectedValue(new Error('Jina Reader timeout'))

    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom

    // Client lookup
    mockFrom.mockReturnValueOnce(
      buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
    )
    // Page lookup
    mockFrom.mockReturnValueOnce(
      buildChain({ data: existingPage, error: null })
    )

    const { POST } = await getRoute()
    const req = new NextRequest(
      'http://localhost/api/clients/client-1/site-audit/pages/page-1/rescan',
      { method: 'POST' }
    )
    const res = await POST(req, { params: { id: 'client-1', pageId: 'page-1' } })
    expect(res.status).toBe(500)
  })

  it('returns 500 when DB update fails', async () => {
    const { crawlPages } = await import('@/lib/site-audit/crawler')
    const { classifyPage } = await import('@/lib/site-audit/classifier')
    const { detectGEOBlock } = await import('@/lib/site-audit/geo-detector')

    vi.mocked(crawlPages).mockResolvedValue([{
      url: existingPage.url,
      markdown: '# Title\n\nContent.',
      title: 'Title',
      statusCode: 200,
      crawledAt: new Date(),
    }])

    vi.mocked(classifyPage).mockResolvedValue({
      page_type: 'blog',
      topics: [],
      primary_keyword: null,
      confidence: 0.8,
    })

    vi.mocked(detectGEOBlock).mockReturnValue({
      has_geo_block: false,
      detection_method: null,
      confidence: 0,
    })

    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom

    // Client lookup
    mockFrom.mockReturnValueOnce(
      buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
    )
    // Page lookup
    mockFrom.mockReturnValueOnce(
      buildChain({ data: existingPage, error: null })
    )
    // DB update fails
    mockFrom.mockReturnValueOnce(
      buildChain({ data: null, error: { message: 'DB update failed' } })
    )

    const { POST } = await getRoute()
    const req = new NextRequest(
      'http://localhost/api/clients/client-1/site-audit/pages/page-1/rescan',
      { method: 'POST' }
    )
    const res = await POST(req, { params: { id: 'client-1', pageId: 'page-1' } })
    expect(res.status).toBe(500)
  })
})
