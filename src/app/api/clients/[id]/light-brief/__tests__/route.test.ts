import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  memberships: vi.fn(),
  from: vi.fn(),
  invalidateBriefCache: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: mocks.requireDashboardClientAccess }))
vi.mock('@/lib/auth/client-portal-membership', () => ({ clientPortalMembershipsForUser: mocks.memberships }))
vi.mock('@/lib/brief/completion', () => ({ invalidateBriefCache: mocks.invalidateBriefCache }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { GET } from '../route'

const CLIENT_ID = 'client-123'

describe('GET /api/clients/[id]/light-brief', () => {
  beforeEach(() => {
    mocks.requireDashboardClientAccess.mockReset().mockResolvedValue({
      ok: true,
      role: 'client-viewer',
      user: { id: 'phone-user-1', email: null, phone: '+8613800001380' },
      allowedClientId: CLIENT_ID,
    })
    mocks.memberships.mockReset().mockResolvedValue({ rows: [{ client_id: CLIENT_ID, access_type: 'self_serve' }], error: null })
    mocks.from.mockReset().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { brief_fields: { company_name: 'Company' }, brief_completed_at: null }, error: null }),
    })
  })

  it('loads the brief for a phone-only self-serve user by Auth ID membership', async () => {
    const response = await GET({} as never, { params: { id: CLIENT_ID } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ brief_fields: { company_name: 'Company' }, brief_completed_at: null })
    expect(mocks.memberships).toHaveBeenCalledWith(expect.objectContaining({ id: 'phone-user-1', email: null }))
    expect(mocks.from).toHaveBeenCalledWith('clients')
  })
})
