import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  verifyState:       vi.fn(),
  exchangeCode:      vi.fn(),
  fetchGoogleEmail:  vi.fn(),
  storeTokens:       vi.fn(),
  encryptToken:      vi.fn((s: string) => `enc:${s}`),
  listGa4Properties: vi.fn(),
  requireDashboardClientAccess: vi.fn(),
  upsertCalls:       [] as Array<{ table: string; row: unknown; opts?: unknown }>,
  clientConnectorsExisting: null as { status: string; config: Record<string, unknown> | null } | null,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/google-oauth/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-oauth/client')>()
  return {
    ...actual,
    verifyState:      mocks.verifyState,
    exchangeCode:     mocks.exchangeCode,
    fetchGoogleEmail: mocks.fetchGoogleEmail,
    storeTokens:      mocks.storeTokens,
  }
})

vi.mock('@/lib/platform-oauth/vocabulary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-oauth/vocabulary')>()
  return { ...actual, encryptToken: mocks.encryptToken }
})

vi.mock('@/lib/ga4/admin', () => ({
  listGa4Properties: mocks.listGa4Properties,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => ({
      upsert: vi.fn((row: unknown, opts?: unknown) => {
        mocks.upsertCalls.push({ table, row, opts })
        return Promise.resolve({ error: null })
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: mocks.clientConnectorsExisting })),
          })),
        })),
      })),
    })),
  },
}))

// ─── Import after mocks ────────────────────────────────────────────────────────

import { GET } from '../route'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

const TOKEN_RESPONSE = {
  access_token:  'ya29.fresh-access-token',
  refresh_token: 'refresh-token-long-lived',
  expires_in:    3600,
  scope:         'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly',
}

function makeRequest(params: { code?: string; state?: string; error?: string }) {
  const url = new URL('http://localhost:3001/api/auth/google/callback')
  if (params.code)  url.searchParams.set('code', params.code)
  if (params.state) url.searchParams.set('state', params.state)
  if (params.error) url.searchParams.set('error', params.error)
  return new NextRequest(url)
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upsertCalls.length = 0
  mocks.clientConnectorsExisting = null
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.magic-engine.com'
  mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'admin' })
  mocks.exchangeCode.mockResolvedValue(TOKEN_RESPONSE)
  mocks.fetchGoogleEmail.mockResolvedValue('owner@example.com')
  mocks.storeTokens.mockResolvedValue(undefined)
  mocks.listGa4Properties.mockResolvedValue({ ok: true, properties: [] })
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
})

describe('狄仁杰 2026-08-11 攻击验证 — admin/wizard flow 必须验证当前会话真的有权碰这个 client', () => {
  it('rejects with the access-control status when the session has no access (admin flow)', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'admin' })
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(res.status).toBe(403)
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller (wizard flow) — this is exactly the path wired into the onboarding wizard button', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'wizard' })
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(res.status).toBe(401)
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    // No DB writes must happen for a rejected caller — an attacker must not be
    // able to plant their own Google account's tokens as "this client's connection".
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('proceeds normally when the session does have access (admin flow)', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'admin' })
    mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(res.status).toBe(307)
    expect(mocks.exchangeCode).toHaveBeenCalled()
  })

  it('does NOT gate the connect flow — that is the intentional no-login public page (separate issue, spec §2.1 B1)', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'connect' })
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(mocks.requireDashboardClientAccess).not.toHaveBeenCalled()
    expect(mocks.exchangeCode).toHaveBeenCalled()
  })
})

