import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  resolveRedirectForSession: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: mocks.verifyOtp,
      getUser: mocks.getUser,
    },
  }),
}))

vi.mock('@/lib/auth/resolve-redirect', () => ({
  resolveRedirectForSession: mocks.resolveRedirectForSession,
}))

import { POST } from '../route'

function request(body: unknown) {
  return new NextRequest('http://localhost:3001/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/verify-otp', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    mocks.verifyOtp.mockReset()
    mocks.getUser.mockReset()
    mocks.resolveRedirectForSession.mockReset()
  })

  it('rejects a missing/invalid email', async () => {
    const res = await POST(request({ email: 'not-an-email', token: '123456' }))
    expect(res.status).toBe(400)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric code', async () => {
    const res = await POST(request({ email: 'user@example.com', token: '12ab' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/code from your email/i)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('accepts 8-digit OTP (Supabase project setting)', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null })
    mocks.resolveRedirectForSession.mockResolvedValue('/dashboard/clients/abc')
    const res = await POST(request({ email: 'user@example.com', token: '40338177' }))
    expect(res.status).toBe(200)
    expect(mocks.verifyOtp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'user@example.com',
      token: '40338177',
    }))
  })

  it('verifies the OTP with type=email and resolves the redirect (which grants the bonus)', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null })
    mocks.resolveRedirectForSession.mockResolvedValue('/dashboard/clients/abc/brief?welcome=1')

    const res = await POST(request({ email: 'User@Example.com ', token: ' 123456 ', next: '/portal' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.redirect).toBe('/dashboard/clients/abc/brief?welcome=1')

    // Email is normalised, code is trimmed, type is 'email' — it must accept
    // both the signup confirmation code and the magiclink code a resend can
    // produce for an already-confirmed user.
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '123456',
      type: 'email',
    })
    // resolveRedirectForSession is the single place that calls grantSignupBonus.
    expect(mocks.resolveRedirectForSession).toHaveBeenCalledTimes(1)
    expect(mocks.resolveRedirectForSession.mock.calls[0][1]).toBe('/portal')
  })

  it('returns a friendly error and does not resolve redirect when the OTP is expired', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid' } })

    const res = await POST(request({ email: 'user@example.com', token: '000000' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid or has expired/i)
    expect(mocks.resolveRedirectForSession).not.toHaveBeenCalled()
  })

  it('defaults an unsafe next path to /dashboard', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null })
    mocks.resolveRedirectForSession.mockResolvedValue('/dashboard')

    await POST(request({ email: 'user@example.com', token: '123456', next: 'https://evil.com' }))

    expect(mocks.resolveRedirectForSession.mock.calls[0][1]).toBe('/dashboard')
  })
})
