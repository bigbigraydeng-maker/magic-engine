/**
 * GET /api/clients/[id]/health-score — unit tests (P22.B.4)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockMetricsQuery  = vi.fn()
const mockAnomalyCount  = vi.fn()

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

// Build a flexible chainable mock for supabaseAdmin
const makeChainable = (terminalFn: () => unknown) => {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return (...args: unknown[]) => {
          const p = terminalFn() as Promise<unknown>
          const method = (p as unknown as Record<string, unknown>)[String(prop)] as ((...a: unknown[]) => unknown) | undefined
          return method?.(...args)
        }
      }
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'flywheel_metrics') return makeChainable(mockMetricsQuery)
      if (table === 'anomaly_signals')  return makeChainable(mockAnomalyCount)
      return makeChainable(() => Promise.resolve({ data: null, error: null }))
    },
  },
}))

import { GET } from '../route'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CLIENT_ID = 'client-health-test'

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function makeRequest() {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/health-score`)
}

function routeCtx() {
  return { params: { id: CLIENT_ID } }
}

// 30 values for each of the most impactful metrics
const HEALTHY_METRICS = [
  // SEO improving
  ...Array.from({ length: 10 }, (_, i) => ({
    metric_key: 'seo.gsc.clicks', metric_value: 100 + i * 2, measured_at: `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  })),
  // Ads stable
  ...Array.from({ length: 10 }, (_, i) => ({
    metric_key: 'ads.account.roas', metric_value: 3.0, measured_at: `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  })),
]

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/health-score', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
    mockMetricsQuery.mockResolvedValue({ data: HEALTHY_METRICS, error: null })
    mockAnomalyCount.mockResolvedValue({ count: 0, error: null })
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })
    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(401)
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 200 with required fields', async () => {
    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.total).toBe('number')
    expect(['healthy', 'fair', 'at_risk', 'critical']).toContain(json.band)
    expect(Array.isArray(json.breakdown)).toBe(true)
    expect(typeof json.activeAnomalies).toBe('number')
    expect(typeof json.anomalyPenalty).toBe('number')
  })

  it('total is an integer between 0 and 100', async () => {
    const res = await GET(makeRequest(), routeCtx())
    const { total } = await res.json()
    expect(Number.isInteger(total)).toBe(true)
    expect(total).toBeGreaterThanOrEqual(0)
    expect(total).toBeLessThanOrEqual(100)
  })

  it('breakdown contains 4 flywheel entries', async () => {
    const res = await GET(makeRequest(), routeCtx())
    const { breakdown } = await res.json()
    expect(breakdown).toHaveLength(4)
    const flywheels = breakdown.map((f: { flywheel: string }) => f.flywheel).sort()
    expect(flywheels).toEqual(['ads', 'geo', 'seo', 'social'])
  })

  it('each breakdown entry has flywheel, score, noData fields', async () => {
    const res = await GET(makeRequest(), routeCtx())
    const { breakdown } = await res.json()
    for (const entry of breakdown) {
      expect(typeof entry.flywheel).toBe('string')
      expect(typeof entry.score).toBe('number')
      expect(typeof entry.noData).toBe('boolean')
    }
  })

  // ── Anomaly penalty ───────────────────────────────────────────────────────

  it('reflects anomaly count in anomalyPenalty', async () => {
    mockAnomalyCount.mockResolvedValue({ count: 3, error: null })
    const res = await GET(makeRequest(), routeCtx())
    const json = await res.json()
    expect(json.activeAnomalies).toBe(3)
    expect(json.anomalyPenalty).toBe(6) // 3 × 2
  })

  it('proceeds with 0 anomalies when anomaly query errors (non-fatal)', async () => {
    mockAnomalyCount.mockResolvedValue({ count: null, error: { message: 'DB error' } })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.activeAnomalies).toBe(0)
    consoleSpy.mockRestore()
  })

  // ── noData fallback ───────────────────────────────────────────────────────

  it('marks flywheels with no data as noData=true with score=12.5', async () => {
    mockMetricsQuery.mockResolvedValue({ data: [], error: null })
    const res = await GET(makeRequest(), routeCtx())
    const { breakdown } = await res.json()
    for (const entry of breakdown) {
      expect(entry.noData).toBe(true)
      expect(entry.score).toBeCloseTo(12.5)
    }
  })

  it('returns 50 when all flywheels have no data and no anomalies', async () => {
    mockMetricsQuery.mockResolvedValue({ data: [], error: null })
    const res = await GET(makeRequest(), routeCtx())
    const { total } = await res.json()
    // 4 × 12.5 = 50 neutral
    expect(total).toBe(50)
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 when metrics DB query errors', async () => {
    mockMetricsQuery.mockResolvedValue({ data: null, error: { message: 'connection lost' } })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(500)
    consoleSpy.mockRestore()
  })
})
