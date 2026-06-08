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

  it('verifies the OTP with type=signup and resolves the redirect (which grants the bonus)', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null })
    mocks.resolveRedirectForSession.mockResolvedValue('/dashboard/clients/abc/brief?welcome=1')

    const res = await POST(request({ email: 'User@Example.com ', token: ' 123456 ', next: '/portal' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.redirect).toBe('/dashboard/clients/abc/brief?welcome=1')

    // Email is normalised, code is trimmed, type is signup.
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '123456',
      type: 'signup',
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

  // Login flow uses type='email' (existing user passwordless sign-in); the
  // register flow keeps the default type='signup'. Mixing them up makes
  // Supabase return "Token has expired or is invalid" even with a valid code.
  it('forwards type=email when login form submits an OTP', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null })
    mocks.resolveRedirectForSession.mockResolvedValue('/dashboard')

    const res = await POST(request({ email: 'user@example.com', token: '123456', type: 'email' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.redirect).toBe('/dashboard')
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '123456',
      type: 'email',
    })
    // Login path must reuse the single source-of-truth redirect logic so admin
    // vs self_serve vs portal_only routing stays consistent with the signup
    // flow. (子牙 architecture review)
    expect(mocks.resolveRedirectForSession).toHaveBeenCalledTimes(1)
  })

  it('defaults to type=signup when no type is provided (register backward compat)', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null })
    mocks.resolveRedirectForSession.mockResolvedValue('/dashboard')

    await POST(request({ email: 'user@example.com', token: '123456' }))

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '123456',
      type: 'signup',
    })
  })

  it('falls back to type=signup when an unknown type is submitted (anti-forgery guard)', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null })
    mocks.resolveRedirectForSession.mockResolvedValue('/dashboard')

    // 'recovery' / 'invite' etc. are valid Supabase OTP types but we never
    // issue them from our own routes, so any incoming value other than
    // 'signup' / 'email' is treated as forged and silently coerced to signup.
    await POST(request({ email: 'user@example.com', token: '123456', type: 'recovery' }))

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '123456',
      type: 'signup',
    })
  })
})
