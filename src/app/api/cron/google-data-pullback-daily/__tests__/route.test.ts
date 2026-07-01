/**
 * google-data-pullback-daily cron route — integration tests
 *
 * Verifies the end-to-end shape of the daily Google data pullback:
 *   - Auth gate (CRON_SECRET) — 500 / 401 paths
 *   - Empty work map → success with zero counters
 *   - GA4-only client → fetchGa4Snapshot → ga4_traffic_snapshots upsert →
 *     Ga4Adapter.pullMetrics() called (writes flywheel_metrics)  [P22.A.2]
 *   - GA4 snapshot null path → ga4_synced=0 / failed=1
 *   - flywheel_metrics write failure stays non-fatal — snapshot still counted
 *
 * Heavily mocked: supabaseAdmin, fetchGscSnapshot, fetchGa4Snapshot,
 * Meta client helpers, Ga4Adapter, MetaAdsAdapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must be declared before any import that uses them) ────────────────

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
  getAdAccountInsights:  vi.fn().mockResolvedValue(null),
  getAdCampaignInsights: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/google-ads/client', () => ({
  fetchAccountInsights: vi.fn().mockResolvedValue(null),
  loadGoogleAdsCreds:   vi.fn().mockReturnValue(null),
}))

const mockGa4PullMetrics = vi.fn().mockResolvedValue([])
vi.mock('@/lib/flywheel/adapters/Ga4Adapter', () => ({
  Ga4Adapter: vi.fn().mockImplementation(() => ({
    pullMetrics: mockGa4PullMetrics,
  })),
}))

vi.mock('@/lib/flywheel/adapters/MetaAdsAdapter', () => ({
  MetaAdsAdapter: vi.fn().mockImplementation(() => ({
    pullMetrics: vi.fn().mockResolvedValue([]),
  })),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { fetchGa4Snapshot } from '@/lib/ga4/client'
import { fetchAccountInsights, loadGoogleAdsCreds } from '@/lib/google-ads/client'
import { GET } from '../route'

const mockFrom              = vi.mocked(supabaseAdmin.from)
const mockFetchGa4          = vi.mocked(fetchGa4Snapshot)
const mockFetchGoogleAds    = vi.mocked(fetchAccountInsights)
const mockLoadGoogleAdsCreds = vi.mocked(loadGoogleAdsCreds)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLIENT_ID   = 'client-uuid-ga4'
const PROPERTY_ID = '987654321'

const GA4_SNAPSHOT = {
  property_id:          PROPERTY_ID,
  period_start:         '2026-05-04',
  period_end:           '2026-06-01',
  total_sessions:       5400,
  total_users:          4100,
  total_new_users:      2100,
  total_pageviews:      14200,
  avg_session_duration: 132.4,
  bounce_rate:          0.41,
  top_pages:            [],
  top_sources:          [],
  synced_at:            '2026-06-01T03:00:00.000Z',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest(
    'http://localhost:3001/api/cron/google-data-pullback-daily',
    { method: 'GET', headers },
  )
}

/**
 * Build a Supabase mock that returns the supplied connector + meta +
 * google_ads rows from the parallel Promise.all in step 1 of the route.
 *
 * `googleAds` defaults to []; pass rows like { client_id, account_id } to
 * exercise the Google Ads sync arm. `googleAdsError` lets a test simulate a
 * connector-table failure (the route logs + degrades to empty, doesn't 500).
 */
function setupConnectorLoader(opts: {
  connectors:       Array<{ client_id: string; anchor: 'gsc' | 'ga4'; config: Record<string, unknown> | null }>
  meta:             Array<{ id: string; meta_ad_account_id: string }>
  googleAds?:       Array<{ client_id: string; account_id: string }>
  googleAdsError?:  { message: string } | null
}) {
  const googleAdsRows = opts.googleAds ?? []
  // client_connectors: from() → select() → in() → eq() → { data, error }
  const clientConnectorsChain = {
    select: vi.fn().mockReturnThis(),
    in:     vi.fn().mockReturnThis(),
    eq:     vi.fn().mockResolvedValue({ data: opts.connectors, error: null }),
  }
  // clients: from() → select() → not() → { data, error }
  const clientsChain = {
    select: vi.fn().mockReturnThis(),
    not:    vi.fn().mockResolvedValue({ data: opts.meta, error: null }),
  }
  // platform_oauth_connections: from() → select() → eq() → eq() → not() → { data, error }
  const platformOauthChain = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    not:    vi.fn().mockResolvedValue(
      opts.googleAdsError
        ? { data: null, error: opts.googleAdsError }
        : { data: googleAdsRows, error: null },
    ),
  }
  return { clientConnectorsChain, clientsChain, platformOauthChain }
}

