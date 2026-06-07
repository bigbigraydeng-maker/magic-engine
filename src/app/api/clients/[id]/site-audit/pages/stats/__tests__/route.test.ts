/**
 * Test suite for GET /api/clients/[id]/site-audit/pages/stats
 *
 * Tests the stats aggregation endpoint that returns:
 * - total page count
 * - breakdown by page_type
 * - GEO coverage (with/without block + percentage)
 * - breakdown by status code range (2xx, 3xx, 4xx, 5xx)
 * - average word count
 *
 * Reference: ROADMAP.md P8.0.8-Phase1 Step 5
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
    rpc: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
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

// Dynamic import of route after mocks
async function getRoute() {
  const mod = await import('../route')
  return mod
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/site-audit/pages/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns correct stats structure', async () => {
    const mockRpcData = [{
      total_count: 50,
      blog_count: 20,
      product_count: 10,
      service_count: 8,
      landing_count: 5,
      about_count: 3,
      contact_count: 2,
      other_count: 2,
      geo_yes: 15,
      geo_no: 35,
      ok_2xx: 45,
      redirect_3xx: 3,
      client_4xx: 1,
      server_5xx: 1,
      avg_word_count: 1250.5,
    }]

    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom

    // Client lookup
    mockFrom.mockReturnValueOnce(
      buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
    )

    vi.mocked(supabaseAdmin).rpc = vi.fn().mockResolvedValue({
      data: mockRpcData,
      error: null,
    })

    const { GET } = await getRoute()
    const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages/stats')
    const res = await GET(req, { params: { id: 'client-1' } })

    expect(res.status).toBe(200)
    const body = await res.json()

    // Verify top-level structure
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('byType')
    expect(body).toHaveProperty('geoCoverage')
    expect(body).toHaveProperty('byStatusCode')
    expect(body).toHaveProperty('avgWordCount')
  })

  it('returns correct counts', async () => {
    const mockRpcData = [{
      total_count: 50,
      blog_count: 20,
      product_count: 10,
      service_count: 8,
      landing_count: 5,
      about_count: 3,
      contact_count: 2,
      other_count: 2,
      geo_yes: 15,
      geo_no: 35,
      ok_2xx: 45,
      redirect_3xx: 3,
      client_4xx: 1,
      server_5xx: 1,
      avg_word_count: 1250.5,
    }]

    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom
    mockFrom.mockReturnValueOnce(
      buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
    )
    vi.mocked(supabaseAdmin).rpc = vi.fn().mockResolvedValue({
      data: mockRpcData,
      error: null,
    })

    const { GET } = await getRoute()
    const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages/stats')
    const res = await GET(req, { params: { id: 'client-1' } })
    const body = await res.json()

    expect(body.total).toBe(50)
    expect(body.byType.blog).toBe(20)
    expect(body.byType.product).toBe(10)
    expect(body.byType.service).toBe(8)
    expect(body.geoCoverage.withBlock).toBe(15)
    expect(body.geoCoverage.withoutBlock).toBe(35)
    expect(body.geoCoverage.percent).toBe(30) // 15/50 = 30%
    expect(body.byStatusCode.ok).toBe(45)
    expect(body.byStatusCode.redirect).toBe(3)
    expect(body.byStatusCode.clientErr).toBe(1)
    expect(body.byStatusCode.serverErr).toBe(1)
  })

  it('returns 0 percent GEO coverage when no pages', async () => {
    const mockRpcData = [{
      total_count: 0,
      blog_count: 0,
      product_count: 0,
      service_count: 0,
      landing_count: 0,
      about_count: 0,
      contact_count: 0,
      other_count: 0,
      geo_yes: 0,
      geo_no: 0,
      ok_2xx: 0,
      redirect_3xx: 0,
      client_4xx: 0,
      server_5xx: 0,
      avg_word_count: 0,
    }]

    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom
    mockFrom.mockReturnValueOnce(
      buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
    )
    vi.mocked(supabaseAdmin).rpc = vi.fn().mockResolvedValue({
      data: mockRpcData,
      error: null,
    })

    const { GET } = await getRoute()
    const req = new NextRequest('http://localhost/api/clients/client-1/site-audit/pages/stats')
    const res = await GET(req, { params: { id: 'client-1' } })
    const body = await res.json()

    expect(body.total).toBe(0)
    expect(body.geoCoverage.percent).toBe(0)
  })

  it('returns 404 when client does not exist', async () => {
    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom
    mockFrom.mockReturnValueOnce(
      buildChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    )

    const { GET } = await getRoute()
    const req = new NextRequest('http://localhost/api/clients/nonexistent/site-audit/pages/stats')
    const res = await GET(req, { params: { id: 'nonexistent' } })
    expect(res.status).toBe(404)
  })

  it('returns 500 on RPC error', async () => {
    const mockFrom = vi.fn()
    vi.mocked(supabaseAdmin).from = mockFrom
    mockFrom.mockReturnValueOnce(
      buildChain({ data: { id: 'client-1', domain: 'example.com' }, error: null })
    )
    vi.mocked(supabaseAdmin).rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'RPC function not found' },
    })

    const { GET } = await getRoute()
    const req = await new NextRequest('http://localhost/api/clients/client-1/site-audit/pages/stats')
    const res = await GET(req, { params: { id: 'client-1' } })
    expect(res.status).toBe(500)
  })
})
