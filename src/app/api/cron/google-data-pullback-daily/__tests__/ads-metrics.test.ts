/**
 * google-data-pullback-daily — ads metric pull.
 *
 * Covers the fix (objective-aware Meta cost metrics now reach flywheel_metrics)
 * AND the regression it must not cause: the eight metrics that already worked —
 * spend / impressions / clicks / ctr / cpc + conversions + cpa from the Google
 * Ads arm, and the three GA4 paid-search keys — keep being written exactly as
 * before.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn().mockResolvedValue({ finish: vi.fn().mockResolvedValue(undefined) }),
}))

vi.mock('@/lib/gsc/client', () => ({ fetchGscSnapshot: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/ga4/client', () => ({
  fetchGa4Snapshot:          vi.fn().mockResolvedValue(null),
  fetchGa4PaidSearchMetrics: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/meta/client', () => ({
  getAdAccountInsights:  vi.fn().mockResolvedValue(null),
  getAdCampaignInsights: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/google-ads/client', () => ({
  fetchAccountInsights: vi.fn().mockResolvedValue(null),
  loadGoogleAdsCreds:   vi.fn().mockReturnValue(null),
}))

const mockMetaPullMetrics = vi.fn().mockResolvedValue([])
vi.mock('@/lib/flywheel/adapters/MetaAdsAdapter', () => ({
  MetaAdsAdapter: vi.fn().mockImplementation(() => ({ pullMetrics: mockMetaPullMetrics })),
}))

vi.mock('@/lib/ads-strategy/daily-insights', () => ({
  syncAdDailyInsights:       vi.fn().mockResolvedValue({ success: true, rows_written: 0 }),
  syncCampaignDailyInsights: vi.fn().mockResolvedValue({ success: true, rows_written: 0 }),
}))
vi.mock('@/lib/ads-strategy/evaluate', () => ({ evaluateClientAdHealth: vi.fn() }))
vi.mock('@/lib/ads-strategy/digest', () => ({ sendAdHealthDigest: vi.fn() }))
vi.mock('@/lib/ads-strategy/config', () => ({
  // Ad Strategy Engine off: this suite is about the metric pull, and leaving it
  // on would drag the whole campaign-series path into every assertion.
  loadAdStrategyConfigWithSource: vi.fn().mockResolvedValue({
    config: { enabled: false }, source: 'default',
  }),
  resolveDigestRecipients: vi.fn().mockReturnValue([]),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { getAdAccountInsights } from '@/lib/meta/client'
import { fetchGa4Snapshot, fetchGa4PaidSearchMetrics } from '@/lib/ga4/client'
import { fetchAccountInsights, loadGoogleAdsCreds } from '@/lib/google-ads/client'
import { ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { GET } from '../route'

const mockFrom            = vi.mocked(supabaseAdmin.from)
const mockMetaInsights    = vi.mocked(getAdAccountInsights)
const mockGa4Snapshot     = vi.mocked(fetchGa4Snapshot)
const mockGa4Paid         = vi.mocked(fetchGa4PaidSearchMetrics)
const mockGoogleInsights  = vi.mocked(fetchAccountInsights)
const mockGoogleCreds     = vi.mocked(loadGoogleAdsCreds)

// ── Harness ───────────────────────────────────────────────────────────────────

interface MetricRow {
  metric_key: string
  metric_value: number | null
  source: string
  client_id: string
  flywheel: string
}

/** Collects every flywheel_metrics insert the run performs. */
function setupSupabase(opts: {
  meta?:      Array<{ id: string; name: string; domain: string | null; meta_ad_account_id: string }>
  connectors?: Array<{ client_id: string; anchor: 'gsc' | 'ga4'; config: Record<string, unknown> }>
  googleAds?: Array<{ client_id: string; account_id: string }>
}) {
  const inserted: MetricRow[][] = []

  const thenable = <T,>(value: T) => ({
    then: (resolve: (v: T) => unknown) => Promise.resolve(resolve(value)),
  })

  const metricsChain = {
    delete: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    in:     vi.fn().mockReturnThis(),
    gte:    vi.fn().mockReturnThis(),
    lte:    vi.fn().mockReturnThis(),
    ...thenable({ error: null }),
    insert: vi.fn().mockImplementation((rows: MetricRow[]) => {
      inserted.push(rows)
      return Promise.resolve({ error: null })
    }),
  }

  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case 'client_connectors':
        return {
          select: vi.fn().mockReturnThis(),
          in:     vi.fn().mockReturnThis(),
          eq:     vi.fn().mockResolvedValue({ data: opts.connectors ?? [], error: null }),
        } as never
      case 'clients':
        return {
          select: vi.fn().mockReturnThis(),
          not:    vi.fn().mockResolvedValue({ data: opts.meta ?? [], error: null }),
        } as never
      case 'platform_oauth_connections':
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          not:    vi.fn().mockResolvedValue({ data: opts.googleAds ?? [], error: null }),
        } as never
      case 'meta_ads_snapshots':
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'snap-1' }, error: null }),
            }),
          }),
        } as never
      case 'ga4_traffic_snapshots':
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'ga4-1' }, error: null }),
            }),
          }),
        } as never
      case 'flywheel_metrics':
        return metricsChain as never
      default:
        return {} as never
    }
  })

  return { inserted, metricsChain }
}