/**
 * Build the chain Supabase uses for `.upsert().select('id').single()`.
 */
function makeUpsertChain(returnedId: string, withError: { message: string } | null = null) {
  return {
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(
          withError ? { data: null, error: withError } : { data: { id: returnedId }, error: null },
        ),
      }),
    }),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/cron/google-data-pullback-daily', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    mockGa4PullMetrics.mockResolvedValue([])
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeRequest({ authorization: 'Bearer anything' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET/)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when Authorization header is wrong', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer nope' }))
    expect(res.status).toBe(401)
  })

  // ── Empty work map ────────────────────────────────────────────────────────

  it('returns success with zero counters when no clients are connected', async () => {
    const { clientConnectorsChain, clientsChain, platformOauthChain } = setupConnectorLoader({
      connectors: [],
      meta:       [],
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors') return clientConnectorsChain as never
      if (table === 'clients')           return clientsChain           as never
      if (table === 'platform_oauth_connections') return platformOauthChain as never
      return {} as never
    })

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.clients_processed).toBe(0)
    expect(body.ga4_synced).toBe(0)
    expect(body.gsc_synced).toBe(0)
    expect(body.failed).toBe(0)
    expect(mockFetchGa4).not.toHaveBeenCalled()
    expect(mockGa4PullMetrics).not.toHaveBeenCalled()
  })

  // ── GA4 happy path ────────────────────────────────────────────────────────

  it('syncs GA4 snapshot and calls Ga4Adapter.pullMetrics to write flywheel_metrics [P22.A.2]', async () => {
    const { clientConnectorsChain, clientsChain, platformOauthChain } = setupConnectorLoader({
      connectors: [
        { client_id: CLIENT_ID, anchor: 'ga4', config: { property_id: PROPERTY_ID } },
      ],
      meta: [],
    })

    const ga4Upsert = makeUpsertChain('ga4-snap-1')

    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors')      return clientConnectorsChain as never
      if (table === 'clients')                return clientsChain           as never
      if (table === 'platform_oauth_connections') return platformOauthChain as never
      if (table === 'ga4_traffic_snapshots')  return ga4Upsert              as never
      return {} as never
    })

    mockFetchGa4.mockResolvedValue(GA4_SNAPSHOT)

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.clients_processed).toBe(1)
    expect(body.ga4_synced).toBe(1)
    expect(body.failed).toBe(0)
    expect(body.results[0]).toMatchObject({
      client_id: CLIENT_ID,
      ga4:       { success: true, snapshot_id: 'ga4-snap-1' },
    })

    // Snapshot upserted with correct payload
    expect(ga4Upsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id:       CLIENT_ID,
        property_id:     PROPERTY_ID,
        total_sessions:  GA4_SNAPSHOT.total_sessions,
        total_users:     GA4_SNAPSHOT.total_users,
        bounce_rate:     GA4_SNAPSHOT.bounce_rate,
      }),
      expect.objectContaining({ onConflict: 'client_id,period_start,period_end' }),
    )

    // Ga4Adapter.pullMetrics called with client id — this is what writes flywheel_metrics
    expect(mockGa4PullMetrics).toHaveBeenCalledTimes(1)
    expect(mockGa4PullMetrics).toHaveBeenCalledWith(CLIENT_ID)
  })

  // ── GA4 null snapshot ─────────────────────────────────────────────────────

  it('marks GA4 as failed when fetchGa4Snapshot returns null', async () => {
    const { clientConnectorsChain, clientsChain, platformOauthChain } = setupConnectorLoader({
      connectors: [
        { client_id: CLIENT_ID, anchor: 'ga4', config: { property_id: PROPERTY_ID } },
      ],
      meta: [],
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors') return clientConnectorsChain as never
      if (table === 'clients')           return clientsChain           as never
      if (table === 'platform_oauth_connections') return platformOauthChain as never
      return {} as never
    })

    mockFetchGa4.mockResolvedValue(null)

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.ga4_synced).toBe(0)
    expect(body.failed).toBe(1)
    expect(body.results[0].ga4).toMatchObject({
      success: false,
      error:   expect.stringContaining('fetchGa4Snapshot returned null'),
    })
    expect(mockGa4PullMetrics).not.toHaveBeenCalled()
  })

  // ── flywheel_metrics non-fatal ────────────────────────────────────────────

  it('keeps ga4_synced=1 even when Ga4Adapter.pullMetrics rejects (non-fatal)', async () => {
    const { clientConnectorsChain, clientsChain, platformOauthChain } = setupConnectorLoader({
      connectors: [
        { client_id: CLIENT_ID, anchor: 'ga4', config: { property_id: PROPERTY_ID } },
      ],
      meta: [],
    })

    const ga4Upsert = makeUpsertChain('ga4-snap-2')

    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors')      return clientConnectorsChain as never
      if (table === 'clients')                return clientsChain           as never
      if (table === 'platform_oauth_connections') return platformOauthChain as never
      if (table === 'ga4_traffic_snapshots')  return ga4Upsert              as never
      return {} as never
    })

    mockFetchGa4.mockResolvedValue(GA4_SNAPSHOT)
    mockGa4PullMetrics.mockRejectedValueOnce(new Error('flywheel_metrics insert failed'))

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    // Snapshot upsert succeeded, so success=true even though metrics insert failed
    expect(body.ga4_synced).toBe(1)
    expect(body.failed).toBe(0)
    expect(body.results[0].ga4).toMatchObject({ success: true, snapshot_id: 'ga4-snap-2' })

    // pullMetrics was attempted (and rejected, swallowed by .catch())
    expect(mockGa4PullMetrics).toHaveBeenCalledTimes(1)
  })

  // ── Bad config skips client ───────────────────────────────────────────────

  it('skips GA4 connector whose config has no property_id', async () => {
    const { clientConnectorsChain, clientsChain, platformOauthChain } = setupConnectorLoader({
      connectors: [
        { client_id: CLIENT_ID, anchor: 'ga4', config: {} }, // no property_id
      ],
      meta: [],
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors') return clientConnectorsChain as never
      if (table === 'clients')           return clientsChain           as never
      if (table === 'platform_oauth_connections') return platformOauthChain as never
      return {} as never
    })

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.clients_processed).toBe(0)
    expect(body.ga4_synced).toBe(0)
    expect(mockFetchGa4).not.toHaveBeenCalled()
  })

  // ── Google Ads sync arm ───────────────────────────────────────────────────

  it('syncs Google Ads aggregate metrics and inserts 7 rows into flywheel_metrics [P18.B.1]', async () => {
    const GA_CLIENT  = 'client-uuid-google-ads'
    const CUSTOMER_ID = '9876543210'

    const { clientConnectorsChain, clientsChain, platformOauthChain } = setupConnectorLoader({
      connectors: [],
      meta:       [],
      googleAds:  [{ client_id: GA_CLIENT, account_id: CUSTOMER_ID }],
    })

    // flywheel_metrics chain: delete().eq().eq().in().gte().lte() (thenable) +
    // insert() → resolves { error: null }
    const fwInsert = vi.fn().mockResolvedValue({ error: null })
    const fwDelete = {
      delete: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      in:     vi.fn().mockReturnThis(),
      gte:    vi.fn().mockReturnThis(),
      lte:    vi.fn().mockReturnThis(),
      // .then() makes the chain awaitable for the delete arm
      then:   (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      insert: fwInsert,
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors')          return clientConnectorsChain as never
      if (table === 'clients')                    return clientsChain           as never
      if (table === 'platform_oauth_connections') return platformOauthChain    as never
      if (table === 'flywheel_metrics')           return fwDelete               as never
      return {} as never
    })

    mockLoadGoogleAdsCreds.mockReturnValue({
      developerToken: 'dt',
      clientId:       'cid',
      clientSecret:   'cs',
      refreshToken:   'rt',
      customerId:     CUSTOMER_ID,
    })

    mockFetchGoogleAds.mockResolvedValue({
      period_start: '2026-05-17',
      period_end:   '2026-06-16',
      spend:        420.50,
      impressions:  120000,
      clicks:       3400,
      ctr:          0.028,
      cpc:          0.124,
      conversions:  45,
      cpa:          9.34,
    })

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.clients_processed).toBe(1)
    expect(body.google_ads_synced).toBe(1)
    expect(body.failed).toBe(0)
    expect(body.results[0]).toMatchObject({
      client_id:  GA_CLIENT,
      google_ads: { success: true, metrics_written: 7 },
    })

    // Insert was called with one row per metric_key in ADS_METRIC_KEY (7 total),
    // all stamped with the google_ads_pullback source so per-vendor filtering
    // stays possible when a client has Meta + Google Ads side by side.
    expect(fwInsert).toHaveBeenCalledTimes(1)
    const insertArg = fwInsert.mock.calls[0][0]
    expect(insertArg).toHaveLength(7)
    for (const row of insertArg) {
      expect(row).toMatchObject({
        client_id: GA_CLIENT,
        flywheel:  'ads',
        source:    'google_ads_pullback',
      })
      expect(row.source_ref).toMatchObject({
        customer_id:  CUSTOMER_ID,
        period_start: '2026-05-17',
        period_end:   '2026-06-16',
      })
    }
    // Loader was given the customer_id from platform_oauth_connections
    expect(mockLoadGoogleAdsCreds).toHaveBeenCalledWith(CUSTOMER_ID)
  })

  it('marks Google Ads sync failed when env vars are missing (loadGoogleAdsCreds → null)', async () => {
    const GA_CLIENT  = 'client-uuid-ga-no-env'
    const CUSTOMER_ID = '1111111111'

    const { clientConnectorsChain, clientsChain, platformOauthChain } = setupConnectorLoader({
      connectors: [],
      meta:       [],
      googleAds:  [{ client_id: GA_CLIENT, account_id: CUSTOMER_ID }],
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors')          return clientConnectorsChain as never
      if (table === 'clients')                    return clientsChain           as never
      if (table === 'platform_oauth_connections') return platformOauthChain    as never
      return {} as never
    })

    mockLoadGoogleAdsCreds.mockReturnValue(null) // env vars missing

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.google_ads_synced).toBe(0)
    expect(body.failed).toBe(1)
    expect(body.results[0].google_ads).toMatchObject({
      success: false,
      error:   expect.stringMatching(/GOOGLE_ADS_\*.*env vars missing/i),
    })
    expect(mockFetchGoogleAds).not.toHaveBeenCalled()
  })

  it('marks Google Ads sync failed when fetchAccountInsights returns null (token unapproved / bad customer_id)', async () => {
    const GA_CLIENT  = 'client-uuid-ga-null-insights'
    const CUSTOMER_ID = '2222222222'

    const { clientConnectorsChain, clientsChain, platformOauthChain } = setupConnectorLoader({
      connectors: [],
      meta:       [],
      googleAds:  [{ client_id: GA_CLIENT, account_id: CUSTOMER_ID }],
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors')          return clientConnectorsChain as never
      if (table === 'clients')                    return clientsChain           as never
      if (table === 'platform_oauth_connections') return platformOauthChain    as never
      return {} as never
    })

    mockLoadGoogleAdsCreds.mockReturnValue({
      developerToken: 'dt', clientId: 'cid', clientSecret: 'cs',
      refreshToken: 'rt', customerId: CUSTOMER_ID,
    })
    mockFetchGoogleAds.mockResolvedValue(null)

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.google_ads_synced).toBe(0)
    expect(body.failed).toBe(1)
    expect(body.results[0].google_ads).toMatchObject({
      success: false,
      error:   expect.stringMatching(/fetchAccountInsights returned null/),
    })
  })

  it('degrades gracefully when the platform_oauth_connections lookup itself errors (no 500)', async () => {
    const { clientConnectorsChain, clientsChain, platformOauthChain } = setupConnectorLoader({
      connectors:      [],
      meta:            [],
      googleAdsError:  { message: 'permission denied' },
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'client_connectors')          return clientConnectorsChain as never
      if (table === 'clients')                    return clientsChain           as never
      if (table === 'platform_oauth_connections') return platformOauthChain    as never
      return {} as never
    })

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // The whole cron still succeeds; Google Ads arm contributes 0 work.
    expect(body.success).toBe(true)
    expect(body.google_ads_synced).toBe(0)
    expect(mockFetchGoogleAds).not.toHaveBeenCalled()
  })
})
