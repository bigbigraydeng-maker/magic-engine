import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  memberships: vi.fn(),
  getUserPermissions: vi.fn(),
  resolveRedirect: vi.fn(),
  resolveSelfServeLanding: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))
vi.mock('@/lib/auth/client-portal-membership', () => ({
  clientPortalMembershipsForUser: mocks.memberships,
}))
vi.mock('@/lib/auth/whitelist', () => ({ getUserPermissions: mocks.getUserPermissions }))
vi.mock('@/lib/auth/resolve-redirect', () => ({ resolveRedirectForSession: mocks.resolveRedirect }))
vi.mock('@/lib/auth/self-serve-routing', () => ({ resolveSelfServeLanding: mocks.resolveSelfServeLanding }))
vi.mock('@/lib/auth/china-phone-otp', () => ({
  isChinaPhoneSignupEnabled: () => process.env.CHINA_PHONE_OTP_ENABLED === 'true'
    && process.env.CHINA_PHONE_SIGNUP_ENABLED === 'true'
    && Number.parseInt(process.env.CHINA_PHONE_SMS_DAILY_MAX ?? '', 10) > 0,
}))

import { POST } from '../route'

function request(body: unknown = { businessName: '新工作区', websiteUrl: 'https://example.cn/path', next: '/reports' }) {
  return new NextRequest('http://localhost/api/auth/phone-register/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/phone-register/complete', () => {
  beforeEach(() => {
    vi.stubEnv('CHINA_PHONE_OTP_ENABLED', 'true')
    vi.stubEnv('CHINA_PHONE_SIGNUP_ENABLED', 'true')
    vi.stubEnv('CHINA_PHONE_SMS_DAILY_MAX', '40')
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: {
      id: 'auth-phone-1', phone: '+8613800001380', phone_confirmed_at: '2026-09-30T00:00:00Z', email: null,
    } }, error: null })
    mocks.rpc.mockReset().mockResolvedValue({ data: 'client-1', error: null })
    mocks.memberships.mockReset().mockResolvedValue({ rows: [], error: null })
    mocks.getUserPermissions.mockReset().mockReturnValue(null)
    mocks.resolveRedirect.mockReset().mockResolvedValue('/dashboard')
    mocks.resolveSelfServeLanding.mockReset().mockResolvedValue('/portal/client-1')
  })

  it('creates a workspace for a verified phone-only user without granting email signup bonus', async () => {
    const response = await POST(request())

    expect(response.status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledWith('create_phone_self_serve_workspace', {
      p_auth_user_id: 'auth-phone-1',
      p_business_name: '新工作区',
      p_domain: 'example.cn',
    })
    expect(mocks.resolveSelfServeLanding).toHaveBeenCalledWith('client-1', '/reports', false)
    expect(await response.json()).toMatchObject({ ok: true, clientId: 'client-1', welcomeBonusGranted: false })
  })

  it('requires a verified mainland phone session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'auth-phone-1', phone: '+8613800001380', phone_confirmed_at: null } }, error: null })

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not create another workspace when the user already has portal membership', async () => {
    mocks.memberships.mockResolvedValue({ rows: [{ client_id: 'existing-client' }], error: null })
    mocks.resolveRedirect.mockResolvedValue('/portal/existing-client')

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ existingWorkspace: true, redirect: '/portal/existing-client' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns a conflict if the workspace name already exists', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'business_exists' } })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('business_exists')
  })

  it('fails closed until phone signup and the daily SMS budget are enabled', async () => {
    vi.stubEnv('CHINA_PHONE_SMS_DAILY_MAX', '')

    const response = await POST(request())

    expect(response.status).toBe(503)
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
})
