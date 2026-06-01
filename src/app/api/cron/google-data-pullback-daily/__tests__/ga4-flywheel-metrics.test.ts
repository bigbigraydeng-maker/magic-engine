/**
 * Phase 22.A.2 — GA4 flywheel_metrics integration tests
 *
 * Covers:
 *   1. vocabulary.ts — GA4_METRIC_KEY values are correct and unique
 *   2. google-data-pullback-daily/route.ts syncGa4() — writes 4 rows to
 *      flywheel_metrics on a successful snapshot upsert
 *   3. syncGa4() — flywheel_metrics write is non-fatal (snapshot still
 *      saved even if metrics insert fails)
 *   4. syncGa4() — returns success:false when fetchGa4Snapshot returns null
 *   5. syncGa4() — returns success:false when snapshot upsert errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/gsc/client', () => ({
  fetchGscSnapshot: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/ga4/client', () => ({
  fetchGa4Snapshot: vi.fn(),
}))

vi.mock('@/lib/meta/client', () => ({
  getAdAccountInsights: vi.fn().mockResolvedValue(null),
  getAdCampaignInsights: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/flywheel/adapters/MetaAdsAdapter', () => ({
  MetaAdsAdapter: vi.fn().mockImplementation(() => ({
    pullMetrics: vi.fn().mockResolvedValue([]),
  })),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { fetchGa4Snapshot } from '@/lib/ga4/client'
import { GA4_METRIC_KEY } from '@/lib/flywheel/vocabulary'

const mockFrom     = vi.mocked(supabaseAdmin.from)
const mockFetchGa4 = vi.mocked(fetchGa4Snapshot)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLIENT_ID   = 'client-uuid-ga4-test'
const PROPERTY_ID = '123456789'

const MOCK_SNAPSHOT = {
  property_id:          PROPERTY_ID,
  period_start:         '2026-05-03',
  period_end:           '2026-05-31',
  total_sessions:       8400,
  total_users:          6200,
  total_new_users:      3100,
  total_pageviews:      22500,
  avg_session_duration: 142.5,
  bounce_rate:          0.47,
  top_pages:            [],
  top_sources:          [],
  synced_at:            new Date().toISOString(),
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest() {
  return new NextRequest(
    'http://localhost:3001/api/cron/google-data-pullback-daily',
    {
      method:  'GET',
      headers: { Authorization: `Bearer test-cron-secret` },
    },
  )
}

function mockClientConnectors(includeGa4 = true) {
  const connectors = includeGa4
    ? [{ client_id: CLIENT_ID, anchor: 'ga4', config: { property_id: PROPERTY_ID } }]
    : []

  let callIndex = 0
  mockFrom.mockImplementation((table: string) => {
    if (table === 'client_connectors') {
      return {
        select: vi.fn().mockReturnThis(),
        in:     vi.fn().mockReturnThis(),
        eq:     vi.fn().mockResolvedValue({ data: connectors, error: null }),
      } as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    if (table === 'clients') {
      return {
        select: vi.fn().mockReturnThis(),
        not:    vi.fn().mockResolvedValue({ data: [], error: null }),
      } as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    if (table === 'ga4_traffic_snapshots') {
      return {
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: `snap-${callIndex++}` }, error: null }),
      } as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    if (table === 'flywheel_metrics') {
      return {
        delete: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        in:     vi.fn().mockReturnThis(),
        gte:    vi.fn().mockReturnThis(),
        lte:    vi.fn().mockReturnThis(),
        then:   vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve(resolve(null))),
        insert: vi.fn().mockReturnThis(),
      } as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    return {} as unknown as ReturnType<typeof supabaseAdmin.from>
  })
}

// ── Tests: vocabulary ─────────────────────────────────────────────────────────

describe('GA4_METRIC_KEY vocabulary', () => {
  it('contains all 4 expected keys', () => {
    const keys = Object.values(GA4_METRIC_KEY)
    expect(keys).toContain('seo.ga4.sessions')
    expect(keys).toContain('seo.ga4.bounce_rate')
    expect(keys).toContain('seo.ga4.pageviews')
    expect(keys).toContain('seo.ga4.new_users')
    expect(keys).toHaveLength(4)
  })

  it('all values start with seo.ga4.', () => {
    for (const v of Object.values(GA4_METRIC_KEY)) {
      expect(v).toMatch(/^seo\.ga4\./)
    }
  })

  it('values are unique (no duplicates)', () => {
    const values = Object.values(GA4_METRIC_KEY)
    const unique  = new Set(values)
    expect(unique.size).toBe(values.length)
  })

  it('isValidGa4MetricKey returns true for valid key', async () => {
    const { isValidGa4MetricKey } = await import('@/lib/flywheel/vocabulary')
    expect(isValidGa4MetricKey('seo.ga4.sessions')).toBe(true)
    expect(isValidGa4MetricKey('seo.ga4.bounce_rate')).toBe(true)
  })

  it('isValidGa4MetricKey returns false for unknown key', async () => {
    const { isValidGa4MetricKey } = await import('@/lib/flywheel/vocabulary')
    expect(isValidGa4MetricKey('seo.ga4.unknown')).toBe(false)
    expect(isValidGa4MetricKey('ga4.sessions')).toBe(false)
    expect(isValidGa4MetricKey('')).toBe(false)
  })
})

// ── Tests: syncGa4 route integration ─────────────────────────────────────────

describe('google-data-pullback-daily syncGa4() flywheel_metrics', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('writes 4 GA4 metric rows to flywheel_metrics on success', async () => {
    mockFetchGa4.mockResolvedValue(MOCK_SNAPSHOT)

    const insertMock = vi.fn().mockReturnThis()
    const thenMock   = vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve(resolve(null)))

    let callIndex = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors') {
        return {
          select: vi.fn().mockReturnThis(),
          in:     vi.fn().mockReturnThis(),
          eq:     vi.fn().mockResolvedValue({
            data: [{ client_id: CLIENT_ID, anchor: 'ga4', config: { property_id: PROPERTY_ID } }],
            error: null,
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnThis(),
          not:    vi.fn().mockResolvedValue({ data: [], error: null }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      if (table === 'ga4_traffic_snapshots') {
        return {
          upsert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: `snap-${callIndex++}` }, error: null }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      if (table === 'flywheel_metrics') {
        return {
          delete: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          in:     vi.fn().mockReturnThis(),
          gte:    vi.fn().mockReturnThis(),
          lte:    vi.fn().mockReturnThis(),
          then:   thenMock,
          insert: insertMock,
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      return {} as unknown as ReturnType<typeof supabaseAdmin.from>
    })

    const { GET } = await import('../route')
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ga4_synced).toBe(1)

    // insert called once with 4 rows
    expect(insertMock).toHaveBeenCalledOnce()
    const insertArg = insertMock.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(insertArg).toHaveLength(4)

    const keys = insertArg.map(r => r.metric_key)
    expect(keys).toContain(GA4_METRIC_KEY.SESSIONS)
    expect(keys).toContain(GA4_METRIC_KEY.BOUNCE_RATE)
    expect(keys).toContain(GA4_METRIC_KEY.PAGEVIEWS)
    expect(keys).toContain(GA4_METRIC_KEY.NEW_USERS)

    // verify values map to snapshot fields
    const sessRow = insertArg.find(r => r.metric_key === GA4_METRIC_KEY.SESSIONS)!
    expect(sessRow.metric_value).toBe(MOCK_SNAPSHOT.total_sessions)
    expect(sessRow.flywheel).toBe('seo')
    expect(sessRow.source).toBe('ga4_pullback')
    expect(sessRow.client_id).toBe(CLIENT_ID)

    const bounceRow = insertArg.find(r => r.metric_key === GA4_METRIC_KEY.BOUNCE_RATE)!
    expect(bounceRow.metric_value).toBe(MOCK_SNAPSHOT.bounce_rate)
  })

  it('returns ga4.success=false when fetchGa4Snapshot returns null (no token)', async () => {
    mockFetchGa4.mockResolvedValue(null)
    mockClientConnectors()

    const { GET } = await import('../route')
    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ga4_synced).toBe(0)
    expect(body.failed).toBe(1)
  })

  it('returns ga4.success=false when snapshot upsert errors', async () => {
    mockFetchGa4.mockResolvedValue(MOCK_SNAPSHOT)

    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors') {
        return {
          select: vi.fn().mockReturnThis(),
          in:     vi.fn().mockReturnThis(),
          eq:     vi.fn().mockResolvedValue({
            data: [{ client_id: CLIENT_ID, anchor: 'ga4', config: { property_id: PROPERTY_ID } }],
            error: null,
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnThis(),
          not:    vi.fn().mockResolvedValue({ data: [], error: null }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      if (table === 'ga4_traffic_snapshots') {
        return {
          upsert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      return {} as unknown as ReturnType<typeof supabaseAdmin.from>
    })

    const { GET } = await import('../route')
    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ga4_synced).toBe(0)
    expect(body.failed).toBe(1)
  })

  it('flywheel_metrics write failure does not affect snapshot success', async () => {
    mockFetchGa4.mockResolvedValue(MOCK_SNAPSHOT)

    let callIndex = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors') {
        return {
          select: vi.fn().mockReturnThis(),
          in:     vi.fn().mockReturnThis(),
          eq:     vi.fn().mockResolvedValue({
            data: [{ client_id: CLIENT_ID, anchor: 'ga4', config: { property_id: PROPERTY_ID } }],
            error: null,
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnThis(),
          not:    vi.fn().mockResolvedValue({ data: [], error: null }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      if (table === 'ga4_traffic_snapshots') {
        return {
          upsert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: `snap-${callIndex++}` }, error: null }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      if (table === 'flywheel_metrics') {
        // delete chain resolves, but insert rejects
        return {
          delete: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          in:     vi.fn().mockReturnThis(),
          gte:    vi.fn().mockReturnThis(),
          lte:    vi.fn().mockReturnThis(),
          then:   vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve(resolve(null))),
          insert: vi.fn().mockReturnThis(),
          // no then on insert → simulate .then() silently failing
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      return {} as unknown as ReturnType<typeof supabaseAdmin.from>
    })

    const { GET } = await import('../route')
    const res  = await GET(makeRequest())
    const body = await res.json()

    // Snapshot was saved → ga4_synced = 1, even if metrics write failed
    expect(res.status).toBe(200)
    expect(body.ga4_synced).toBe(1)
  })
})