describe('GET /api/auth/google/callback', () => {
  describe('GSC dual-write (unchanged behaviour)', () => {
    it('writes a platform_oauth_connections row for google_gsc', async () => {
      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const gscRow = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_gsc',
      )
      expect(gscRow).toBeDefined()
    })

    it('writes a connected client_connectors row for anchor=gsc', async () => {
      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const gscConnector = mocks.upsertCalls.find(
        (c) => c.table === 'client_connectors' && (c.row as { anchor: string }).anchor === 'gsc',
      )
      expect(gscConnector).toBeDefined()
      // 'partial' until a site_url is also configured (existing behaviour,
      // unchanged by this PR) — 'connected' only once both OAuth + site_url are set.
      expect((gscConnector!.row as { status: string }).status).toBe('partial')
    })
  })

  describe('GA4 resolution — real failure vs. genuinely no properties (spec §2.6)', () => {
    it('auto-connects the first property when the account has exactly one', async () => {
      mocks.listGa4Properties.mockResolvedValue({
        ok: true,
        properties: [{ property: 'properties/123456789', displayName: 'My Website' }],
      })

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const ga4Row = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )
      expect(ga4Row).toBeDefined()
      expect((ga4Row!.row as { account_id: string }).account_id).toBe('properties/123456789')

      const ga4Connector = mocks.upsertCalls.find(
        (c) => c.table === 'client_connectors' && (c.row as { anchor: string }).anchor === 'ga4',
      )
      expect(ga4Connector).toBeDefined()
      expect((ga4Connector!.row as { status: string }).status).toBe('connected')
    })

    it('takes the first property when several are available (MVP, same simplification as GBP)', async () => {
      mocks.listGa4Properties.mockResolvedValue({
        ok: true,
        properties: [
          { property: 'properties/111', displayName: 'Site A' },
          { property: 'properties/222', displayName: 'Site B' },
        ],
      })

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const ga4Row = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )
      expect((ga4Row!.row as { account_id: string }).account_id).toBe('properties/111')
    })

    it('writes NOTHING for GA4 when the account genuinely has zero properties — not an error', async () => {
      mocks.listGa4Properties.mockResolvedValue({ ok: true, properties: [] })

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(res.status).toBe(307)   // NextResponse.redirect() default when no status is passed
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('oauth=success')   // whole flow still succeeds — GSC connected fine

      const ga4Row = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )
      expect(ga4Row).toBeUndefined()
    })

    it('writes NOTHING for GA4 when the Admin API call genuinely fails — must not be conflated with "no properties"', async () => {
      mocks.listGa4Properties.mockResolvedValue({ ok: false, reason: 'api_failed' })
      const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const ga4Row = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )
      expect(ga4Row).toBeUndefined()
      // Failure must be logged loudly, not silently treated as "customer has no GA4"
      expect(consoleErr).toHaveBeenCalledWith(expect.stringContaining('GA4 property list failed'))
    })
  })

  describe('flow-aware destination (板桥 2026-08-11 复审)', () => {
    it('flow=wizard redirects back to the onboarding wizard, not connectors/settings', async () => {
      mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'wizard' })

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/dashboard/clients/${CLIENT_ID}/onboarding`)
      expect(loc).not.toContain('/connectors')
    })

    it('flow=connect redirects to the public /connect page', async () => {
      mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'connect' })

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/connect/${CLIENT_ID}`)
    })

    it('flow=admin (default) still redirects to the legacy connectors/gsc page', async () => {
      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/dashboard/clients/${CLIENT_ID}/connectors/gsc`)
    })
  })

  describe('魏征 2026-08-11 复审 — denied consent / missing params must not eject wizard users to a bare login wall', () => {
    it('user cancels on the Google consent screen (wizard flow) — must land back on the wizard, not a clientId-less /dashboard', async () => {
      mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'wizard' })

      const res = await GET(makeRequest({ error: 'access_denied', state: 'sig.state' }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/dashboard/clients/${CLIENT_ID}/onboarding`)
      expect(loc).toContain('oauth=denied')
    })

    it('missing code/state on a wizard-flow return trip also lands back on the wizard', async () => {
      mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'wizard' })

      // state present (so verifyState still resolves flow) but code missing
      const res = await GET(makeRequest({ state: 'sig.state' }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/dashboard/clients/${CLIENT_ID}/onboarding`)
    })

    it('user cancels on the Google consent screen (connect flow) — unchanged, still lands on /connect/[clientId]', async () => {
      mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'connect' })

      const res = await GET(makeRequest({ error: 'access_denied', state: 'sig.state' }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/connect/${CLIENT_ID}`)
    })

    it('admin flow still falls back to the bare /dashboard on denial — FDE is already logged in there', async () => {
      mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'admin' })

      const res = await GET(makeRequest({ error: 'access_denied', state: 'sig.state' }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toBe('https://app.magic-engine.com/dashboard?google_auth_error=denied')
    })
  })
})
