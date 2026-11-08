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
const mockSupabaseIn = vi.fn()
// Portal-tier lookup: from().select('access_type').eq(email).eq(client_id).maybeSingle()
// added when /portal/<clientId>/* needed to serve portal-tier users directly
// instead of 308-ing them to /dashboard/*.
const mockPortalMaybeSingle = vi.fn()

// Toggle whether the mocked createMiddlewareSupabaseClient should simulate
// a Supabase token refresh — the real helper writes rotated sb-* cookies
// onto the middleware response via its cookies adapter when getUser()
// discovers an expired access token. Tests that care about cookie
// preservation set this to true in beforeEach; others leave it false so
// existing redirect assertions stay untouched.
let simulateRefresh = false

vi.mock('@/lib/supabase-server', () => ({
  createMiddlewareSupabaseClient: (_req: unknown, res: { headers?: Headers } | undefined) => {
    if (simulateRefresh && res?.headers?.append) {
      // Two-cookie rotation the real Supabase adapter emits: access + refresh.
      res.headers.append(
        'set-cookie',
        'sb-access-token=REFRESHED-abc; Path=/; HttpOnly; SameSite=Lax',
      )
      res.headers.append(
        'set-cookie',
        'sb-refresh-token=REFRESHED-xyz; Path=/; HttpOnly; SameSite=Lax',
      )
    }
    return { auth: { getUser: getUserMock } }
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: mockSupabaseIn,
          eq: vi.fn(() => ({
            maybeSingle: mockPortalMaybeSingle,
          })),
        })),
      })),
    })),
  },
}))

// Use the real whitelist module so we exercise the integration with env vars.

// ─── Import after mocks ─────────────────────────────────────────────────────

import { NextRequest as NextRequestCtor } from 'next/server'
import { middleware } from '../middleware'

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildRequest(pathname: string): NextRequest {
  return new NextRequestCtor(new URL(`http://localhost:3001${pathname}`))
}

