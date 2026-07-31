/**
 * Tests for google-data-pullback-daily cron — P22.A.5
 *
 * Focuses on the MetaAdsAdapter.pullMetrics() integration added in P22.A.5.
 * Mocks supabaseAdmin, Meta API clients, GSC/GA4 fetchers, and MetaAdsAdapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

// connectors query: .from('client_connectors').select().in().eq()
const mockConnectorsResult = vi.fn()
// meta clients query: .from('clients').select().not()
const mockMetaClientsResult = vi.fn()
// meta_ads_snapshots insert: .from('meta_ads_snapshots').insert().select().single()
const mockSnapshotSingle = vi.fn()
const mockSnapshotSelect = vi.fn(() => ({ single: mockSnapshotSingle }))
const mockSnapshotInsert = vi.fn(() => ({ select: mockSnapshotSelect }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'client_connectors') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              eq: mockConnectorsResult,
            })),
          })),
        }
      }
      if (table === 'clients') {
        return {
          select: vi.fn(() => ({
            not: mockMetaClientsResult,
          })),
        }
      }
      if (table === 'meta_ads_snapshots') {
        return { insert: mockSnapshotInsert }
      }
      // Google Ads arm, added after this file was written:
      // .select().eq().eq().not() — no connections, so that arm is a no-op.
      if (table === 'platform_oauth_connections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          not:    vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      // Objective-aware Meta cost metrics: delete-then-insert, both awaited.
      if (table === 'flywheel_metrics') {
        return {
          delete: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          in:     vi.fn().mockReturnThis(),
          gte:    vi.fn().mockReturnThis(),
          lte:    vi.fn().mockReturnThis(),
          then:   (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      return {}
    }),
  },
}))

// ── Mock GSC / GA4 fetchers ───────────────────────────────────────────────────

// The route opens a cron_run_logs row first; the supabaseAdmin stub above has
// no chain for that table, so without this every test dies in startCronRun.
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn().mockResolvedValue({ finish: vi.fn().mockResolvedValue(undefined) }),
}))

vi.mock('@/lib/gsc/client', () => ({
  fetchGscSnapshot: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/ga4/client', () => ({
  fetchGa4Snapshot: vi.fn().mockResolvedValue(null),
  fetchGa4PaidSearchMetrics: vi.fn().mockResolvedValue(null),
}))

// ── Mock Meta API ─────────────────────────────────────────────────────────────

const mockGetAdAccountInsights = vi.fn()
const mockGetAdCampaignInsights = vi.fn()

vi.mock('@/lib/meta/client', () => ({
  getAdAccountInsights:  (...args: unknown[]) => mockGetAdAccountInsights(...args),
  getAdCampaignInsights: (...args: unknown[]) => mockGetAdCampaignInsights(...args),
}))

// ── Mock the Ad Strategy Engine (P21.K) ──────────────────────────────────────
// Off for this file: it is about the Meta snapshot → pullMetrics wiring, and
// leaving the engine on drags the campaign-series pull into every test.

vi.mock('@/lib/ads-strategy/config', () => ({
  loadAdStrategyConfigWithSource: vi.fn().mockResolvedValue({
    config: { enabled: false }, source: 'default',
  }),
  resolveDigestRecipients: vi.fn().mockReturnValue([]),
}))
vi.mock('@/lib/ads-strategy/daily-insights', () => ({
  syncAdDailyInsights:       vi.fn().mockResolvedValue({ success: true, rows_written: 0 }),
  syncCampaignDailyInsights: vi.fn().mockResolvedValue({ success: true, rows_written: 0 }),
}))
vi.mock('@/lib/ads-strategy/evaluate', () => ({ evaluateClientAdHealth: vi.fn() }))
vi.mock('@/lib/ads-strategy/digest', () => ({ sendAdHealthDigest: vi.fn() }))

// ── Mock MetaAdsAdapter (P22.A.5) ────────────────────────────────────────────

const mockPullMetrics = vi.fn().mockResolvedValue([])

vi.mock('@/lib/flywheel/adapters/MetaAdsAdapter', () => ({
  MetaAdsAdapter: vi.fn().mockImplementation(() => ({
    pullMetrics: mockPullMetrics,
  })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(secret: string | null) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/google-data-pullback-daily', {
    method: 'GET',
    headers,
  })
}

const CRON_SECRET = 'test-cron-secret'
const CLIENT_ID   = 'client-cts-001'
const AD_ACCOUNT  = 'act_123456789'
const META_TOKEN  = 'meta-system-user-token'

const MOCK_INSIGHTS = {
  spend: 1200,
  impressions: 45000,
  clicks: 320,
  conversions: 18,
  roas: 3.2,
  cpc: 3.75,
  ctr: 0.0071,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/cron/google-data-pullback-daily — P22.A.5 MetaAds flywheel接线', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET          = CRON_SECRET
    process.env.META_SYSTEM_USER_TOKEN = META_TOKEN

    // Default: no GSC/GA4 connectors, one Meta client
    mockConnectorsResult.mockResolvedValue({ data: [], error: null })
    mockMetaClientsResult.mockResolvedValue({
      data: [{ id: CLIENT_ID, meta_ad_account_id: AD_ACCOUNT }],
      error: null,
    })
    mockGetAdAccountInsights.mockResolvedValue(MOCK_INSIGHTS)
    mockGetAdCampaignInsights.mockResolvedValue([])
    mockSnapshotSingle.mockResolvedValue({ data: { id: 'snap-001' }, error: null })
  })

  it('returns 401 when authorization header is missing', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest(null))
    expect(res.status).toBe(401)
  })

  it('returns 401 when wrong secret is provided', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('calls MetaAdsAdapter.pullMetrics() after successful snapshot insert', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(mockPullMetrics).toHaveBeenCalledOnce()
    expect(mockPullMetrics).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('marks meta sync as success even when pullMetrics throws', async () => {
    // The snapshot is the pre-existing contract (monthly report, production
    // package view read it). A metrics-write failure is swallowed by design so
    // it cannot take the snapshot down with it.
    mockPullMetrics.mockRejectedValue(new Error('flywheel DB timeout'))

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.results[0].meta.success).toBe(true)
    expect(json.failed).toBe(0)
    expect(mockPullMetrics).toHaveBeenCalledTimes(1)
  })

  it('does NOT call pullMetrics when Meta Ads API returns null insights', async () => {
    mockGetAdAccountInsights.mockResolvedValue(null)

    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))

    expect(mockPullMetrics).not.toHaveBeenCalled()
  })

  it('does NOT call pullMetrics when META_SYSTEM_USER_TOKEN is missing', async () => {
    delete process.env.META_SYSTEM_USER_TOKEN

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockPullMetrics).not.toHaveBeenCalled()
    // meta not attempted means meta_synced = 0
    expect(json.meta_synced).toBe(0)
  })

  it('does NOT call pullMetrics when snapshot DB insert fails', async () => {
    mockSnapshotSingle.mockResolvedValue({ data: null, error: { message: 'unique constraint' } })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockPullMetrics).not.toHaveBeenCalled()
    expect(json.results[0].meta.success).toBe(false)
  })
})
