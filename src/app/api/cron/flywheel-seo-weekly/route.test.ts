/**
 * Tests for flywheel-seo-weekly cron endpoint — P12.B.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

const mockClientsQuery = vi.fn()
const mockEq = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: mockEq.mockImplementation(() => ({
          not: mockClientsQuery,
        })),
      })),
    })),
  },
}))

// startCronRun writes to cron_run_logs via supabaseAdmin — out of scope here
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish: vi.fn(async () => {}) })),
}))

// ── Mock SeoContentAdapter ────────────────────────────────────────────────────

const mockPullMetrics = vi.fn()

vi.mock('@/lib/flywheel/adapters/SeoContentAdapter', () => ({
  SeoContentAdapter: vi.fn().mockImplementation(() => ({
    pullMetrics: mockPullMetrics,
  })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(secret: string | null) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/flywheel-seo-weekly', {
    method: 'GET',
    headers,
  })
}

const CRON_SECRET = 'test-cron-secret'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/cron/flywheel-seo-weekly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
  })

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/CRON_SECRET/)
  })

  it('returns 401 when authorization header is missing', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest(null))
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header has wrong secret', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns 500 when clients DB query fails', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused' },
    })
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/connection refused/)
  })

  it('returns early with 0 processed when no clients have a domain', async () => {
    mockClientsQuery.mockResolvedValueOnce({ data: [], error: null })
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.clients_processed).toBe(0)
    expect(json.metrics_written).toBe(0)
  })

  it('processes one client and returns metrics_written count', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [{ id: 'client-cts', domain: 'ctstours.com.au' }],
      error: null,
    })
    mockPullMetrics.mockResolvedValueOnce([
      { metricKey: 'organic_keywords', metricValue: 1200 },
      { metricKey: 'organic_traffic', metricValue: 8500 },
      { metricKey: 'authority_score', metricValue: 32 },
      { metricKey: 'published_posts', metricValue: 7 },
    ])

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.clients_processed).toBe(1)
    expect(json.metrics_written).toBe(4)
    expect(json.failed).toBe(0)
    // 真客户闸门：选客户必须按 client_status='active' 过滤
    expect(mockEq).toHaveBeenCalledWith('client_status', 'active')
    expect(json.results[0]).toMatchObject({ client_id: 'client-cts', metrics_written: 4 })
  })

  it('processes multiple clients and sums metrics_written', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [
        { id: 'client-cts', domain: 'ctstours.com.au' },
        { id: 'client-oz', domain: 'oztop.co.nz' },
      ],
      error: null,
    })
    mockPullMetrics
      .mockResolvedValueOnce(Array(4).fill({ metricKey: 'k', metricValue: 1 }))
      .mockResolvedValueOnce(Array(3).fill({ metricKey: 'k', metricValue: 1 }))

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.clients_processed).toBe(2)
    expect(json.metrics_written).toBe(7)
    expect(json.failed).toBe(0)
  })

  it('continues processing remaining clients when one pullMetrics fails', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [
        { id: 'client-bad', domain: 'bad.com.au' },
        { id: 'client-ok', domain: 'ok.com.au' },
      ],
      error: null,
    })
    mockPullMetrics
      .mockRejectedValueOnce(new Error('SEMrush timeout'))
      .mockResolvedValueOnce(Array(4).fill({ metricKey: 'k', metricValue: 1 }))

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.clients_processed).toBe(2)
    expect(json.metrics_written).toBe(4)
    expect(json.failed).toBe(1)
    expect(json.results[0]).toMatchObject({ client_id: 'client-bad', metrics_written: 0, error: 'SEMrush timeout' })
    expect(json.results[1]).toMatchObject({ client_id: 'client-ok', metrics_written: 4 })
  })

  it('filters out clients that have null or empty domain', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [
        { id: 'client-nodomain', domain: null },
        { id: 'client-emptydomain', domain: '' },
        { id: 'client-valid', domain: 'valid.com.au' },
      ],
      error: null,
    })
    mockPullMetrics.mockResolvedValueOnce(Array(4).fill({ metricKey: 'k', metricValue: 1 }))

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.clients_processed).toBe(1)
    expect(json.results[0].client_id).toBe('client-valid')
  })
})
