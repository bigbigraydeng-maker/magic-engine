import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  resolveRedirect: vi.fn(),
  cookieNonce: 'nonce-123',
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { verifyOtp: mocks.verifyOtp, getUser: mocks.getUser },
  }),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => name === 'me-magic-login-nonce' ? { value: mocks.cookieNonce } : undefined,
    getAll: () => [],
  }),
}))

vi.mock('@/lib/auth/public-origin', () => ({
  getPublicOrigin: () => 'https://app.magicengine.com.au',
}))

vi.mock('@/lib/auth/resolve-redirect', () => ({
  resolveRedirectForSession: mocks.resolveRedirect,
}))

import { GET, POST } from '../route'

const NEXT = '/meta-ads-ai/a1000000-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyOtp.mockResolvedValue({ error: null })
  mocks.getUser.mockResolvedValue({ data: { user: { email: 'hello@magicengine.cloud' } } })
  mocks.resolveRedirect.mockResolvedValue(NEXT)
})

describe('magic landing', () => {
  it('GET renders confirmation without consuming the token', async () => {
    const request = new NextRequest(`https://app.magicengine.com.au/auth/magic-landing?token_hash=abc&type=magiclink&next=${encodeURIComponent(NEXT)}`)
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('确认登录')
    expect(response.headers.get('set-cookie')).toContain('me-magic-login-nonce=')
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('GET rejects a missing token without creating a session', async () => {
    const response = await GET(new NextRequest('https://app.magicengine.com.au/auth/magic-landing?type=magiclink'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login?error=auth_failed')
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('POST verifies only after same-origin nonce confirmation and preserves next', async () => {
    const body = new URLSearchParams({ token_hash: 'abc', type: 'magiclink', next: NEXT, nonce: mocks.cookieNonce })
    const request = new NextRequest('https://app.magicengine.com.au/auth/magic-landing', {
      method: 'POST',
      headers: { origin: 'https://app.magicengine.com.au', 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    const response = await POST(request)

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'magiclink' })
    expect(mocks.resolveRedirect).toHaveBeenCalledWith(expect.anything(), NEXT)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`https://app.magicengine.com.au${NEXT}`)
  })

  it('POST rejects a cross-origin confirmation before token verification', async () => {
    const body = new URLSearchParams({ token_hash: 'abc', type: 'magiclink', next: NEXT, nonce: mocks.cookieNonce })
    const request = new NextRequest('https://app.magicengine.com.au/auth/magic-landing', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    const response = await POST(request)

    expect(response.status).toBe(303)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })
})
