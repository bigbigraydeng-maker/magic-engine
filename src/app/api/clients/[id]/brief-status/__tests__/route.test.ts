import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  requirePaidClientAccess: vi.fn(),
  isBriefComplete: vi.fn(),
  from: vi.fn(),
  memberships: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
  requirePaidClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/brief/completion', () => ({
  isBriefComplete: mocks.isBriefComplete,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}))
vi.mock('@/lib/auth/client-portal-membership', () => ({
  clientPortalMembershipsForUser: mocks.memberships,
}))

import { GET } from '../route'

const CLIENT_ID = 'client-123'

function params(id = CLIENT_ID) {
  return { params: { id } }
}

describe('/api/clients/[id]/brief-status', () => {
  beforeEach(() => {
    mocks.requireDashboardClientAccess.mockReset()
    mocks.isBriefComplete.mockReset()
    mocks.from.mockReset()
    mocks.memberships.mockReset().mockResolvedValue({ rows: [], error: null })
  })

  it('returns an auth error when dashboard client access fails', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const res = await GET({} as never, params())
    const body = await res.json() as { error: string }

    expect(res.status).toBe(403)
    expect(body.error).toBe('Forbidden')
    expect(mocks.isBriefComplete).not.toHaveBeenCalled()
  })

  it('fails open for admin users', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: true,
      role: 'admin',
      user: { email: 'admin@example.com' },
      allowedClientId: null,
    })

    const res = await GET({} as never, params())
    const body = await res.json() as { complete: boolean; gated: boolean; reason: string }

    expect(body).toEqual({ complete: true, gated: false, reason: 'admin' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('fails open for non-self-serve dashboard users', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: true,
      role: 'client-viewer',
      user: { email: 'fde@example.com' },
      allowedClientId: CLIENT_ID,
    })
    mocks.memberships.mockResolvedValue({ rows: [{ client_id: CLIENT_ID, access_type: 'dashboard' }], error: null })

    const res = await GET({} as never, params())
    const body = await res.json() as { complete: boolean; gated: boolean; reason: string }

    expect(body).toEqual({ complete: true, gated: false, reason: 'bypass' })
    expect(mocks.isBriefComplete).not.toHaveBeenCalled()
  })

  it('gates self-serve users when their brief is incomplete', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: true,
      role: 'client-viewer',
      user: { email: 'self@example.com' },
      allowedClientId: CLIENT_ID,
    })
    mocks.memberships.mockResolvedValue({ rows: [{ client_id: CLIENT_ID, access_type: 'self_serve' }], error: null })
    mocks.isBriefComplete.mockResolvedValue(false)

    const res = await GET({} as never, params())
    const body = await res.json() as { complete: boolean; gated: boolean; briefUrl: string }

    expect(body).toEqual({
      complete: false,
      gated: true,
      briefUrl: '/dashboard/clients/client-123/brief',
    })
    expect(mocks.isBriefComplete).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('opens self-serve users when their brief is complete', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: true,
      role: 'client-viewer',
      user: { email: 'self@example.com' },
      allowedClientId: CLIENT_ID,
    })
    mocks.memberships.mockResolvedValue({ rows: [{ client_id: CLIENT_ID, access_type: 'self_serve' }], error: null })
    mocks.isBriefComplete.mockResolvedValue(true)

    const res = await GET({} as never, params())
    const body = await res.json() as { complete: boolean; gated: boolean }

    expect(body.complete).toBe(true)
    expect(body.gated).toBe(false)
  })

  it('recognizes a phone-only self-serve member by Auth ID', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: true,
      role: 'client-viewer',
      user: { id: 'phone-user-1', phone: '+8613800001380', email: null },
      allowedClientId: CLIENT_ID,
    })
    mocks.memberships.mockResolvedValue({ rows: [{ client_id: CLIENT_ID, access_type: 'self_serve', email: null }], error: null })
    mocks.isBriefComplete.mockResolvedValue(false)

    const res = await GET({} as never, params())

    expect(await res.json()).toMatchObject({ complete: false, gated: true })
    expect(mocks.isBriefComplete).toHaveBeenCalledWith(CLIENT_ID)
  })
})