const KEYS = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'CLIENT_VIEWERS', 'DEMO_ADMINS'] as const

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('dashboard auth middleware', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    getUserMock.mockReset()
    mockSupabaseIn.mockReset()
    mockSupabaseIn.mockResolvedValue({ data: [], error: null })
    mockPortalMaybeSingle.mockReset()
    mockPortalMaybeSingle.mockResolvedValue({ data: null, error: null })
    simulateRefresh = false
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

  it('lets unauthenticated users view the portal login page', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })

    const res = await middleware(buildRequest('/portal/login'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('redirects unauthenticated prospect pages to the portal login page', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })

    const res = await middleware(buildRequest('/prospect'))

    expect(res.status).toBe(307)
    const url = new URL(res.headers.get('location')!)
    expect(url.pathname).toBe('/portal/login')
    expect(url.searchParams.get('next')).toBe('/prospect')
  })

  it('redirects unauthenticated portal pages to the unified /login (Phase X.S4 portal phase-out)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })

    const res = await middleware(buildRequest('/portal/client-x-uuid/report'))

    expect(res.status).toBe(307)
    const url = new URL(res.headers.get('location')!)
    expect(url.pathname).toBe('/login')
    // The `next` param is rewritten to the dashboard equivalent so the user
    // lands on /dashboard/clients/<clientId>/report after signing in.
    expect(url.searchParams.get('next')).toBe('/dashboard/clients/client-x-uuid/report')
  })

  it('redirects authenticated /portal/<clientId>/<rest> with 308 to /dashboard equivalent', async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: 'paid@example.com' } } })

    const res = await middleware(buildRequest('/portal/client-x-uuid/report'))
    expect(res.status).toBe(308)
    const url = new URL(res.headers.get('location')!)
    expect(url.pathname).toBe('/dashboard/clients/client-x-uuid/report')
  })

  // ── Contract V3 §A: portal-tier invitees reach their real workspace ────

  it('lets a portal-tier user through to /portal/<their-clientId> WITHOUT bouncing to /unauthorized', async () => {
    // Regression: pre-V3 the /portal/* branch 308ed unconditionally to
    // /dashboard/clients/<id>, and the dashboard branch rejects portal-tier
    // (ACCESS_TYPES_DASHBOARD excludes 'portal') → /unauthorized. Portal
    // invitees were effectively dead-ended. Fix: /portal/<own-client>/*
    // now serves for access_type='portal' users.
    getUserMock.mockResolvedValue({ data: { user: { email: 'staff@cts.co.nz' } } })
    mockPortalMaybeSingle.mockResolvedValueOnce({
      data: { access_type: 'portal' },
      error: null,
    })

    const res = await middleware(buildRequest('/portal/client-b-uuid'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe('client-viewer')
    expect(res.headers.get('x-middleware-request-x-user-tier')).toBe('portal_only')
    expect(res.headers.get('x-middleware-request-x-allowed-client-id')).toBe('client-b-uuid')
  })

  // ── Contract V6: portal-only allow response must carry Supabase refresh cookies ──

  it('preserves rotated Supabase session cookies on the portal-only allow response (token refresh survives)', async () => {
    // Regression for the P1 that unmerged V5: the portal-only branch
    // returned a fresh NextResponse.next without copying the Set-Cookie
    // headers createMiddlewareSupabaseClient wrote onto the original
    // middleware response. A token refresh would render this request
    // fine, then the next navigation would find no rotated cookies and
    // bounce to /portal/login. Fix: copy raw Set-Cookie headers via
    // getSetCookie(); this test proves both rotated cookies survive.
    simulateRefresh = true
    getUserMock.mockResolvedValue({ data: { user: { email: 'staff@cts.co.nz' } } })
    mockPortalMaybeSingle.mockResolvedValueOnce({
      data: { access_type: 'portal' },
      error: null,
    })

    const res = await middleware(buildRequest('/portal/client-b-uuid'))

    // Both rotated cookies survive with their full attributes intact.
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some(sc => sc.startsWith('sb-access-token=REFRESHED-abc'))).toBe(true)
    expect(setCookies.some(sc => sc.startsWith('sb-refresh-token=REFRESHED-xyz'))).toBe(true)
    // Attributes (HttpOnly, SameSite, Path) preserved — proves we did NOT
    // round-trip through cookies.getAll()/set() which drops options.
    const accessCookie = setCookies.find(sc => sc.startsWith('sb-access-token='))!
    expect(accessCookie).toMatch(/HttpOnly/i)
    expect(accessCookie).toMatch(/SameSite=Lax/i)
    expect(accessCookie).toMatch(/Path=\//)
  })

  it('preserves the portal-only tier + exact allowedClientId headers alongside the rotated cookies', async () => {
    // The two contracts must hold simultaneously: refresh cookies AND
    // the request-echo headers the portal layout reads to decide whether
    // to render. Without both, either the session dies or the layout
    // falls back to its dashboard permanentRedirect.
    simulateRefresh = true
    getUserMock.mockResolvedValue({ data: { user: { email: 'staff@cts.co.nz' } } })
    mockPortalMaybeSingle.mockResolvedValueOnce({
      data: { access_type: 'portal' },
      error: null,
    })

    const res = await middleware(buildRequest('/portal/client-b-uuid'))

    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe('client-viewer')
    expect(res.headers.get('x-middleware-request-x-user-tier')).toBe('portal_only')
    expect(res.headers.get('x-middleware-request-x-allowed-client-id')).toBe('client-b-uuid')
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0)
  })

  it('emits each rotated cookie exactly once (no duplicate Set-Cookie on the portal-only allow response)', async () => {
    // Copying via headers.append must not re-emit whatever the fresh
    // NextResponse.next already carried. Regressing to
    // `set-cookie: sb-access-token=REFRESHED-abc, sb-access-token=REFRESHED-abc`
    // would silently break the invitee's session on some browsers /
    // clients that only honour the first occurrence.
    simulateRefresh = true
    getUserMock.mockResolvedValue({ data: { user: { email: 'staff@cts.co.nz' } } })
    mockPortalMaybeSingle.mockResolvedValueOnce({
      data: { access_type: 'portal' },
      error: null,
    })

    const res = await middleware(buildRequest('/portal/client-b-uuid'))

    const setCookies = res.headers.getSetCookie()
    const accessCount = setCookies.filter(sc => sc.startsWith('sb-access-token=')).length
    const refreshCount = setCookies.filter(sc => sc.startsWith('sb-refresh-token=')).length
    expect(accessCount).toBe(1)
    expect(refreshCount).toBe(1)
  })

  it('unauthenticated /portal/<clientId> hit still redirects even when the supabase helper would emit cookies (no leak on the deny path)', async () => {
    // The refresh path only fires when there's actually a user to
    // refresh; unauth callers hit the earlier `if (!user)` branch which
    // must keep redirecting to /login. Assert the deny path is unchanged
    // even in the presence of the cookie-emitting mock.
    simulateRefresh = true
    getUserMock.mockResolvedValue({ data: { user: null } })

    const res = await middleware(buildRequest('/portal/client-b-uuid/report'))

    expect(res.status).toBe(307)
    const url = new URL(res.headers.get('location')!)
    expect(url.pathname).toBe('/login')
    // Deny path uses the pre-existing NextResponse.redirect built from a
    // fresh URL; portal-only cookie preservation is scoped to the ALLOW
    // path only and must not accidentally spill into the deny path.
    expect(res.headers.get('x-middleware-request-x-user-tier')).toBeNull()
  })

  it('scopes the portal grant to the exact clientId — same email holding portal for A cannot enter /portal/B', async () => {
    // Same-email/two-clients invariant on the portal path: if the email
    // has portal access only for client-a, hitting /portal/<client-b> must
    // NOT be served (the .eq('client_id', clientId) filter returns null).
    // It falls through to the 308-to-dashboard path, where dashboard
    // middleware will reject them for client-b (no ACCESS_TYPES_DASHBOARD
    // row for client-b) — never mixes clients.
    getUserMock.mockResolvedValue({ data: { user: { email: 'staff@cts.co.nz' } } })
    // No portal row for THIS target clientId → maybeSingle returns null.
    mockPortalMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const res = await middleware(buildRequest('/portal/client-b-uuid'))
    expect(res.status).toBe(308)
    const url = new URL(res.headers.get('location')!)
    expect(url.pathname).toBe('/dashboard/clients/client-b-uuid')
    // The 200/next branch must NOT have set the portal_only tier for a
    // request whose portal row was for a different client.
    expect(res.headers.get('x-middleware-request-x-user-tier')).toBeNull()
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

  it('lets an env scoped admin open the project desk only for their client', async () => {
    process.env.DEMO_ADMINS = 'staff@x.com:client-a'
    getUserMock.mockResolvedValue({ data: { user: { email: 'staff@x.com' } } })

    for (const path of ['/dashboard/impact', '/dashboard/impact/new', '/dashboard/impact/client-a']) {
      const res = await middleware(buildRequest(path))
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-request-x-user-role')).toBe('admin')
    }
    const denied = await middleware(buildRequest('/dashboard/impact/client-b'))
    expect(new URL(denied.headers.get('location')!).pathname).toBe('/dashboard/clients/client-a')
  })

  it('lets a DB scoped admin open assigned projects but never another client', async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: 'staff@x.com' } } })
    mockSupabaseIn.mockResolvedValue({
      data: [
        { client_id: 'client-a', access_type: 'fde', scoped_admin: true },
        { client_id: 'client-b', access_type: 'fde', scoped_admin: true },
        { client_id: 'client-c', access_type: 'client', scoped_admin: false },
      ],
      error: null,
    })
    for (const path of ['/dashboard/impact', '/dashboard/impact/new', '/dashboard/impact/client-b']) {
      const res = await middleware(buildRequest(path))
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-request-x-user-role')).toBe('admin')
    }
    const denied = await middleware(buildRequest('/dashboard/impact/client-c'))
    expect(new URL(denied.headers.get('location')!).pathname).toBe('/dashboard/clients/client-a')
  })

  it('keeps a customer account out of the project desk', async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: 'customer@x.com' } } })
    mockSupabaseIn.mockResolvedValue({
      data: [{ client_id: 'client-a', access_type: 'client', scoped_admin: false }],
      error: null,
    })
    const res = await middleware(buildRequest('/dashboard/impact'))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard/clients/client-a')
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

  it('lets a self-serve user through to their client brief page', async () => {
    mockSupabaseIn.mockResolvedValueOnce({
      data: [{ client_id: 'client-self-uuid' }],
      error: null,
    })
    getUserMock.mockResolvedValue({
      data: { user: { email: 'self@x.com' } },
    })

    const res = await middleware(
      buildRequest('/dashboard/clients/client-self-uuid/brief'),
    )

    // Whitelist sourced from ACCESS_TYPES_DASHBOARD constant. Order is
    // significant only because the array passed to `.in()` is the literal
    // ACCESS_TYPES_DASHBOARD readonly tuple — keep this in sync if the
    // constant's element order changes.
    expect(mockSupabaseIn).toHaveBeenCalledWith('access_type', [
      'dashboard',
      'fde',
      'both',
      'self_serve',
      'client',
    ])
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe(
      'client-viewer',
    )
    expect(
      res.headers.get('x-middleware-request-x-allowed-client-id'),
    ).toBe('client-self-uuid')
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
