/**
 * Tests for the dashboard auth middleware.
 *
 * Three guard layers, in order:
 *  1. No Supabase session → redirect /login?next=<original path>
 *  2. Session but email not on the whitelist → redirect /unauthorized
 *  3. Client-viewer accessing a path outside their assigned client → redirect
 *     to their allowed client base.
 *
 * On the happy path the middleware forwards `x-user-role` and (when relevant)
 * `x-allowed-client-id` request headers so Server Components can read them.
 *
 * Reference: P8.3.2 Dashboard Magic Link 鉴权 re-enable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

// ─── Mocks (must be declared before importing the SUT) ──────────────────────

const getUserMock = vi.fn()

vi.mock('@/lib/supabase-server', () => ({
  createMiddlewareSupabaseClient: () => ({
    auth: { getUser: getUserMock },
  }),
}))

// Use the real whitelist module so we exercise the integration with env vars.

// ─── Import after mocks ─────────────────────────────────────────────────────

import { NextRequest as NextRequestCtor } from 'next/server'
import { middleware } from '../middleware'

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildRequest(pathname: string): NextRequest {
  return new NextRequestCtor(new URL(`http://localhost:3001${pathname}`))
}

const KEYS = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'CLIENT_VIEWERS'] as const

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('dashboard auth middleware', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    getUserMock.mockReset()
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('redirects to /login with next param when no Supabase user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })

    const res = await middleware(buildRequest('/dashboard/clients'))

    expect(res.status).toBe(307)
    const loc = res.headers.get('location')!
    const url = new URL(loc)
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('next')).toBe('/dashboard/clients')
  })

  it('preserves the deep-link path in the next param', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })

    const res = await middleware(
      buildRequest('/dashboard/clients/abc-123/execution'),
    )

    const url = new URL(res.headers.get('location')!)
    expect(url.searchParams.get('next')).toBe(
      '/dashboard/clients/abc-123/execution',
    )
  })

  it('redirects to /unauthorized when user is not on the whitelist', async () => {
    process.env.ADMIN_EMAILS = 'admin@magiclab.com'
    getUserMock.mockResolvedValue({
      data: { user: { email: 'stranger@evil.com' } },
    })

    const res = await middleware(buildRequest('/dashboard'))

    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/unauthorized',
    )
  })

  it('lets an admin through and forwards x-user-role=admin', async () => {
    process.env.ADMIN_EMAILS = 'admin@magiclab.com'
    getUserMock.mockResolvedValue({
      data: { user: { email: 'admin@magiclab.com' } },
    })

    const res = await middleware(buildRequest('/dashboard/clients'))

    // NextResponse.next() yields status 200 (no redirect)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    // Forwarded header lives on the request, exposed via x-middleware-request-*
    // headers on the response. Assert via the documented mechanism:
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe('admin')
  })

  it('lets a client-viewer through when accessing their scope', async () => {
    process.env.CLIENT_VIEWERS = 'viewer@x.com:client-x-uuid'
    getUserMock.mockResolvedValue({
      data: { user: { email: 'viewer@x.com' } },
    })

    const res = await middleware(
      buildRequest('/dashboard/clients/client-x-uuid'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe(
      'client-viewer',
    )
    expect(
      res.headers.get('x-middleware-request-x-allowed-client-id'),
    ).toBe('client-x-uuid')
  })

  it('lets a client-viewer through on nested paths within their scope', async () => {
    process.env.CLIENT_VIEWERS = 'viewer@x.com:client-x-uuid'
    getUserMock.mockResolvedValue({
      data: { user: { email: 'viewer@x.com' } },
    })

    const res = await middleware(
      buildRequest('/dashboard/clients/client-x-uuid/execution'),
    )

    expect(res.status).toBe(200)
  })

  it('redirects a client-viewer to their allowed base when off-scope', async () => {
    process.env.CLIENT_VIEWERS = 'viewer@x.com:client-x-uuid'
    getUserMock.mockResolvedValue({
      data: { user: { email: 'viewer@x.com' } },
    })

    const res = await middleware(
      buildRequest('/dashboard/clients/other-client-uuid'),
    )

    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/dashboard/clients/client-x-uuid',
    )
  })

  it('redirects a client-viewer who hits /dashboard root to their base', async () => {
    process.env.CLIENT_VIEWERS = 'viewer@x.com:client-x-uuid'
    getUserMock.mockResolvedValue({
      data: { user: { email: 'viewer@x.com' } },
    })

    const res = await middleware(buildRequest('/dashboard'))

    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/dashboard/clients/client-x-uuid',
    )
  })
})
