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
  setGa4Property:    vi.fn(),
  persistGbpFromTokens: vi.fn(),
  requireDashboardClientAccess: vi.fn(),
  upsertCalls:       [] as Array<{ table: string; row: unknown; opts?: unknown }>,
  updateCalls:       [] as Array<{ table: string; row: unknown }>,
  clientConnectorsExisting: null as { status: string; config: Record<string, unknown> | null } | null,
  priorGa4Credential: null as { refresh_token_enc: string } | null,
  priorGa4ReadError: null as { message: string } | null,
  connectorReadError: null as { message: string } | null,
  ga4RetirementError: null as { message: string } | null,
  ga4CredentialWriteError: null as { message: string } | null,
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

// setGa4Property() has its own full unit-test coverage in
// src/lib/ga4/__tests__/property.test.ts (verification, clobber-prevention,
// error-status writes). This file only needs to prove the callback decides
// CORRECTLY *when* to call it — not re-exercise its internals — so it's
// mocked here rather than left to hit the real (unmocked) Google/Supabase
// calls underneath verifyGa4PropertyAccess().
vi.mock('@/lib/ga4/property', () => ({
  setGa4Property: mocks.setGa4Property,
}))

vi.mock('@/lib/gbp/oauth-persist', async (importOriginal) => {
  // 保留 `scopeIncludesGbp` 的真实实现（它是纯函数），只 mock 掉真正做副作用的 persist。
  const actual = await importOriginal<typeof import('@/lib/gbp/oauth-persist')>()
  return { ...actual, persistGbpFromTokens: mocks.persistGbpFromTokens }
})

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const afterTwoEqs = {
        maybeSingle: vi.fn(() => Promise.resolve({
          data: mocks.clientConnectorsExisting,
          error: table === 'client_connectors' ? mocks.connectorReadError : null,
        })),
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({
            data: mocks.priorGa4Credential,
            error: mocks.priorGa4ReadError,
          })),
        })),
      }
      return {
      upsert: vi.fn((row: unknown, opts?: unknown) => {
        mocks.upsertCalls.push({ table, row, opts })
        const provider = (row as { provider?: string }).provider
        const error = table === 'platform_oauth_connections' && provider === 'google_ga4'
          ? mocks.ga4CredentialWriteError
          : null
        return Promise.resolve({ error })
      }),
      update: vi.fn((row: unknown) => {
        mocks.updateCalls.push({ table, row })
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              neq: vi.fn(() => Promise.resolve({ error: mocks.ga4RetirementError })),
            })),
          })),
        }
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => afterTwoEqs),
        })),
      })),
      }
    }),
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
  mocks.updateCalls.length = 0
  mocks.clientConnectorsExisting = null
  mocks.priorGa4Credential = null
  mocks.priorGa4ReadError = null
  mocks.connectorReadError = null
  mocks.ga4RetirementError = null
  mocks.ga4CredentialWriteError = null
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.magic-engine.com'
  mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, flow: 'admin' })
  mocks.exchangeCode.mockResolvedValue(TOKEN_RESPONSE)
  mocks.fetchGoogleEmail.mockResolvedValue('owner@example.com')
  mocks.storeTokens.mockResolvedValue(undefined)
  mocks.listGa4Properties.mockResolvedValue({ ok: true, properties: [] })
  mocks.setGa4Property.mockResolvedValue({ ok: true, status: 'connected', propertyId: '123456789' })
  mocks.persistGbpFromTokens.mockResolvedValue({ ok: true, locationStatus: 'ready' })
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

  describe('GA4 resolution (#1052 state invariant — PM Gate: OAuth active ≠ GA4 connected; only setGa4Property() may ever write status=connected)', () => {
    it('calls the unified setGa4Property() — never writes client_connectors.ga4 directly — when exactly one candidate and no existing connector row', async () => {
      mocks.listGa4Properties.mockResolvedValue({
        ok: true,
        properties: [{ property: 'properties/123456789', displayName: 'My Website' }],
      })
      mocks.clientConnectorsExisting = null   // no prior ga4 row — nothing to clobber

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      // OAuth token itself is stored under the Google account identity,
      // independent of the discovered/selected Property.
      const ga4TokenRow = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )
      expect(ga4TokenRow).toBeDefined()
      expect((ga4TokenRow!.row as { account_id: string }).account_id).toBe(CLIENT_ID)

      // The callback must delegate to setGa4Property() — the only function
      // allowed to verify-then-write status='connected' — never upsert
      // client_connectors.ga4 itself.
      expect(mocks.setGa4Property).toHaveBeenCalledWith(CLIENT_ID, 'properties/123456789')
      const ga4ConnectorDirectWrite = mocks.upsertCalls.find(
        (c) => c.table === 'client_connectors' && (c.row as { anchor: string }).anchor === 'ga4',
      )
      expect(ga4ConnectorDirectWrite).toBeUndefined()
    })

    it('does NOT auto-select when several properties are available — no call to setGa4Property, user must pick via the settings page', async () => {
      mocks.listGa4Properties.mockResolvedValue({
        ok: true,
        properties: [
          { property: 'properties/111', displayName: 'Site A' },
          { property: 'properties/222', displayName: 'Site B' },
        ],
      })
      mocks.clientConnectorsExisting = null

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      // The token is still stored so the settings page's picker has something to work with...
      const ga4TokenRow = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )
      expect(ga4TokenRow).toBeDefined()
      // ...but nobody gets auto-picked. Property discovered ≠ Property selected.
      expect(mocks.setGa4Property).not.toHaveBeenCalled()
    })

    it('does NOT call setGa4Property when a connected connector already exists — must not clobber a working, human-verified connection', async () => {
      mocks.listGa4Properties.mockResolvedValue({
        ok: true,
        properties: [{ property: 'properties/999999999', displayName: 'A Different Property' }],
      })
      mocks.clientConnectorsExisting = { status: 'connected', config: { property_id: '123456789' } }

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(mocks.setGa4Property).not.toHaveBeenCalled()
    })

    it('does NOT call setGa4Property when an error connector already exists — a re-auth must not silently flip a diagnosed failure back to connected', async () => {
      mocks.listGa4Properties.mockResolvedValue({
        ok: true,
        properties: [{ property: 'properties/123456789', displayName: 'My Website' }],
      })
      mocks.clientConnectorsExisting = {
        status: 'error',
        config: { property_id: '123456789', error_reason: 'permission_denied' },
      }

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(mocks.setGa4Property).not.toHaveBeenCalled()
    })

    it('respects an existing connector regardless of where the newly-discovered property sorts in the list — selection is not order-dependent', async () => {
      // A human previously picked '999' (now connected). This re-auth's Admin
      // API happens to return '111' first — list order must never override
      // what was explicitly chosen.
      mocks.listGa4Properties.mockResolvedValue({
        ok: true,
        properties: [{ property: 'properties/111', displayName: 'Site A' }],
      })
      mocks.clientConnectorsExisting = { status: 'connected', config: { property_id: '999' } }

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(mocks.setGa4Property).not.toHaveBeenCalled()
    })

    it('keeps the GA4 OAuth grant when the account genuinely has zero properties — without marking GA4 connected', async () => {
      mocks.listGa4Properties.mockResolvedValue({ ok: true, properties: [] })

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(res.status).toBe(307)   // NextResponse.redirect() default when no status is passed
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('oauth=success')   // whole flow still succeeds — GSC connected fine

      const ga4Row = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )
      expect(ga4Row).toBeDefined()
      expect((ga4Row!.row as { account_id: string }).account_id).toBe(CLIENT_ID)
      expect(mocks.setGa4Property).not.toHaveBeenCalled()
    })

    it('keeps the GA4 OAuth grant — and does not touch the already-saved GSC connection — when the Admin API call genuinely fails', async () => {
      mocks.listGa4Properties.mockResolvedValue({ ok: false, reason: 'api_failed' })
      const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const ga4Row = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )
      expect(ga4Row).toBeDefined()
      expect((ga4Row!.row as { account_id: string }).account_id).toBe(CLIENT_ID)
      expect(mocks.setGa4Property).not.toHaveBeenCalled()
      // Failure must be logged loudly, not silently treated as "customer has no GA4"
      expect(consoleErr).toHaveBeenCalledWith(expect.stringContaining('GA4 property list failed'))

      // The GSC side of this same OAuth callback (already executed earlier in
      // the handler) is completely independent — a GA4 Admin API outage must
      // not degrade the GSC connection this same request just saved.
      const gscTokenRow = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_gsc',
      )
      const gscConnectorRow = mocks.upsertCalls.find(
        (c) => c.table === 'client_connectors' && (c.row as { anchor: string }).anchor === 'gsc',
      )
      expect(gscTokenRow).toBeDefined()
      expect(gscConnectorRow).toBeDefined()
    })

    it('uses a non-empty stable fallback identity when Google userinfo has no email', async () => {
      mocks.fetchGoogleEmail.mockResolvedValue(null)
      mocks.listGa4Properties.mockResolvedValue({ ok: false, reason: 'api_failed' })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const ga4Row = mocks.upsertCalls.find(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )
      expect(ga4Row).toBeDefined()
      expect((ga4Row!.row as { account_id: string; display_name: string }).account_id).toBe(CLIENT_ID)
      expect((ga4Row!.row as { account_id: string; display_name: string }).display_name).toBe('Google Analytics 4')
    })

    it('fails closed before discovery when the GA4 credential row cannot be saved', async () => {
      mocks.ga4CredentialWriteError = { message: 'database unavailable' }
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(mocks.listGa4Properties).not.toHaveBeenCalled()
      expect(mocks.setGa4Property).not.toHaveBeenCalled()
      expect(mocks.updateCalls).toHaveLength(0)
      expect(res.headers.get('location')).toContain('oauth=error')
      expect(consoleError).toHaveBeenCalledWith(
        '[google/callback] GA4 credential write failed:',
        'database unavailable',
      )
    })

    it('keeps the previous refresh token when Google omits it during reauthorization', async () => {
      mocks.exchangeCode.mockResolvedValue({ ...TOKEN_RESPONSE, refresh_token: undefined })
      mocks.priorGa4Credential = { refresh_token_enc: 'enc:previous-refresh-token' }

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const ga4Row = mocks.upsertCalls.find(
        (call) => call.table === 'platform_oauth_connections' &&
          (call.row as { provider?: string }).provider === 'google_ga4',
      )
      expect((ga4Row?.row as { refresh_token_enc: string }).refresh_token_enc).toBe('enc:previous-refresh-token')
      expect(res.headers.get('location')).toContain('oauth=success')
    })

    it('returns an honest error when a first authorization has no refresh token', async () => {
      mocks.exchangeCode.mockResolvedValue({ ...TOKEN_RESPONSE, refresh_token: undefined })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(res.headers.get('location')).toContain('oauth=error')
      expect(mocks.listGa4Properties).not.toHaveBeenCalled()
    })

    it('retires historical account/property keyed GA4 rows after activating the stable client slot', async () => {
      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(mocks.updateCalls).toContainEqual({
        table: 'platform_oauth_connections',
        row: expect.objectContaining({ status: 'revoked' }),
      })
      const ga4Row = mocks.upsertCalls.find(
        (call) => call.table === 'platform_oauth_connections' &&
          (call.row as { provider?: string }).provider === 'google_ga4',
      )
      expect((ga4Row?.row as { account_id: string }).account_id).toBe(CLIENT_ID)
    })

    it('concurrent callbacks converge on the same stable GA4 slot', async () => {
      await Promise.all([
        GET(makeRequest({ code: 'auth-code-a', state: 'sig.state' })),
        GET(makeRequest({ code: 'auth-code-b', state: 'sig.state' })),
      ])

      const ga4Rows = mocks.upsertCalls.filter(
        (call) => call.table === 'platform_oauth_connections' &&
          (call.row as { provider?: string }).provider === 'google_ga4',
      )
      expect(ga4Rows).toHaveLength(2)
      expect(ga4Rows.every((call) => (call.row as { account_id: string }).account_id === CLIENT_ID)).toBe(true)
    })

    it('returns an honest error when historical GA4 rows cannot be retired', async () => {
      mocks.ga4RetirementError = { message: 'retirement unavailable' }
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(res.headers.get('location')).toContain('oauth=error')
      expect(mocks.listGa4Properties).not.toHaveBeenCalled()
      expect(mocks.upsertCalls.some(
        (call) => call.table === 'platform_oauth_connections' &&
          (call.row as { provider?: string }).provider === 'google_ga4',
      )).toBe(true)
    })

    it('fails closed when the existing GA4 credential rows cannot be read', async () => {
      mocks.priorGa4ReadError = { message: 'read unavailable' }
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(res.headers.get('location')).toContain('oauth=error')
      expect(mocks.listGa4Properties).not.toHaveBeenCalled()
    })

    it('does not auto-select when the existing connector check fails', async () => {
      mocks.listGa4Properties.mockResolvedValue({
        ok: true,
        properties: [{ property: 'properties/123456789', displayName: 'My Website' }],
      })
      mocks.connectorReadError = { message: 'connector read unavailable' }
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(res.headers.get('location')).toContain('oauth=success')
      expect(mocks.setGa4Property).not.toHaveBeenCalled()
    })
  })

  /**
   * 2026-09-07 铁律 3 落地：GBP scope 合到 COMBINED_GOOGLE_SCOPES 后，一次授权
   * 就该把商家页连接也落库；不再要求 PM 每客户再单独走一次 `/gbp/start`。
   * 这里锁两条边界，防止未来重构悄悄退化回两次点击：
   *  (a) scope 含 business.manage → helper 一定被调用
   *  (b) scope 不含 → helper 一定不被调用（此前的历史授权范围行为不变）
   */
  describe('GBP one-click merge (2026-09-07 铁律 3)', () => {
    const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage'
    const scopeWithGbp =
      `https://www.googleapis.com/auth/webmasters.readonly ` +
      `https://www.googleapis.com/auth/analytics.readonly ${GBP_SCOPE}`

    it('scope 含 business.manage → 把 GBP 连接一起落库（跟 refresh_token 一起传进去）', async () => {
      mocks.exchangeCode.mockResolvedValue({ ...TOKEN_RESPONSE, scope: scopeWithGbp })

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(mocks.persistGbpFromTokens).toHaveBeenCalledTimes(1)
      expect(mocks.persistGbpFromTokens).toHaveBeenCalledWith(expect.objectContaining({
        clientId:     CLIENT_ID,
        accessToken:  TOKEN_RESPONSE.access_token,
        refreshToken: TOKEN_RESPONSE.refresh_token,
        scope:        scopeWithGbp,
      }))
    })

    it('scope 不含 business.manage → 不动 GBP（老流程不变）', async () => {
      // 默认 fixture scope 就没 GBP —— 这里再显式一次防止将来改 fixture 时踩坑
      mocks.exchangeCode.mockResolvedValue({ ...TOKEN_RESPONSE })

      await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      expect(mocks.persistGbpFromTokens).not.toHaveBeenCalled()
    })

    it('GBP persist 失败不影响 GSC/GA4 已经落好的授权 —— daily-todo 明天再浮出来', async () => {
      mocks.exchangeCode.mockResolvedValue({ ...TOKEN_RESPONSE, scope: scopeWithGbp })
      mocks.persistGbpFromTokens.mockResolvedValue({ ok: false, reason: 'gbp_api_failed' })
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      // 整条授权仍标 success（GSC/GA4 已经写好）
      expect(res.headers.get('location')).toContain('oauth=success')
      // GSC 授权照常落
      expect(mocks.upsertCalls.some(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_gsc',
      )).toBe(true)
      // GA4 授权照常落
      expect(mocks.upsertCalls.some(
        (c) => c.table === 'platform_oauth_connections' && (c.row as { provider: string }).provider === 'google_ga4',
      )).toBe(true)
      consoleWarn.mockRestore()
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

    it('flow=admin (default) redirects to the settings connect tab (PR5: /connectors retired)', async () => {
      const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/dashboard/clients/${CLIENT_ID}/settings?tab=connect`)
      expect(loc).not.toContain('/connectors')
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
