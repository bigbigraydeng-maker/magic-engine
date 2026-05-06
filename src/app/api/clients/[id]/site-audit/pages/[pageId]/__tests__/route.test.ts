import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { supabaseAdmin } from '@/lib/supabase'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

function makeChain(result: object) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  return chain
}

describe('GET /api/clients/[id]/site-audit/pages/[pageId]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when page not found for client', async () => {
    vi.mocked(supabaseAdmin).from = vi.fn().mockReturnValue(
      makeChain({ data: null, error: null })
    )
    const res = await GET(
      new NextRequest('http://localhost/api/clients/c1/site-audit/pages/p1'),
      { params: { id: 'c1', pageId: 'p1' } }
    )
    expect(res.status).toBe(404)
  })

  it('returns 200 with page data when found', async () => {
    const mockPage = {
      id: 'p1', client_id: 'c1', url: 'https://example.com/',
      markdown_content: '# Home', crawl_status: 'crawled',
    }
    vi.mocked(supabaseAdmin).from = vi.fn().mockReturnValue(
      makeChain({ data: mockPage, error: null })
    )
    const res = await GET(
      new NextRequest('http://localhost/api/clients/c1/site-audit/pages/p1'),
      { params: { id: 'c1', pageId: 'p1' } }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page.id).toBe('p1')
    expect(body.page.markdown_content).toBe('# Home')
  })

  it('returns 500 on database error', async () => {
    vi.mocked(supabaseAdmin).from = vi.fn().mockReturnValue(
      makeChain({ data: null, error: { message: 'DB error' } })
    )
    const res = await GET(
      new NextRequest('http://localhost/api/clients/c1/site-audit/pages/p1'),
      { params: { id: 'c1', pageId: 'p1' } }
    )
    expect(res.status).toBe(500)
  })
})
