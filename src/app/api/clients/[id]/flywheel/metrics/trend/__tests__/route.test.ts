/**
 * GET /api/clients/[id]/flywheel/metrics/trend — unit tests (P22.B.2)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockSelect = vi.fn()

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            gte: () => ({
              order: () => mockSelect(),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { GET } from '../route'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CLIENT_ID  = 'client-xyz'
const METRIC_KEY = 'seo.gsc.clicks'

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL(`http://localhost:3001/api/clients/${CLIENT_ID}/flywheel/metrics/trend`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function routeCtx() {
  return { params: { id: CLIENT_ID } }
}

// Two data points on the same day — should collapse to one (last value wins)
const SAME_DAY_DATA = [
  { metric_value: 100, measured_at: '2026-05-01T08:00:00Z' },
  { metric_value: 120, measured_at: '2026-05-01T20:00:00Z' },
  { metric_value: 200, measured_at: '2026-05-02T10:00:00Z' },
]

const SIMPLE_DATA = [
  { metric_value: 100, measured_at: '2026-05-01T08:00:00Z' },
  { metric_value: 150, measured_at: '2026-05-02T08:00:00Z' },
  { metric_value: 130, measured_at: '2026-05-03T08:00:00Z' },
]

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/flywheel/metrics/trend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
    mockSelect.mockResolvedValue({ data: SIMPLE_DATA, error: null })
  })

  // ── Auth & validation ─────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })
    const res = await GET(makeRequest({ metric_key: METRIC_KEY }), routeCtx())
    expect(res.status).toBe(401)
  })

  it('returns 400 when metric_key is missing', async () => {
    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('metric_key')
  })

  it('returns 400 when metric_key is blank', async () => {
    const res = await GET(makeRequest({ metric_key: '   ' }), routeCtx())
    expect(res.status).toBe(400)
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 200 with dataPoints array on success', async () => {
    const res = await GET(makeRequest({ metric_key: METRIC_KEY }), routeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.metric_key).toBe(METRIC_KEY)
    expect(json.days).toBe(30)
    expect(json.dataPoints).toHaveLength(3)
  })

  it('dataPoints are sorted ascending by date', async () => {
    const res = await GET(makeRequest({ metric_key: METRIC_KEY }), routeCtx())
    const { dataPoints } = await res.json()
    const dates = dataPoints.map((p: { date: string }) => p.date)
    expect(dates).toEqual([...dates].sort())
  })

  it('each dataPoint has { date: "YYYY-MM-DD", value: number }', async () => {
    const res = await GET(makeRequest({ metric_key: METRIC_KEY }), routeCtx())
    const { dataPoints } = await res.json()
    for (const p of dataPoints) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(typeof p.value).toBe('number')
    }
  })

  it('returns empty dataPoints when no data in DB', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null })
    const res = await GET(makeRequest({ metric_key: METRIC_KEY }), routeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.dataPoints).toEqual([])
  })

  // ── Day aggregation ───────────────────────────────────────────────────────

  it('collapses multiple readings on the same day to one (last value wins)', async () => {
    mockSelect.mockResolvedValue({ data: SAME_DAY_DATA, error: null })
    const res = await GET(makeRequest({ metric_key: METRIC_KEY }), routeCtx())
    const { dataPoints } = await res.json()
    // 2 unique dates: 2026-05-01 and 2026-05-02
    expect(dataPoints).toHaveLength(2)
    const may1 = dataPoints.find((p: { date: string }) => p.date === '2026-05-01')
    // Last value for May 1 is 120 (the second reading)
    expect(may1?.value).toBe(120)
  })

  // ── Days param ────────────────────────────────────────────────────────────

  it('defaults to 30 days when days param is absent', async () => {
    const res = await GET(makeRequest({ metric_key: METRIC_KEY }), routeCtx())
    const json = await res.json()
    expect(json.days).toBe(30)
  })

  it('respects custom days param', async () => {
    const res = await GET(makeRequest({ metric_key: METRIC_KEY, days: '7' }), routeCtx())
    const json = await res.json()
    expect(json.days).toBe(7)
  })

  it('caps days at 90', async () => {
    const res = await GET(makeRequest({ metric_key: METRIC_KEY, days: '999' }), routeCtx())
    const json = await res.json()
    expect(json.days).toBe(90)
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 when DB returns an error', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'connection timeout' } })
    const res = await GET(makeRequest({ metric_key: METRIC_KEY }), routeCtx())
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toContain('Failed to fetch')
  })
})
