import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  encryptToken: vi.fn((s: string) => `enc:${s}`),
  upsert: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/platform-oauth/vocabulary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-oauth/vocabulary')>()
  return { ...actual, encryptToken: mocks.encryptToken }
})

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      upsert: mocks.upsert,
    })),
  },
}))

// ─── Import after mocks ────────────────────────────────────────────────────────

import { GET } from '../route'
import { GBP_STATE_COOKIE } from '../../start/route'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NONCE     = 'aabbccddeeff00112233445566778899'
const CLIENT_ID = 'client-abc-123'
const COOKIE_VAL = `${NONCE}:${CLIENT_ID}`

const TOKEN_RESPONSE = {
  access_token:  'ya29.fresh-access-token',
  refresh_token: 'refresh-token-long-lived',
  expires_in:    3600,
  token_type:    'Bearer',
}

const ACCOUNTS_RESPONSE = {
  accounts: [
    { name: 'accounts/987654321', accountName: 'OzTop Building Supplies' },
  ],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(opts: {
  code?: string
  state?: string
  cookieValue?: string
}) {
  const url = new URL('http://localhost:3001/api/auth/google/gbp/callback')
  if (opts.code  !== undefined) url.searchParams.set('code',  opts.code)
  if (opts.state !== undefined) url.searchParams.set('state', opts.state)

  const headers = new Headers()
  if (opts.cookieValue !== undefined) {
    headers.set('Cookie', `${GBP_STATE_COOKIE}=${opts.cookieValue}`)
  }

  return new NextRequest(url, { headers })
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function happyFetch() {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify(TOKEN_RESPONSE),    { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(ACCOUNTS_RESPONSE), { status: 200 }))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_CLIENT_ID     = 'goog-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'goog-client-secret'
  process.env.NEXT_PUBLIC_APP_URL        = 'https://app.magic-engine.com'
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
  mocks.upsert.mockResolvedValue({ error: null })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/auth/google/gbp/callback', () => {

  describe('CSRF + param validation', () => {
    it('returns 400 when state cookie is missing', async () => {
      const res = await GET(makeRequest({ code: 'auth-code', state: NONCE }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/cookie/i)
    })

    it('returns 400 when code param is missing', async () => {
      const res = await GET(makeRequest({ state: NONCE, cookieValue: COOKIE_VAL }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/code/i)
    })

    it('returns 400 when state param does not match nonce in cookie', async () => {
      const res = await GET(makeRequest({ code: 'auth-code', state: 'wrong-nonce', cookieValue: COOKIE_VAL }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/csrf|state mismatch/i)
    })

    it('returns 401 when session check fails', async () => {
      mocks.requireDashboardClientAccess.mockResolvedValue({
        ok: false, status: 401, error: 'Unauthenticated',
      })
      const res = await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))
      expect(res.status).toBe(401)
    })

    it('returns 403 when user has no access to this client', async () => {
      mocks.requireDashboardClientAccess.mockResolvedValue({
        ok: false, status: 403, error: 'Forbidden',
      })
      const res = await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))
      expect(res.status).toBe(403)
    })
  })

  describe('token exchange errors', () => {
    it('redirects to settings error page when Google token exchange fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      )
      const res = await GET(makeRequest({ code: 'bad-code', state: NONCE, cookieValue: COOKIE_VAL }))
      expect(res.status).toBe(302)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(CLIENT_ID)
      expect(loc).toContain('gbp=error')
      expect(loc).toContain('token_exchange')
    })

    it('redirects to error when response is missing refresh_token', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
      )
      const res = await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))
      expect(res.status).toBe(302)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('gbp=error')
    })
  })

  describe('GBP accounts API errors', () => {
    it('redirects to error page when GBP accounts API fails', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify(TOKEN_RESPONSE), { status: 200 }))
        .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

      const res = await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))
      expect(res.status).toBe(302)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('gbp=error')
      expect(loc).toContain('gbp_api')
    })

    it('redirects to error page when no GBP accounts are found', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify(TOKEN_RESPONSE),    { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ accounts: [] }),  { status: 200 }))

      const res = await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))
      expect(res.status).toBe(302)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('gbp=error')
      expect(loc).toContain('no_gbp_accounts')
    })
  })

  describe('happy path', () => {
    it('calls the Google token endpoint with correct params', async () => {
      const fetchSpy = happyFetch()
      await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))

      const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0]
      expect(tokenUrl).toBe('https://oauth2.googleapis.com/token')
      const body = (tokenInit as RequestInit).body as string
      expect(body).toContain('code=auth-code')
      expect(body).toContain('grant_type=authorization_code')
      expect(body).toContain('client_id=goog-client-id')
    })

    it('calls the GBP accounts endpoint with Bearer token', async () => {
      const fetchSpy = happyFetch()
      await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))

      const [accountsUrl, accountsInit] = fetchSpy.mock.calls[1]
      expect(accountsUrl).toBe('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')
      const headers = (accountsInit as RequestInit).headers as Record<string, string>
      expect(headers['Authorization']).toBe(`Bearer ${TOKEN_RESPONSE.access_token}`)
    })

    it('encrypts both access_token and refresh_token before upserting', async () => {
      happyFetch()
      await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))

      expect(mocks.encryptToken).toHaveBeenCalledWith(TOKEN_RESPONSE.access_token)
      expect(mocks.encryptToken).toHaveBeenCalledWith(TOKEN_RESPONSE.refresh_token)
    })

    it('upserts to platform_oauth_connections with correct shape', async () => {
      happyFetch()
      await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))

      expect(mocks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id:    CLIENT_ID,
          provider:     'google_gbp',
          account_id:   ACCOUNTS_RESPONSE.accounts[0].name,
          display_name: ACCOUNTS_RESPONSE.accounts[0].accountName,
          status:       'active',
        }),
        expect.objectContaining({ onConflict: 'client_id,provider,account_id' }),
      )
    })

    it('returns 302 redirect to settings page with gbp=connected', async () => {
      happyFetch()
      const res = await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))

      expect(res.status).toBe(302)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(CLIENT_ID)
      expect(loc).toContain('gbp=connected')
    })

    it('clears the state cookie after successful connection', async () => {
      happyFetch()
      const res = await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))

      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain(GBP_STATE_COOKIE)
      expect(setCookie).toContain('Max-Age=0')
    })

    it('writes a connected client_connectors row (anchor=gbp) — the wizard\'s "done" check reads this table, not platform_oauth_connections', async () => {
      happyFetch()
      await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))

      expect(mocks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: CLIENT_ID, anchor: 'gbp', status: 'connected' }),
        expect.objectContaining({ onConflict: 'client_id,anchor' }),
      )
    })
  })

  describe('wizard flow — must land back on the wizard, not settings', () => {
    it('redirects to the onboarding wizard when the cookie carries flow=wizard', async () => {
      happyFetch()
      const res = await GET(makeRequest({
        code: 'auth-code', state: NONCE, cookieValue: `${NONCE}:${CLIENT_ID}:wizard`,
      }))

      expect(res.status).toBe(302)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/dashboard/clients/${CLIENT_ID}/onboarding`)
      expect(loc).not.toContain('/settings')
    })

    it('still redirects to settings when flow is admin (default, no third cookie segment)', async () => {
      happyFetch()
      const res = await GET(makeRequest({ code: 'auth-code', state: NONCE, cookieValue: COOKIE_VAL }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/dashboard/clients/${CLIENT_ID}/settings`)
    })

    it('an error redirect during a wizard flow also lands on the wizard, not settings', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      )
      const res = await GET(makeRequest({
        code: 'bad-code', state: NONCE, cookieValue: `${NONCE}:${CLIENT_ID}:wizard`,
      }))

      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain(`/dashboard/clients/${CLIENT_ID}/onboarding`)
      expect(loc).toContain('gbp=error')
    })
  })
})