const run = () =>
  GET(new NextRequest('http://localhost:3001/api/cron/google-data-pullback-daily', {
    method: 'GET',
    headers: { authorization: 'Bearer test-secret' },
  }))

const flatten = (batches: MetricRow[][]) => batches.flat()
const keysFrom = (batches: MetricRow[][], source: string) =>
  flatten(batches).filter(r => r.source === source).map(r => r.metric_key)

const META_CLIENT = {
  id: 'client-meta', name: 'Kiteroa', domain: null, meta_ad_account_id: 'act_999',
}

/** A click-to-Messenger account: conversations only, no purchase anywhere. */
const MESSENGER_INSIGHTS = {
  spend: 480.5, impressions: 91000, clicks: 1320,
  conversions: null, roas: null, cpc: 0.364, ctr: 0.0145,
  cpa: null, cost_per_lead: null, cost_per_conversation: 6.1,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
  process.env.META_SYSTEM_USER_TOKEN = 'meta-token'
  mockMetaPullMetrics.mockResolvedValue([])
})

// ── The fix ───────────────────────────────────────────────────────────────────

describe('Meta objective-aware cost metrics', () => {
  it('writes cost per conversation for a Messenger account that has no ROAS', async () => {
    const { inserted } = setupSupabase({ meta: [META_CLIENT] })
    mockMetaInsights.mockResolvedValue(MESSENGER_INSIGHTS)

    expect((await run()).status).toBe(200)

    const rows = flatten(inserted).filter(r => r.source === 'meta_ads_pullback')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      client_id:    META_CLIENT.id,
      flywheel:     'ads',
      metric_key:   ADS_METRIC_KEY.COST_PER_CONVERSATION,
      metric_value: 6.1,
      source:       'meta_ads_pullback',
    })
  })

  it('does NOT invent a zero for the costs Meta never reported', async () => {
    const { inserted } = setupSupabase({ meta: [META_CLIENT] })
    mockMetaInsights.mockResolvedValue(MESSENGER_INSIGHTS)
    await run()

    const keys = keysFrom(inserted, 'meta_ads_pullback')
    expect(keys).not.toContain(ADS_METRIC_KEY.CPA)
    expect(keys).not.toContain(ADS_METRIC_KEY.COST_PER_LEAD)
  })

  it('writes all three costs for an account that reports all three', async () => {
    const { inserted } = setupSupabase({ meta: [META_CLIENT] })
    mockMetaInsights.mockResolvedValue({
      ...MESSENGER_INSIGHTS, cpa: 31.2, cost_per_lead: 8.4, cost_per_conversation: 4.35,
    })
    await run()

    expect(keysFrom(inserted, 'meta_ads_pullback').sort()).toEqual([
      ADS_METRIC_KEY.COST_PER_CONVERSATION,
      ADS_METRIC_KEY.COST_PER_LEAD,
      ADS_METRIC_KEY.CPA,
    ].sort())
  })

  it('writes nothing at all when the account reports no outcome cost', async () => {
    const { inserted } = setupSupabase({ meta: [META_CLIENT] })
    mockMetaInsights.mockResolvedValue({
      ...MESSENGER_INSIGHTS, cpa: null, cost_per_lead: null, cost_per_conversation: null,
    })
    await run()
    expect(keysFrom(inserted, 'meta_ads_pullback')).toEqual([])
  })

  it('stamps the ad account and period so a row is traceable', async () => {
    const { inserted } = setupSupabase({ meta: [META_CLIENT] })
    mockMetaInsights.mockResolvedValue(MESSENGER_INSIGHTS)
    await run()

    const row = flatten(inserted).find(r => r.source === 'meta_ads_pullback') as
      MetricRow & { source_ref: { ad_account_id: string } }
    expect(row.source_ref.ad_account_id).toBe('act_999')
  })
})

