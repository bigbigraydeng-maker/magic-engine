/**
 * Portal routes: /api/partner/me needs a live portal session (never a ME login), /partner/enter only
 * redeems on a same-origin POST and sets the cookie, admin access-link is global-admin only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: null as string | null,
  redeemed: null as { sessionToken: string; expiresAt: string } | null,
  admin: { ok: true, user: { email: 'pm@example.com' } } as { ok: true; user: { email: string } } | { ok: false; status: 401 | 403; error: string },
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn(async () => h.admin) }))
vi.mock('@/lib/auth/public-origin', () => ({ getPublicOrigin: () => 'https://app.test' }))
vi.mock('@/lib/distributor/portal-view', () => ({ buildPortalView: vi.fn(async (id: string) => ({ profile: { display_name: id } })) }))
vi.mock('@/lib/distributor/portal-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/distributor/portal-auth')>()
  return {
    ...real,
    resolveSession: vi.fn(async (token: string | null) => (token ? h.session : null)),
    redeemInvite: vi.fn(async () => h.redeemed),
    createInvite: vi.fn(async () => ({ token: 'B'.repeat(43), expiresAt: '2026-11-11T00:00:00Z' })),
    revokeSession: vi.fn(async () => undefined),
  }
})

import * as auth from '@/lib/distributor/portal-auth'
import { GET as meGet } from '@/app/api/partner/me/route'
import { GET as enterGet, POST as enterPost } from '@/app/partner/enter/route'
import { POST as accessLinkPost } from '@/app/api/admin/distributors/[id]/access-link/route'
import { NextRequest } from 'next/server'

const TOKEN = 'A'.repeat(43)
const ID = '3f2b8c1e-6a4d-4e2f-9b1a-0c5d7e8f9a0b'

beforeEach(() => {
  h.session = null
  h.redeemed = null
  h.admin = { ok: true, user: { email: 'pm@example.com' } }
  vi.clearAllMocks()
})

describe('/api/partner/me', () => {
  it('is 401 without a portal cookie, even with a ME/Supabase login cookie', async () => {
    const res = await meGet(new Request('https://app.test/api/partner/me', { headers: { cookie: 'sb-xyz-auth-token=abc' } }))
    expect(res.status).toBe(401)
  })

  it('returns the view for a live portal session', async () => {
    h.session = 'd1'
    const res = await meGet(new Request('https://app.test/api/partner/me', { headers: { cookie: `${auth.PORTAL_COOKIE}=${TOKEN}` } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ profile: { display_name: 'd1' } })
  })
})

describe('/partner/enter', () => {
  it('GET never redeems (mail scanners), it only shows the confirm form', async () => {
    const res = await enterGet(new NextRequest(`https://app.test/partner/enter?t=${TOKEN}`))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('name="t"')
    expect(auth.redeemInvite).not.toHaveBeenCalled()
  })

  it('POST from another site is refused without redeeming', async () => {
    const form = new FormData()
    form.set('t', TOKEN)
    const res = await enterPost(new NextRequest('https://app.test/partner/enter', { method: 'POST', body: form, headers: { origin: 'https://evil.example' } }))
    expect(res.headers.get('location')).toBe('https://app.test/partner?link=invalid')
    expect(auth.redeemInvite).not.toHaveBeenCalled()
  })

  it('POST same-origin redeems and sets an httpOnly portal cookie; a used link lands on the expired page', async () => {
    const post = () => new NextRequest('https://app.test/partner/enter', {
      method: 'POST',
      body: new URLSearchParams({ t: TOKEN }),
      headers: { origin: 'https://app.test', 'content-type': 'application/x-www-form-urlencoded' },
    })
    h.redeemed = { sessionToken: 'C'.repeat(43), expiresAt: '2026-12-10T00:00:00Z' }
    const ok = await enterPost(post())
    expect(ok.headers.get('location')).toBe('https://app.test/partner')
    expect(ok.headers.get('set-cookie')).toMatch(new RegExp(`^${auth.PORTAL_COOKIE}=C{43}; Path=/; HttpOnly; SameSite=Lax;.*Secure`))
    h.redeemed = null
    const used = await enterPost(post())
    expect(used.headers.get('location')).toBe('https://app.test/partner?link=expired')
    expect(used.headers.get('set-cookie')).toBeNull()
  })
})

describe('admin access link', () => {
  it('is global-admin only and same-origin only', async () => {
    h.admin = { ok: false, status: 403, error: 'Forbidden' }
    const req = (origin: string) => new NextRequest(`https://app.test/api/admin/distributors/${ID}/access-link`, { method: 'POST', headers: { origin } })
    expect((await accessLinkPost(req('https://app.test'), { params: Promise.resolve({ id: ID }) })).status).toBe(403)
    h.admin = { ok: true, user: { email: 'pm@example.com' } }
    expect((await accessLinkPost(req('https://evil.example'), { params: Promise.resolve({ id: ID }) })).status).toBe(403)
    expect(auth.createInvite).not.toHaveBeenCalled()
    const ok = await accessLinkPost(req('https://app.test'), { params: Promise.resolve({ id: ID }) })
    expect(ok.status).toBe(201)
    expect((await ok.json()).url).toBe(`https://app.test/partner/enter?t=${'B'.repeat(43)}`)
  })
})
