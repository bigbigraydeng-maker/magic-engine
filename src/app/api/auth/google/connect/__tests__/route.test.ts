import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

import { GET } from '../route'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

function makeRequest(params: { clientId?: string; flow?: string }) {
  const url = new URL('http://localhost:3001/api/auth/google/connect')
  if (params.clientId) url.searchParams.set('client_id', params.clientId)
  if (params.flow)     url.searchParams.set('flow', params.flow)
  return new NextRequest(url)
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_CLIENT_ID     = 'goog-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'goog-client-secret'
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
})

describe('狄仁杰 2026-08-11 攻击验证 — 谁都能拿一个 client UUID 冒充连接，之前完全没鉴权', () => {
  it('flow=admin: rejects when the caller has no access to this client', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await GET(makeRequest({ clientId: CLIENT_ID, flow: 'admin' }))

    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull()   // never issued a redirect to Google
  })

  it('flow=wizard: rejects an unauthenticated caller — this is exactly the button wired into the onboarding page', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })

    const res = await GET(makeRequest({ clientId: CLIENT_ID, flow: 'wizard' }))

    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })

  it('flow=admin: proceeds to Google when the caller does have access', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, flow: 'admin' }))

    expect(res.status).toBe(307)   // NextResponse.redirect() default when no status is passed
    expect(res.headers.get('location') ?? '').toContain('accounts.google.com')
    expect(mocks.requireDashboardClientAccess).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('flow=wizard: proceeds to Google when the caller does have access', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, flow: 'wizard' }))

    expect(res.status).toBe(307)   // NextResponse.redirect() default when no status is passed
    expect(res.headers.get('location') ?? '').toContain('accounts.google.com')
  })

  it('flow=connect (default, no login): the no-login public page is NOT gated by this check — separate issue, spec §2.1 B1', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, flow: 'connect' }))

    expect(mocks.requireDashboardClientAccess).not.toHaveBeenCalled()
    expect(res.status).toBe(307)   // NextResponse.redirect() default when no status is passed
  })
})

describe('validation', () => {
  it('returns 400 when client_id is missing', async () => {
    const res = await GET(makeRequest({ flow: 'admin' }))
    expect(res.status).toBe(400)
  })
})
