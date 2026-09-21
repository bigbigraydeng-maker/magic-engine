/**
 * Tests for google-data-pullback-daily cron — P22.A.5
 *
 * Focuses on the MetaAdsAdapter.pullMetrics() integration added in P22.A.5.
 * Mocks supabaseAdmin, Meta API clients, GSC/GA4 fetchers, and MetaAdsAdapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
// `mockCronFinish` is hoisted out so tests can assert on what actually got
// written into cron_run_logs.summary (e.g. whether a secondary-account
// failure made it into `errors`), not just on the HTTP response shape.
const { mockCronFinish } = vi.hoisted(() => ({ mockCronFinish: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn().mockResolvedValue({ finish: mockCronFinish }),
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

const mockLoadAdStrategyConfigWithSource = vi.fn().mockResolvedValue({
  config: { enabled: false }, source: 'default',
})
vi.mock('@/lib/ads-strategy/config', () => ({
  loadAdStrategyConfigWithSource: (...args: unknown[]) => mockLoadAdStrategyConfigWithSource(...args),
  resolveDigestRecipients: vi.fn().mockReturnValue([]),
}))
const mockSyncAdDailyInsights = vi.fn().mockResolvedValue({ success: true, rows_written: 0 })
const mockSyncCampaignDailyInsights = vi.fn().mockResolvedValue({ success: true, rows_written: 0 })
const mockSyncAdsetDailyInsights = vi.fn().mockResolvedValue({ success: true, rows_written: 0 })
const mockHasVideoColumns = vi.fn().mockResolvedValue(false)
vi.mock('@/lib/ads-strategy/daily-insights', () => ({
  syncAdDailyInsights:       (...args: unknown[]) => mockSyncAdDailyInsights(...args),
  syncCampaignDailyInsights: (...args: unknown[]) => mockSyncCampaignDailyInsights(...args),
  syncAdsetDailyInsights:    (...args: unknown[]) => mockSyncAdsetDailyInsights(...args),
  hasVideoColumns:           () => mockHasVideoColumns(),
}))
vi.mock('@/lib/ads-strategy/evaluate', () => ({ evaluateClientAdHealth: vi.fn() }))
vi.mock('@/lib/ads-strategy/digest', () => ({ sendAdHealthDigest: vi.fn() }))
const mockSnapshotTablesExist = vi.fn().mockResolvedValue(false)
const mockRunPortfolioDiagnostics = vi.fn().mockResolvedValue({ success: true, hits: 1, not_comparable: 0, excluded: 0, digest_decision: 'alert', digest_sent: true, recipients_dropped: 0 })
vi.mock('@/lib/ads-strategy/portfolio/snapshot-sync', () => ({ snapshotTablesExist: () => mockSnapshotTablesExist() }))
vi.mock('@/lib/ads-strategy/portfolio/run-daily', () => ({ runPortfolioDiagnostics: (...a: unknown[]) => mockRunPortfolioDiagnostics(...a) }))

// ── Mock multi-account lookup (2026-09-13) ───────────────────────────────────
// Defaults to just the primary account — every existing test above this line
// keeps its original single-account behavior untouched.
const mockGetClientAdAccountIds = vi.fn().mockResolvedValue([])
const mockFindSharedAdAccounts = vi.fn().mockResolvedValue({ shared: new Set<string>() })
vi.mock('@/lib/meta/client-ad-accounts', () => ({
  getClientAdAccountIds: (...args: unknown[]) => mockGetClientAdAccountIds(...args),
  findSharedAdAccounts: (...args: unknown[]) => mockFindSharedAdAccounts(...args),
}))

// ── Mock Meta token resolution (AD-SEC-4 follow-up, 2026-09-21) ─────────────
// resolveMetaTokenDetailed is called with THIS route's own (mocked) supabaseAdmin,
// but its query shape (`.select().eq().maybeSingle()`) differs from the
// `metaResult` query's (`.select().not()`) on the same 'clients' table above —
// mocking the function directly is simpler than teaching one fake `clients`
// handler to serve both shapes. Defaults to the pre-existing behavior every
// test above this line relies on: no domain/Page scoped token configured, so
// the route falls to the shared META_SYSTEM_USER_TOKEN, exactly like
// resolveMetaTokenDetailed itself would with an empty `clients` row.
// ownsKey's real ownership logic is kept (only loadTokenOwnerPeers, the one
// I/O call, is mocked) so the legacy-name-token tests below exercise the
// actual gate, not a stand-in for it.
const mockResolveMetaTokenDetailed = vi.fn()
const mockLoadTokenOwnerPeers = vi.fn().mockResolvedValue(null)
vi.mock('@/lib/meta/token-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta/token-selection')>()
  return {
    ...actual,
    resolveMetaTokenDetailed: (...args: unknown[]) => mockResolveMetaTokenDetailed(...args),
    loadTokenOwnerPeers: (...args: unknown[]) => mockLoadTokenOwnerPeers(...args),
  }
})

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

    // Default: no scoped (domain/Page) token configured — mirrors a `clients` row
    // with no domain, which is what mockMetaClientsResult returns by default.
    mockResolveMetaTokenDetailed.mockImplementation(async () =>
      process.env.META_SYSTEM_USER_TOKEN
        ? { token: process.env.META_SYSTEM_USER_TOKEN, source: 'shared_fallback' as const }
        : null,
    )
    mockLoadTokenOwnerPeers.mockResolvedValue(null)
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

// ── AD-SEC-4 follow-up (2026-09-21): legacy per-name token is ownership-gated ──
// `clients.name` is self-serve-writable and not unique (docs/DECISIONS.md), so
// the raw `${slug}_META_SYSTEM_USER_TOKEN` fallback must not be handed out on
// name alone — only to this name's earliest non-self-serve owner, same rule as
// the domain-scoped token in token-selection.ts.
describe('legacy per-name Meta token — ownership gate', () => {
  const NAME = 'Kiteroa'
  const SLUG_ENV = 'KITEROA_META_SYSTEM_USER_TOKEN'
  const LEGACY_TOKEN = 'legacy-name-token'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    delete process.env.META_SYSTEM_USER_TOKEN
    process.env[SLUG_ENV] = LEGACY_TOKEN

    mockConnectorsResult.mockResolvedValue({ data: [], error: null })
    mockMetaClientsResult.mockResolvedValue({
      data: [{ id: CLIENT_ID, name: NAME, meta_ad_account_id: AD_ACCOUNT }],
      error: null,
    })
    mockGetAdAccountInsights.mockResolvedValue(MOCK_INSIGHTS)
    mockGetAdCampaignInsights.mockResolvedValue([])
    mockSnapshotSingle.mockResolvedValue({ data: { id: 'snap-001' }, error: null })

    mockResolveMetaTokenDetailed.mockResolvedValue(null)
    mockLoadTokenOwnerPeers.mockResolvedValue(null)
  })

  afterEach(() => {
    delete process.env[SLUG_ENV]
  })

  it('never used when a domain-scoped token already resolved', async () => {
    mockResolveMetaTokenDetailed.mockResolvedValue({ token: 'domain-token', source: 'client_domain' })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(mockPullMetrics).toHaveBeenCalledOnce()
    expect(mockGetAdAccountInsights).toHaveBeenCalledWith(AD_ACCOUNT, 'domain-token', expect.any(String), expect.any(String))
  })

  // Peers are now loaded once up front for every client with a Meta ad account
  // (2026-09-21 perf fix, chatgpt-codex-connector review) — reused by BOTH the
  // domain/Page ownership check inside resolveMetaTokenDetailed and the legacy
  // check below, rather than each scoped-token client re-scanning `clients`.
  it('loads the ownership snapshot once per run and passes it into resolveMetaTokenDetailed', async () => {
    mockResolveMetaTokenDetailed.mockResolvedValue({ token: 'domain-token', source: 'client_domain' })
    mockLoadTokenOwnerPeers.mockResolvedValue([])

    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))

    expect(mockLoadTokenOwnerPeers).toHaveBeenCalledOnce()
    expect(mockResolveMetaTokenDetailed).toHaveBeenCalledWith(expect.anything(), CLIENT_ID, expect.anything(), [])
  })

  // claude[bot] auto-fix review (2026-09-21): a Page-scoped token's identity
  // isn't guaranteed to have ads_management on this client's ad account, so it
  // must not preempt an owned legacy per-name token — only the domain-scoped
  // token (the most specific, most likely to work) short-circuits before it.
  it('a Page-scoped token does not preempt an owned legacy per-name token', async () => {
    mockResolveMetaTokenDetailed.mockResolvedValue({ token: 'page-token', source: 'client_page' })
    mockLoadTokenOwnerPeers.mockResolvedValue([
      { id: CLIENT_ID, name: NAME, domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' },
    ])

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(mockPullMetrics).toHaveBeenCalledOnce()
    expect(mockGetAdAccountInsights).toHaveBeenCalledWith(AD_ACCOUNT, LEGACY_TOKEN, expect.any(String), expect.any(String))
  })

  it('falls back to the Page-scoped token when this client does not own the legacy name', async () => {
    mockResolveMetaTokenDetailed.mockResolvedValue({ token: 'page-token', source: 'client_page' })
    mockLoadTokenOwnerPeers.mockResolvedValue([
      { id: CLIENT_ID, name: NAME, domain: null, facebook_page_id: null, created_at: '2026-09-01T00:00:00Z', source: 'fde' },
      { id: 'other-client', name: NAME, domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' },
    ])

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(mockPullMetrics).toHaveBeenCalledOnce()
    expect(mockGetAdAccountInsights).toHaveBeenCalledWith(AD_ACCOUNT, 'page-token', expect.any(String), expect.any(String))
  })

  it('refused when the client itself is self-serve, even as the only holder of the name', async () => {
    mockLoadTokenOwnerPeers.mockResolvedValue([
      { id: CLIENT_ID, name: NAME, domain: null, facebook_page_id: null, created_at: '2020-01-01T00:00:00Z', source: 'self_serve' },
    ])

    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))

    expect(mockPullMetrics).not.toHaveBeenCalled()
  })

  it('refused when an older staff-created client already carries the same name', async () => {
    mockLoadTokenOwnerPeers.mockResolvedValue([
      { id: CLIENT_ID, name: NAME, domain: null, facebook_page_id: null, created_at: '2026-09-01T00:00:00Z', source: 'fde' },
      { id: 'other-client', name: NAME, domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' },
    ])

    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))

    expect(mockPullMetrics).not.toHaveBeenCalled()
  })

  it('refused when the peer read fails — ownership unknown must not default to trusting the name', async () => {
    mockLoadTokenOwnerPeers.mockResolvedValue(null)

    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))

    expect(mockPullMetrics).not.toHaveBeenCalled()
  })

  // chatgpt-codex-connector review (2026-09-21): a failed peer read must not
  // fall through to a shared-fallback token that is "known" not to have access
  // to this client's ad account — same fail-closed rule as
  // resolveMetaTokenDetailed's own ownership_unknown, applied to the SEPARATE
  // peer scan the legacy-name check does.
  it('refused (not the shared fallback) when the peer read fails, even though a shared token is configured', async () => {
    mockResolveMetaTokenDetailed.mockResolvedValue({ token: 'global-fallback-token', source: 'shared_fallback' })
    mockLoadTokenOwnerPeers.mockResolvedValue(null)

    const { GET } = await import('./route')
    const json = await (await GET(makeRequest(CRON_SECRET))).json()

    expect(mockPullMetrics).not.toHaveBeenCalled()
    expect(json.failed).toBe(1)
    expect(json.results[0].meta.error).toMatch(/peer-scan/i)
  })

  it('used when this client is the earliest non-self-serve owner of the name', async () => {
    mockLoadTokenOwnerPeers.mockResolvedValue([
      { id: CLIENT_ID, name: NAME, domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' },
      { id: 'newer-copy', name: NAME, domain: null, facebook_page_id: null, created_at: '2026-09-01T00:00:00Z', source: 'self_serve' },
    ])

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(mockPullMetrics).toHaveBeenCalledOnce()
  })

  // 子牙 architecture review (2026-09-21): the first draft of this fix let
  // resolveMetaTokenForClient's OWN shared-fallback token preempt the legacy
  // per-name check — silently reintroducing the exact 2026-07-24 CTS failure
  // mode (global token can't see a specific ad account) for whichever client
  // still relies on its per-name token, the moment any global token exists.
  it('prefers the owned legacy per-name token over resolveMetaTokenForClient’s shared global fallback', async () => {
    mockResolveMetaTokenDetailed.mockResolvedValue({ token: 'global-fallback-token', source: 'shared_fallback' })
    mockLoadTokenOwnerPeers.mockResolvedValue([
      { id: CLIENT_ID, name: NAME, domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' },
    ])

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(mockPullMetrics).toHaveBeenCalledOnce()
    expect(mockGetAdAccountInsights).toHaveBeenCalledWith(AD_ACCOUNT, 'legacy-name-token', expect.any(String), expect.any(String))
  })

  it('falls back to the shared global token when this client does not own the name', async () => {
    mockResolveMetaTokenDetailed.mockResolvedValue({ token: 'global-fallback-token', source: 'shared_fallback' })
    mockLoadTokenOwnerPeers.mockResolvedValue([
      { id: CLIENT_ID, name: NAME, domain: null, facebook_page_id: null, created_at: '2026-09-01T00:00:00Z', source: 'fde' },
      { id: 'other-client', name: NAME, domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' },
    ])

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(mockPullMetrics).toHaveBeenCalledOnce()
    expect(mockGetAdAccountInsights).toHaveBeenCalledWith(AD_ACCOUNT, 'global-fallback-token', expect.any(String), expect.any(String))
  })

  // 魏征 review (2026-09-21): `slug` (used to look up the env var) comes from
  // the `metaResult` row read at the top of the run; `peers` (used to verify
  // ownership) is a SEPARATE, lazily-loaded read that can land later in this
  // up-to-15-minute cron. An ordinary rename in between must not let this
  // client "own" a key it was never granted, just because ownsKey ends up
  // checking the client's NEW name instead of the name `legacyToken` was
  // actually looked up with.
  it('checks ownership of the SAME key the legacy token was looked up with, not whatever name the peer read landed on', async () => {
    mockMetaClientsResult.mockResolvedValue({
      // T0: client is still named "Kiteroa" when the top-level query runs —
      // this is what produces `slug` and thus `legacyToken`.
      data: [{ id: CLIENT_ID, name: NAME, meta_ad_account_id: AD_ACCOUNT }],
      error: null,
    })
    mockLoadTokenOwnerPeers.mockResolvedValue([
      // T1: by the time the peer read lands, staff has renamed this client —
      // its OWN row now disagrees with the `name` the top-level query saw.
      { id: CLIENT_ID, name: 'Kiteroa NZ', domain: null, facebook_page_id: null, created_at: '2026-09-01T00:00:00Z', source: 'fde' },
      // An older client genuinely owns the ORIGINAL name's key.
      { id: 'real-owner', name: NAME, domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' },
    ])

    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))

    // Must be refused: KITEROA_META_SYSTEM_USER_TOKEN belongs to `real-owner`,
    // not this client — checking the post-rename "KITEROA_NZ" key instead
    // would wrongly let it through.
    expect(mockPullMetrics).not.toHaveBeenCalled()
  })
})

// ── Observability (chatgpt-codex-connector review on this PR, 2026-09-21) ────
// Every reason this client ends up with no usable Meta token must be a
// COUNTED failure (`failed` incremented, message in `errors`) — not a client
// that silently vanishes from the run's snapshot/ad_daily/health/digest chain
// while the cron itself still reports success. This matters most for
// ownership_unknown: that state means "we couldn't verify who owns the key",
// a transient DB read blip, not "nobody configured a token" — exactly the
// scenario that would otherwise go completely unnoticed.
describe('no Meta token → counted failure, not a silent skip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    delete process.env.META_SYSTEM_USER_TOKEN
    mockConnectorsResult.mockResolvedValue({ data: [], error: null })
    mockMetaClientsResult.mockResolvedValue({
      data: [{ id: CLIENT_ID, name: 'Kiteroa', meta_ad_account_id: AD_ACCOUNT }],
      error: null,
    })
    mockLoadTokenOwnerPeers.mockResolvedValue(null)
  })

  it('ownership_unknown (peer read failed) is a counted failure with a specific message', async () => {
    mockResolveMetaTokenDetailed.mockResolvedValue('ownership_unknown')

    const { GET } = await import('./route')
    const json = await (await GET(makeRequest(CRON_SECRET))).json()

    expect(mockPullMetrics).not.toHaveBeenCalled()
    expect(json.failed).toBe(1)
    expect(json.results[0].meta).toMatchObject({ success: false })
    expect(json.results[0].meta.error).toMatch(/ownership/i)
  })

  it('no token configured anywhere is a counted failure with a specific message', async () => {
    mockResolveMetaTokenDetailed.mockResolvedValue(null)

    const { GET } = await import('./route')
    const json = await (await GET(makeRequest(CRON_SECRET))).json()

    expect(mockPullMetrics).not.toHaveBeenCalled()
    expect(json.failed).toBe(1)
    expect(json.results[0].meta).toMatchObject({ success: false })
    expect(json.results[0].meta.error).toMatch(/no meta token configured/i)
  })

  it('legacy token present but ownership denied is a counted failure with a specific message', async () => {
    process.env.KITEROA_META_SYSTEM_USER_TOKEN = 'legacy-name-token'
    mockResolveMetaTokenDetailed.mockResolvedValue(null)
    mockLoadTokenOwnerPeers.mockResolvedValue([
      { id: CLIENT_ID, name: 'Kiteroa', domain: null, facebook_page_id: null, created_at: '2026-09-01T00:00:00Z', source: 'fde' },
      { id: 'real-owner', name: 'Kiteroa', domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' },
    ])

    const { GET } = await import('./route')
    const json = await (await GET(makeRequest(CRON_SECRET))).json()
    delete process.env.KITEROA_META_SYSTEM_USER_TOKEN

    expect(mockPullMetrics).not.toHaveBeenCalled()
    expect(json.failed).toBe(1)
    expect(json.results[0].meta.error).toMatch(/does not own/i)
  })
})

// ── 2026-09-13: multi-account ad_daily_insights sync ─────────────────────────
// A client can have more than one registered Meta ad account
// (client_meta_ad_accounts) — CTS is the real case: `meta_ad_account_id`
// (个人号) plus a second, officially-registered account (CTStours 官方账户)
// that the daily sync never used to touch.
describe('GET /api/cron/google-data-pullback-daily — 多账户 ad_daily_insights 同步', () => {
  const SECONDARY_ACCOUNT = 'act_987654321'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET            = CRON_SECRET
    process.env.META_SYSTEM_USER_TOKEN = META_TOKEN

    mockConnectorsResult.mockResolvedValue({ data: [], error: null })
    mockMetaClientsResult.mockResolvedValue({
      data: [{ id: CLIENT_ID, meta_ad_account_id: AD_ACCOUNT }],
      error: null,
    })
    mockGetAdAccountInsights.mockResolvedValue(MOCK_INSIGHTS)
    mockGetAdCampaignInsights.mockResolvedValue([])
    mockSnapshotSingle.mockResolvedValue({ data: { id: 'snap-001' }, error: null })

    // This is the arm that matters for this describe block: turn the Ad
    // Strategy Engine on so the ad_daily_insights sync loop actually runs.
    mockLoadAdStrategyConfigWithSource.mockResolvedValue({
      config: { enabled: true }, source: 'client',
    })
    mockSyncCampaignDailyInsights.mockResolvedValue({ success: true, rows_written: 5 })
    mockSyncAdDailyInsights.mockResolvedValue({ success: true, rows_written: 12 })
    mockSyncAdsetDailyInsights.mockResolvedValue({ success: true, rows_written: 7 })
    mockHasVideoColumns.mockResolvedValue(false)
    mockFindSharedAdAccounts.mockResolvedValue({ shared: new Set<string>() })

    // vi.clearAllMocks() above does not clear a prior mockResolvedValue/mockImplementation —
    // this describe must set its own default rather than inherit whatever the
    // "legacy per-name" describe above left behind.
    mockResolveMetaTokenDetailed.mockImplementation(async () =>
      process.env.META_SYSTEM_USER_TOKEN
        ? { token: process.env.META_SYSTEM_USER_TOKEN, source: 'shared_fallback' as const }
        : null,
    )
    mockLoadTokenOwnerPeers.mockResolvedValue(null)
  })

  it('client with only the primary account registered → no secondary sync calls', async () => {
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT])

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.results[0].ad_daily_secondary).toBeUndefined()
    // primary sync still happens exactly once each
    expect(mockSyncCampaignDailyInsights).toHaveBeenCalledTimes(1)
    expect(mockSyncCampaignDailyInsights).toHaveBeenCalledWith(CLIENT_ID, AD_ACCOUNT, META_TOKEN, { withVideo: false })
  })

  it('client with a second registered account → also syncs it into ad_daily_insights, tagged separately', async () => {
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT, SECONDARY_ACCOUNT])

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    // primary account still synced exactly as before
    expect(mockSyncCampaignDailyInsights).toHaveBeenCalledWith(CLIENT_ID, AD_ACCOUNT, META_TOKEN, { withVideo: false })
    // secondary account gets both the campaign-level and ad-level daily syncs
    expect(mockSyncCampaignDailyInsights).toHaveBeenCalledWith(CLIENT_ID, SECONDARY_ACCOUNT, META_TOKEN, { withVideo: false })
    expect(mockSyncAdDailyInsights).toHaveBeenCalledWith(CLIENT_ID, SECONDARY_ACCOUNT, META_TOKEN, { withVideo: false })
    // result carries it as a tagged secondary entry, not merged into the
    // primary ad_daily/ad_level fields (existing tallying must stay untouched)
    expect(json.results[0].ad_daily_secondary).toEqual([
      {
        ad_account_id: SECONDARY_ACCOUNT,
        ad_daily: { success: true, rows_written: 5 },
        ad_level: { success: true, rows_written: 12 },
        adset_level: { success: true, rows_written: 7 },
      },
    ])
  })

  // ads IMPACT 阶段 1 §2.2：广告组级日数据 + 视频列按 migration 是否 apply 决定写不写。
  it('视频列已在库里 → 主/次账户的三级同步都带 withVideo:true，且广告组级也同步', async () => {
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT, SECONDARY_ACCOUNT])
    mockHasVideoColumns.mockResolvedValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    for (const account of [AD_ACCOUNT, SECONDARY_ACCOUNT]) {
      expect(mockSyncCampaignDailyInsights).toHaveBeenCalledWith(CLIENT_ID, account, META_TOKEN, { withVideo: true })
      expect(mockSyncAdDailyInsights).toHaveBeenCalledWith(CLIENT_ID, account, META_TOKEN, { withVideo: true })
      expect(mockSyncAdsetDailyInsights).toHaveBeenCalledWith(CLIENT_ID, account, META_TOKEN, { withVideo: true })
    }
    expect(json.results[0].adset_level).toEqual({ success: true, rows_written: 7 })
  })

  it('🔴 M9 共用账户：广告组级同步跳过（不把同一批广告组写进两家），系列/广告级老同步照旧', async () => {
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT, SECONDARY_ACCOUNT])
    const strip = (id: string) => (id.startsWith('act_') ? id.slice(4) : id)
    mockFindSharedAdAccounts.mockResolvedValue({ shared: new Set([strip(SECONDARY_ACCOUNT)]) })

    const { GET } = await import('./route')
    const json = await (await GET(makeRequest(CRON_SECRET))).json()

    expect(mockSyncAdsetDailyInsights).toHaveBeenCalledWith(CLIENT_ID, AD_ACCOUNT, META_TOKEN, { withVideo: false })
    expect(mockSyncAdsetDailyInsights).not.toHaveBeenCalledWith(CLIENT_ID, SECONDARY_ACCOUNT, META_TOKEN, expect.anything())
    expect(mockSyncCampaignDailyInsights).toHaveBeenCalledWith(CLIENT_ID, SECONDARY_ACCOUNT, META_TOKEN, { withVideo: false })
    expect(json.results[0].ad_daily_secondary[0].adset_level.error).toContain('shared')
  })

  it('ads IMPACT 第 7 步：快照表已建 → 跑只读诊断发内部版日报，不再调原日报；表没建 → 照旧发原日报', async () => {
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT])
    const { evaluateClientAdHealth } = await import('@/lib/ads-strategy/evaluate')
    const { sendAdHealthDigest } = await import('@/lib/ads-strategy/digest')
    vi.mocked(evaluateClientAdHealth).mockResolvedValue({ success: true, overall_verdict: 'healthy' } as never)
    vi.mocked(sendAdHealthDigest).mockResolvedValue({ decision: 'skip', sent: false } as never)
    const { GET } = await import('./route')

    mockSnapshotTablesExist.mockResolvedValueOnce(true)
    const ready = await (await GET(makeRequest(CRON_SECRET))).json()
    expect(mockRunPortfolioDiagnostics).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendAdHealthDigest)).not.toHaveBeenCalled()
    expect(ready.results[0].ad_diagnostics).toMatchObject({ hits: 1, digest_sent: true })

    mockRunPortfolioDiagnostics.mockClear()
    mockSnapshotTablesExist.mockResolvedValueOnce(false)
    await GET(makeRequest(CRON_SECRET))
    expect(mockRunPortfolioDiagnostics).not.toHaveBeenCalled()
    expect(vi.mocked(sendAdHealthDigest)).toHaveBeenCalledTimes(1)
    vi.mocked(evaluateClientAdHealth).mockReset()
    vi.mocked(sendAdHealthDigest).mockReset()
  })

  it('诊断出错 → 当天原体检成功就退回发原日报，错误进 errors（PM 当天仍收得到信）', async () => {
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT])
    const { evaluateClientAdHealth } = await import('@/lib/ads-strategy/evaluate')
    const { sendAdHealthDigest } = await import('@/lib/ads-strategy/digest')
    vi.mocked(evaluateClientAdHealth).mockResolvedValue({ success: true, overall_verdict: 'watch' } as never)
    vi.mocked(sendAdHealthDigest).mockResolvedValue({ decision: 'watch', sent: true } as never)
    mockSnapshotTablesExist.mockResolvedValueOnce(true)
    mockRunPortfolioDiagnostics.mockResolvedValueOnce({ success: false, hits: 0, not_comparable: 0, excluded: 0, error: 'load failed: relation missing' })
    const { GET } = await import('./route')
    const json = await (await GET(makeRequest(CRON_SECRET))).json()
    expect(vi.mocked(sendAdHealthDigest)).toHaveBeenCalledTimes(1)
    expect(json.results[0].ad_digest.decision).toBe('fallback:watch')
    vi.mocked(evaluateClientAdHealth).mockReset()
    vi.mocked(sendAdHealthDigest).mockReset()
  })

  it('当天拉数失败（授权断了）→ 诊断照样跑（D7 要报这件事）', async () => {
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT])
    mockSyncCampaignDailyInsights.mockResolvedValue({ success: false, error: 'Meta returned no usable page' })
    mockSnapshotTablesExist.mockResolvedValueOnce(true)
    mockRunPortfolioDiagnostics.mockClear()
    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))
    expect(mockRunPortfolioDiagnostics).toHaveBeenCalledTimes(1)
  })

  it('失败邮件标题不拿广告组级错误当头条（它不触发 failed）', async () => {
    // 顺序上 adset_level 的错误排在 ad_health 之前；真正触发 failed 的是 ad_health
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT])
    mockSyncAdsetDailyInsights.mockResolvedValue({ success: false, error: 'adset walk failed' })
    const { evaluateClientAdHealth } = await import('@/lib/ads-strategy/evaluate')
    vi.mocked(evaluateClientAdHealth).mockResolvedValueOnce({ success: false, error: 'judge failed' } as never)

    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))

    const finishArg = mockCronFinish.mock.calls.at(-1)?.[0] as { error?: string }
    expect(finishArg.error?.startsWith('ad_health')).toBe(true)
  })

  it('广告组级同步失败不计入 failed（best-effort，同 ad_level）', async () => {
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT])
    mockSyncAdsetDailyInsights.mockResolvedValue({ success: false, error: 'adset walk failed' })

    const { GET } = await import('./route')
    const json = await (await GET(makeRequest(CRON_SECRET))).json()

    expect(json.failed).toBe(0)
    expect(json.results[0].adset_level.success).toBe(false)
  })

  it('one account failing to sync does not stop the other account from being synced', async () => {
    mockGetClientAdAccountIds.mockResolvedValue([AD_ACCOUNT, SECONDARY_ACCOUNT])
    mockSyncCampaignDailyInsights.mockImplementation(async (_clientId: string, accountId: string) =>
      accountId === SECONDARY_ACCOUNT
        ? { success: false, error: 'Meta returned no usable page' }
        : { success: true, rows_written: 5 },
    )

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    // primary account's own result is unaffected by the secondary's failure
    expect(json.results[0].ad_daily.success).toBe(true)
    expect(json.results[0].ad_daily_secondary[0].ad_daily.success).toBe(false)
    // secondary failure does not count against the top-level `failed` tally —
    // that tally only reads `ad_daily`/`ad_level` (primary), matching how
    // ad_level itself is already excluded (see comment above `failed` in route.ts)
    expect(json.failed).toBe(0)

    // 2026-09-13 (魏征 review fix): even though it's not a `failed` tally hit,
    // it must not vanish without a trace either — it has to land in
    // cron_run_logs.summary.errors so a manual read can find it.
    expect(mockCronFinish).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({
              client_id: CLIENT_ID,
              source: 'ad_daily_secondary',
              error: expect.stringContaining('Meta returned no usable page'),
            }),
          ]),
        }),
      }),
    )
  })
})
