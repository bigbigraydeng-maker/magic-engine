/**
 * Tests for GET /api/clients/[id]/dashboard-summary
 * Returns aggregated status counts for the client detail page status cards.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET } from './route'
import { supabaseAdmin } from '@/lib/supabase'

const params = { id: 'client-1' }
const req = () => new NextRequest('http://localhost/api/clients/client-1/dashboard-summary')

// Helper: build a chainable Supabase mock for a single table query
function mockCount(value: number | null) {
  return { count: value, error: null }
}

function setupMocks({
  pages = { crawled: 20, failed: 2 },
  strategy = { total: 46, critical: 1, high: 5 },
  hasBrief = true,
  geoCount = 3,
}: {
  pages?: { crawled: number; failed: number }
  strategy?: { total: number; critical: number; high: number }
  hasBrief?: boolean
  geoCount?: number
} = {}) {
  let callIndex = 0
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === 'client_site_pages') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue(
              callIndex++ === 0
                ? { count: pages.crawled, error: null }
                : { count: pages.failed, error: null }
            ),
          }),
        }),
      } as any
    }
    if (table === 'content_strategy_items') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            data: Array(strategy.total).fill({ priority: 'medium' }).map((_, i) => ({
              priority: i < strategy.critical ? 'critical' : i < strategy.critical + strategy.high ? 'high' : 'medium',
            })),
            error: null,
          }),
        }),
      } as any
    }
    if (table === 'master_briefs') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: hasBrief ? { id: 'brief-1', updated_at: '2026-05-01' } : null,
                error: null,
              }),
            }),
          }),
        }),
      } as any
    }
    if (table === 'geo_directives') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: geoCount, error: null }),
          }),
        }),
      } as any
    }
    return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) } as any
  })
}

beforeEach(() => vi.clearAllMocks())

describe('GET dashboard-summary', () => {
  it('returns 200 with aggregated counts', async () => {
    setupMocks()
    const res = await GET(req(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({
      dnz: expect.objectContaining({ crawled: expect.any(Number) }),
      strategy: expect.objectContaining({ total: expect.any(Number) }),
      master_brief: expect.objectContaining({ exists: expect.any(Boolean) }),
      geo: expect.objectContaining({ active_count: expect.any(Number) }),
    })
  })

  it('returns exists=false when no master brief', async () => {
    setupMocks({ hasBrief: false })
    const res = await GET(req(), { params })
    const json = await res.json()
    expect(json.master_brief.exists).toBe(false)
  })

  it('returns geo active_count correctly', async () => {
    setupMocks({ geoCount: 5 })
    const res = await GET(req(), { params })
    const json = await res.json()
    expect(json.geo.active_count).toBe(5)
  })
})
