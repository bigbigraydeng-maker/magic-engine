import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserPermissions: vi.fn(),
  grantSignupBonus: vi.fn(),
  resolveSelfServeLanding: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/auth/whitelist', () => ({
  getUserPermissions: mocks.getUserPermissions,
}))

vi.mock('@/lib/mtc/grant-signup-bonus', () => ({
  grantSignupBonus: mocks.grantSignupBonus,
}))

vi.mock('@/lib/auth/self-serve-routing', () => ({
  resolveSelfServeLanding: mocks.resolveSelfServeLanding,
}))

import { resolveRedirectForSession } from '../resolve-redirect'

function authClient(email: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: email ? { email } : null } }),
    },
  }
}

function accessRows(rows: Array<{ client_id: string; access_type: string }>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: rows }),
  }
}

function scanJobRow(id: string | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: id ? { id } : null }),
  }
}

describe('resolveRedirectForSession', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.getUserPermissions.mockReset()
    mocks.getUserPermissions.mockReturnValue(null)
    mocks.grantSignupBonus.mockReset()
    mocks.grantSignupBonus.mockResolvedValue(false)
    mocks.resolveSelfServeLanding.mockReset()
  })

  it('returns the safe path unchanged when no user is on the session', async () => {
    const redirect = await resolveRedirectForSession(authClient(null), '/dashboard')
    expect(redirect).toBe('/dashboard')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('routes admins to dashboard without touching portal lookups or the bonus', async () => {
    mocks.getUserPermissions.mockReturnValue({ role: 'admin' })
    const redirect = await resolveRedirectForSession(authClient('admin@magiclab.com'), '/prospect')
    expect(redirect).toBe('/dashboard')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('GRANTS the 500 MTC bonus for a self_serve user and returns the landing path', async () => {
    mocks.from.mockReturnValueOnce(accessRows([{ client_id: 'client-1', access_type: 'self_serve' }]))
    mocks.grantSignupBonus.mockResolvedValue(true)
    mocks.resolveSelfServeLanding.mockResolvedValue('/dashboard/clients/client-1/brief?welcome=1')

    const redirect = await resolveRedirectForSession(authClient('owner@biz.com'), '/portal')

    expect(mocks.grantSignupBonus).toHaveBeenCalledWith('client-1')
    expect(mocks.resolveSelfServeLanding).toHaveBeenCalledWith('client-1', '/portal', true)
    expect(redirect).toBe('/dashboard/clients/client-1/brief?welcome=1')
  })

  it('still resolves the self_serve landing even when the bonus was already granted', async () => {
    mocks.from.mockReturnValueOnce(accessRows([{ client_id: 'client-1', access_type: 'self_serve' }]))
    mocks.grantSignupBonus.mockResolvedValue(false)
    mocks.resolveSelfServeLanding.mockResolvedValue('/dashboard/clients/client-1')

    const redirect = await resolveRedirectForSession(authClient('owner@biz.com'), '/dashboard')

    expect(mocks.grantSignupBonus).toHaveBeenCalledWith('client-1')
    expect(mocks.resolveSelfServeLanding).toHaveBeenCalledWith('client-1', '/dashboard', false)
    expect(redirect).toBe('/dashboard/clients/client-1')
  })

  it('routes a plain portal user to their portal without granting a bonus', async () => {
    mocks.from.mockReturnValueOnce(accessRows([{ client_id: 'client-9', access_type: 'portal' }]))
    const redirect = await resolveRedirectForSession(authClient('viewer@biz.com'), '/dashboard')
    expect(redirect).toBe('/portal/client-9')
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('routes a prospect (scan job, no access) to /prospect', async () => {
    mocks.from
      .mockReturnValueOnce(accessRows([]))
      .mockReturnValueOnce(scanJobRow('scan-1'))
    const redirect = await resolveRedirectForSession(authClient('lead@biz.com'), '/dashboard')
    expect(redirect).toBe('/prospect')
    expect(mocks.grantSignupBonus).not.toHaveBeenCalled()
  })

  it('falls back to the safe path for a known email with no access and no scan', async () => {
    mocks.from
      .mockReturnValueOnce(accessRows([]))
      .mockReturnValueOnce(scanJobRow(null))
    const redirect = await resolveRedirectForSession(authClient('nobody@biz.com'), '/dashboard')
    expect(redirect).toBe('/dashboard')
  })
})
