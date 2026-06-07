/**
 * TDD tests for POST /api/clients/[id]/pages/[pageId]/upgrade
 * Phase 8.2.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/blog/upgrade-generator', () => ({
  generatePageUpgrade: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn().mockResolvedValue({ ok: true, user: { email: 'test@test.com' }, role: 'admin', allowedClientId: null }),
  requirePaidClientAccess: vi.fn().mockResolvedValue({ ok: true, user: { email: 'test@test.com' }, role: 'admin', allowedClientId: null }),
}))

import { POST } from '../upgrade/route'
import { supabaseAdmin } from '@/lib/supabase'
import { generatePageUpgrade } from '@/lib/blog/upgrade-generator'
import { requireDashboardClientAccess, requirePaidClientAccess } from '@/lib/auth/client-access'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockGenerate = vi.mocked(generatePageUpgrade)
// Route uses requirePaidClientAccess; legacy tests mock requireDashboardClientAccess.
// We alias mockAccess to the Paid mock to keep the existing test bodies working.
const mockAccess = vi.mocked(requirePaidClientAccess)
void requireDashboardClientAccess  // keep import for back-compat; no-op

function makeRequest(body: unknown = {}, clientId = 'client-abc', pageId = 'page-xyz') {
  return new NextRequest(`http://localhost/api/clients/${clientId}/pages/${pageId}/upgrade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    body: JSON.stringify(body),
  })
}

function makePageRow(overrides = {}) {
  return {
    id: 'page-xyz',
    client_id: 'client-abc',
    url: 'https://example.com/china-tours',
    title: 'China Tours NZ',
    page_type: 'service',
    word_count: 400,
    has_geo_block: false,
    topics: ['china', 'tours'],
    primary_keyword: 'china tours nz',
    ...overrides,
  }
}

function makeSingleChain(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as ReturnType<typeof mockFrom>
}

const UPGRADE_OUTPUT = {
  enhanced_title: 'Best China Tours from NZ',
  enhanced_meta_title: 'China Tours NZ | Expert Packages',
  enhanced_meta_description: 'Trusted NZ China tour operator.',
  enhanced_html_body: '<h1>Best China Tours from NZ</h1><p>...</p>',
  word_count: 1100,
  changes_summary: 'Expanded content and added GEO block.',
  geo_block_html: '<section class="geo-signals">...</section>',
  original_excerpt: '# China Tours NZ\n\nWe offer tours.',
  source_page_url: 'https://example.com/china-tours',
  cost_usd: 0.012,
  model_used: 'claude-sonnet-4-6',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/clients/[id]/pages/[pageId]/upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccess.mockResolvedValue({ ok: true, user: { email: 'test@test.com' }, role: 'admin', allowedClientId: null } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
  })

  it('returns 401 when auth fails', async () => {
    mockAccess.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })
    const res = await POST(makeRequest(), { params: { id: 'c', pageId: 'p' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when page not found', async () => {
    mockFrom.mockReturnValue(makeSingleChain(null, { message: 'Not found' }))
    const res = await POST(makeRequest(), { params: { id: 'client-abc', pageId: 'page-xyz' } })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 404 when page belongs to different client', async () => {
    const wrongPage = makePageRow({ client_id: 'other-client' })
    mockFrom.mockReturnValue(makeSingleChain(wrongPage, null))
    const res = await POST(makeRequest(), { params: { id: 'client-abc', pageId: 'page-xyz' } })
    expect(res.status).toBe(404)
  })

  it('returns 200 with upgrade output on success', async () => {
    mockFrom.mockReturnValue(makeSingleChain(makePageRow(), null))
    mockGenerate.mockResolvedValue(UPGRADE_OUTPUT)

    const res = await POST(makeRequest({ topic: 'china tours nz' }), {
      params: { id: 'client-abc', pageId: 'page-xyz' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enhanced_title).toBe('Best China Tours from NZ')
    expect(body.original_excerpt).toBeTruthy()
    expect(body.changes_summary).toBeTruthy()
  })

  it('passes correct request to generatePageUpgrade', async () => {
    mockFrom.mockReturnValue(makeSingleChain(makePageRow(), null))
    mockGenerate.mockResolvedValue(UPGRADE_OUTPUT)

    await POST(
      makeRequest({ topic: 'china tours nz', mode: 'unified', source_query_text: 'best china tours nz' }),
      { params: { id: 'client-abc', pageId: 'page-xyz' } }
    )

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-abc',
        page_id: 'page-xyz',
        page_url: 'https://example.com/china-tours',
        topic: 'china tours nz',
        mode: 'unified',
      })
    )
  })

  it('uses page topic as default when topic not in request body', async () => {
    const page = makePageRow({ topics: ['china', 'tours'], primary_keyword: 'china tours nz' })
    mockFrom.mockReturnValue(makeSingleChain(page, null))
    mockGenerate.mockResolvedValue(UPGRADE_OUTPUT)

    await POST(makeRequest({}), { params: { id: 'client-abc', pageId: 'page-xyz' } })

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ topic: expect.stringContaining('china') })
    )
  })

  it('returns 500 when generatePageUpgrade throws', async () => {
    mockFrom.mockReturnValue(makeSingleChain(makePageRow(), null))
    mockGenerate.mockRejectedValue(new Error('Claude API error'))

    const res = await POST(makeRequest({ topic: 'test' }), {
      params: { id: 'client-abc', pageId: 'page-xyz' },
    })
    expect(res.status).toBe(500)
  })
})