// ── Regression: the metrics that already worked ───────────────────────────────

describe('regression — existing ads metric pulls are untouched', () => {
  it('still delegates the seven Meta snapshot metrics to MetaAdsAdapter', async () => {
    setupSupabase({ meta: [META_CLIENT] })
    mockMetaInsights.mockResolvedValue(MESSENGER_INSIGHTS)

    const res = await run()
    expect((await res.json()).meta_synced).toBe(1)
    // spend / impressions / clicks / cpc / ctr / roas / conversions all come
    // from this call — the new write must not have replaced or bypassed it.
    expect(mockMetaPullMetrics).toHaveBeenCalledTimes(1)
    expect(mockMetaPullMetrics).toHaveBeenCalledWith(META_CLIENT.id)
  })

  it('keeps meta_synced=1 when the new objective-metric write fails', async () => {
    const { metricsChain } = setupSupabase({ meta: [META_CLIENT] })
    metricsChain.insert.mockRejectedValue(new Error('flywheel_metrics down'))
    mockMetaInsights.mockResolvedValue(MESSENGER_INSIGHTS)

    const body = await (await run()).json()
    expect(body.meta_synced).toBe(1)
    expect(body.failed).toBe(0)
  })

  it('still writes exactly the seven Google Ads account metrics', async () => {
    const { inserted } = setupSupabase({
      googleAds: [{ client_id: 'client-g', account_id: '777' }],
    })
    mockGoogleCreds.mockReturnValue({
      developerToken: 'dt', clientId: 'cid', clientSecret: 'cs',
      refreshToken: 'rt', customerId: '777',
    })
    mockGoogleInsights.mockResolvedValue({
      period_start: '2026-07-02', period_end: '2026-08-01',
      spend: 420.5, impressions: 120000, clicks: 3400,
      ctr: 0.028, cpc: 0.124, conversions: 45, cpa: 9.34,
    })

    const body = await (await run()).json()
    expect(body.google_ads_synced).toBe(1)
    expect(body.results[0].google_ads).toMatchObject({ success: true, metrics_written: 7 })

    expect(keysFrom(inserted, 'google_ads_pullback').sort()).toEqual([
      ADS_METRIC_KEY.CLICKS,
      ADS_METRIC_KEY.CONVERSIONS,
      ADS_METRIC_KEY.CPA,
      ADS_METRIC_KEY.CPC,
      ADS_METRIC_KEY.CTR,
      ADS_METRIC_KEY.IMPRESSIONS,
      ADS_METRIC_KEY.SPEND,
    ].sort())
  })

  it('still writes the three GA4 paid-search metrics', async () => {
    const { inserted } = setupSupabase({
      connectors: [{ client_id: 'client-ga4', anchor: 'ga4', config: { property_id: '123' } }],
    })
    mockGa4Snapshot.mockResolvedValue({
      property_id: '123', period_start: '2026-07-04', period_end: '2026-08-01',
      total_sessions: 5400, total_users: 4100, total_new_users: 2100,
      total_pageviews: 14200, avg_session_duration: 132.4, bounce_rate: 0.41,
      top_pages: [], top_sources: [], synced_at: '2026-08-01T03:00:00.000Z',
    })
    mockGa4Paid.mockResolvedValue({
      paid_sessions: 310, paid_users: 260, paid_conversions: 12,
      period_start: '2026-07-04', period_end: '2026-08-01',
    })

    await run()
    expect(keysFrom(inserted, 'ga4_paid_search_pullback').sort()).toEqual([
      ADS_METRIC_KEY.GA4_PAID_CONVERSIONS,
      ADS_METRIC_KEY.GA4_PAID_SESSIONS,
      ADS_METRIC_KEY.GA4_PAID_USERS,
    ].sort())
  })
})
