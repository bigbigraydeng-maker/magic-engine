import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { clientPortalMembershipsForUser } from '../client-portal-membership'

function query(data: unknown[], error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data, error }),
  }
}

describe('clientPortalMembershipsForUser', () => {
  beforeEach(() => mocks.from.mockReset())

  it('resolves a phone-only member by Auth ID', async () => {
    mocks.from.mockReturnValueOnce(query([{
      id: 'membership-1', email: null, auth_user_id: 'user-1', client_id: 'client-1',
      display_name: 'Company', access_type: 'self_serve', scoped_admin: false,
    }]))

    const result = await clientPortalMembershipsForUser({ id: 'user-1', email: null })

    expect(mocks.from).toHaveBeenCalledTimes(1)
    expect(result.error).toBeNull()
    expect(result.rows.map(row => row.client_id)).toEqual(['client-1'])
  })

  it('unions legacy email and Auth ID memberships, preferring the matching Auth ID row', async () => {
    mocks.from
      .mockReturnValueOnce(query([{
        id: 'id-row', email: 'owner@example.com', auth_user_id: 'user-1', client_id: 'client-1',
        display_name: 'Company', access_type: 'self_serve', scoped_admin: false,
      }]))
      .mockReturnValueOnce(query([
        { id: 'email-duplicate', email: 'owner@example.com', auth_user_id: 'user-2', client_id: 'client-1', display_name: 'Other', access_type: 'client', scoped_admin: false },
        { id: 'email-row', email: 'owner@example.com', auth_user_id: null, client_id: 'client-2', display_name: 'Legacy', access_type: 'dashboard', scoped_admin: false },
      ]))

    const result = await clientPortalMembershipsForUser({ id: 'user-1', email: 'OWNER@example.com' })

    expect(result.rows).toHaveLength(2)
    expect(result.rows.find(row => row.client_id === 'client-1')?.id).toBe('id-row')
    expect(result.rows.find(row => row.client_id === 'client-2')?.id).toBe('email-row')
  })

  it('fails closed when the Auth ID lookup fails', async () => {
    const error = new Error('database unavailable')
    mocks.from.mockReturnValueOnce(query([], error))

    const result = await clientPortalMembershipsForUser({ id: 'user-1' })

    expect(result).toEqual({ rows: [], error })
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })
})
