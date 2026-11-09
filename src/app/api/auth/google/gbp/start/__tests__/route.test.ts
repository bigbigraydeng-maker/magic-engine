import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  randomBytes: vi.fn(() => Buffer.from('deadbeefcafe1234deadbeefcafe1234', 'hex')),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  return { ...actual, randomBytes: mocks.randomBytes }
})

// ─── Import after mocks ────────────────────────────────────────────────────────

import { GET } from '../route'
import { GBP_STATE_COOKIE, GBP_OAUTH_SCOPE, GBP_STATE_TTL_SECS } from '@/lib/gbp/oauth'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(clientId?: string) {
  const url = clientId
    ? `http://localhost:3001/api/auth/google/gbp/start?clientId=${clientId}`
    : 'http://localhost:3001/api/auth/google/gbp/start'
  return new NextRequest(url)
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_CLIENT_ID    = 'goog-client-id'
  process.env.NEXT_PUBLIC_APP_URL       = 'https://app.magic-engine.com'
  delete process.env.APP_URL
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/auth/google/gbp/start', () => {

  describe('validation', () => {
    it('returns 400 when clientId is missing', async () => {
      const res = await GET(makeRequest())
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/clientId/)
    })

    it('returns 401 when session check fails', async () => {
      mocks.requireDashboardClientAccess.mockResolvedValue({
        ok: false, status: 401, error: 'Unauthenticated',
      })
      const res = await GET(makeRequest('client-1'))
      expect(res.status).toBe(401)
    })

    it('returns 403 when user has no access to this client', async () => {
      mocks.requireDashboardClientAccess.mockResolvedValue({
        ok: false, status: 403, error: 'Forbidden',
      })
      const res = await GET(makeRequest('client-1'))
      expect(res.status).toBe(403)
    })
  })

  describe('env config', () => {
    it('returns 500 when GOOGLE_CLIENT_ID is missing', async () => {
      delete process.env.GOOGLE_CLIENT_ID
      const res = await GET(makeRequest('client-1'))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toMatch(/GOOGLE_CLIENT_ID/)
    })

    it('returns 500 when neither APP_URL nor NEXT_PUBLIC_APP_URL is set', async () => {
      delete process.env.NEXT_PUBLIC_APP_URL
      delete process.env.APP_URL
      const res = await GET(makeRequest('client-1'))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toMatch(/APP_URL/)
    })

    it('falls back to APP_URL when NEXT_PUBLIC_APP_URL is absent', async () => {
      delete process.env.NEXT_PUBLIC_APP_URL
      process.env.APP_URL = 'https://fallback.example.com'
      const res = await GET(makeRequest('client-1'))
      expect(res.status).toBe(302)
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('redirect_uri=https%3A%2F%2Ffallback.example.com')
    })
  })

  describe('redirect URL', () => {
    it('returns 302 redirect to Google OAuth', async () => {
      const res = await GET(makeRequest('client-1'))
      expect(res.status).toBe(302)
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('accounts.google.com/o/oauth2/v2/auth')
    })

    it('includes client_id in the redirect URL', async () => {
      const res = await GET(makeRequest('client-1'))
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('client_id=goog-client-id')
    })

    it('sets access_type=offline for refresh_token grant', async () => {
      const res = await GET(makeRequest('client-1'))
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('access_type=offline')
    })

    it('sets prompt=consent to force refresh_token on every auth', async () => {
      const res = await GET(makeRequest('client-1'))
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('prompt=consent')
    })

    it('sets response_type=code', async () => {
      const res = await GET(makeRequest('client-1'))
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('response_type=code')
    })

    it('includes the GBP scope', async () => {
      const res = await GET(makeRequest('client-1'))
      const location = res.headers.get('location') ?? ''
      expect(location).toContain(encodeURIComponent(GBP_OAUTH_SCOPE))
    })

    it('includes the redirect_uri pointing to the callback route', async () => {
      const res = await GET(makeRequest('client-1'))
      const location = res.headers.get('location') ?? ''
      expect(location).toContain(encodeURIComponent('https://app.magic-engine.com/api/auth/google/gbp/callback'))
    })

    it('sets state to the nonce (NOT the full cookie value)', async () => {
      const res = await GET(makeRequest('client-1'))
      const location = res.headers.get('location') ?? ''
      // State should be just the nonce — clientId must NOT appear in the URL
      const url    = new URL(location)
      const state  = url.searchParams.get('state') ?? ''
      expect(state).not.toContain('client-1')
      expect(state).toBe('deadbeefcafe1234deadbeefcafe1234')
    })
  })

  describe('CSRF state cookie', () => {
    it(`sets the ${GBP_STATE_COOKIE} cookie`, async () => {
      const res = await GET(makeRequest('client-1'))
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain(GBP_STATE_COOKIE)
    })

    it('cookie value encodes nonce + clientId separated by colon', async () => {
      const res = await GET(makeRequest('client-1'))
      const setCookie = res.headers.get('set-cookie') ?? ''
      // Format: gbp_oauth_state=deadbeefcafe1234deadbeefcafe1234:client-1
      expect(setCookie).toContain('deadbeefcafe1234deadbeefcafe1234:client-1')
    })

    it('cookie is HttpOnly', async () => {
      const res = await GET(makeRequest('client-1'))
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie.toLowerCase()).toContain('httponly')
    })

    it('cookie has SameSite=Lax', async () => {
      const res = await GET(makeRequest('client-1'))
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie.toLowerCase()).toContain('samesite=lax')
    })

    it(`cookie maxAge is ${GBP_STATE_TTL_SECS}s`, async () => {
      const res = await GET(makeRequest('client-1'))
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain(`Max-Age=${GBP_STATE_TTL_SECS}`)
    })

    it('defaults the flow segment to "admin" when ?flow= is not passed', async () => {
      const res = await GET(makeRequest('client-1'))
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain('deadbeefcafe1234deadbeefcafe1234:client-1:admin')
    })

    it('carries flow=wizard into the cookie so the callback lands back on the wizard', async () => {
      const url = 'http://localhost:3001/api/auth/google/gbp/start?clientId=client-1&flow=wizard'
      const res = await GET(new NextRequest(url))
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain('deadbeefcafe1234deadbeefcafe1234:client-1:wizard')
    })
  })
})
