import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  getUserPermissions: vi.fn(),
  resolveSelfServeLanding: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('@/lib/auth/whitelist', () => ({ getUserPermissions: mocks.getUserPermissions }))
vi.mock('@/lib/auth/self-serve-routing', () => ({ resolveSelfServeLanding: mocks.resolveSelfServeLanding }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { phoneLinkAccessForUser, phoneLinkWorkspaceForEmail } from '../phone-link-access'

function user(email = 'customer@example.com') {
  return { id: 'user-1', email } as User
}

describe('phoneLinkAccessForUser', () => {
  beforeEach(() => {
    mocks.getUserPermissions.mockReset().mockReturnValue(null)
    mocks.resolveSelfServeLanding.mockReset().mockResolvedValue('/dashboard/clients/client-self-serve/onboarding')
    mocks.eq.mockReset().mockResolvedValue({ data: [{ access_type: 'self_serve', scoped_admin: false }], error: null })
    mocks.select.mockReset().mockImplementation(() => ({ eq: mocks.eq }))
    mocks.from.mockReset().mockImplementation(() => ({ select: mocks.select }))
  })

  it('allows existing customer rows and normalizes the account email', async () => {
    expect(await phoneLinkAccessForUser(user(' Customer@Example.com '))).toBe('allowed')
    expect(mocks.eq).toHaveBeenCalledWith('email', 'customer@example.com')
  })

  it('denies staff-only and scoped-admin rows', async () => {
    mocks.eq.mockResolvedValueOnce({ data: [{ access_type: 'fde', scoped_admin: false }], error: null })
    expect(await phoneLinkAccessForUser(user())).toBe('denied')

    mocks.eq.mockResolvedValueOnce({ data: [{ access_type: 'client', scoped_admin: true }], error: null })
    expect(await phoneLinkAccessForUser(user())).toBe('denied')
  })

  it('denies global administrators', async () => {
    mocks.getUserPermissions.mockReturnValue({ role: 'admin' })
    expect(await phoneLinkAccessForUser(user())).toBe('denied')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('reports membership-store failures separately so callers fail closed', async () => {
    mocks.eq.mockResolvedValue({ data: null, error: { message: 'offline' } })
    expect(await phoneLinkAccessForUser(user())).toBe('unavailable')
  })

  it('returns the matching portal workspace instead of assuming dashboard access', async () => {
    mocks.eq.mockResolvedValue({
      data: [{ client_id: 'portal-client', access_type: 'portal', scoped_admin: false }],
      error: null,
    })

    await expect(phoneLinkWorkspaceForEmail(' Customer@Example.com ')).resolves.toBe('/portal/portal-client')
  })

  it('uses the established self-serve landing for self-serve customers', async () => {
    mocks.eq.mockResolvedValue({
      data: [{ client_id: 'self-serve-client', access_type: 'self_serve', scoped_admin: false }],
      error: null,
    })

    await expect(phoneLinkWorkspaceForEmail('customer@example.com')).resolves.toBe(
      '/dashboard/clients/client-self-serve/onboarding',
    )
    expect(mocks.resolveSelfServeLanding).toHaveBeenCalledWith('self-serve-client', '/dashboard')
  })
})
