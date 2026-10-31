import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireSession, getUserPermissions, query, inAccessTypes } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getUserPermissions: vi.fn(),
  query: vi.fn(),
  inAccessTypes: vi.fn(),
}))

vi.mock('@/lib/auth/require-session', () => ({ requireSession }))
vi.mock('@/lib/auth/whitelist', () => ({ getUserPermissions }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ in: inAccessTypes }) }),
    }),
  },
}))

import { requireStaffScope, staffCanOpenClient } from './staff'

describe('project desk staff scope', () => {
  beforeEach(() => {
    requireSession.mockReset()
    getUserPermissions.mockReset()
    inAccessTypes.mockReset()
    query.mockReset()
    requireSession.mockResolvedValue({ ok: true, user: { email: 'staff@x.com' } })
    getUserPermissions.mockReturnValue(null)
    inAccessTypes.mockImplementation(query)
  })

  it('scopes DB staff to only rows marked scoped admin', async () => {
    query.mockResolvedValue({
      data: [
        { client_id: 'client-a', scoped_admin: true },
        { client_id: 'client-b', scoped_admin: true },
        { client_id: 'client-c', scoped_admin: false },
      ],
      error: null,
    })
    const scope = await requireStaffScope()
    expect(scope).toEqual({ ok: true, kind: 'clients', clientIds: ['client-a', 'client-b'] })
    expect(staffCanOpenClient(scope, 'client-b')).toBe(true)
    expect(staffCanOpenClient(scope, 'client-c')).toBe(false)
  })

  it('fails closed for a customer row or failed lookup', async () => {
    query.mockResolvedValueOnce({ data: [{ client_id: 'client-a', scoped_admin: false }], error: null })
    expect((await requireStaffScope()).ok).toBe(false)
    query.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } })
    expect((await requireStaffScope()).ok).toBe(false)
  })

  it('keeps env scoped admin limited to one client without a DB lookup', async () => {
    getUserPermissions.mockReturnValue({ role: 'admin', allowedClientId: 'client-a' })
    const scope = await requireStaffScope()
    expect(scope).toEqual({ ok: true, kind: 'clients', clientIds: ['client-a'] })
    expect(staffCanOpenClient(scope, 'client-b')).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })
})
