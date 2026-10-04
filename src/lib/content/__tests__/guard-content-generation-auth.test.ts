import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth/whitelist', () => ({
  getUserPermissions: vi.fn(() => null),
}))

import { guardContentGeneration } from '@/lib/content/guard-content-generation'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { createFakeTables, type FakeTables } from '@/lib/content/__tests__/fake-tables'
import type { AccessType } from '@/lib/auth/access-types'

const CLIENT_A = 'a0000000-0000-4000-8000-000000000001'
const CLIENT_B = 'b0000000-0000-4000-8000-000000000002'
const ITEM_A = 'e0000000-0000-4000-8000-0000000000a1'

const mockRequireSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockGetUserPermissions = vi.mocked(getUserPermissions)

const fakeHolder: { current: FakeTables } = {
  current: createFakeTables({}),
}

function mockUser(email: string) {
  mockRequireSession.mockResolvedValue({
    ok: true,
    user: { id: 'user-1', email },
  } as Awaited<ReturnType<typeof requireSession>>)
}

/**
 * Mock rows from client_portal_users. Mirrors the style used in
 * src/lib/auth/__tests__/client-access.test.ts: a chain with
 * select/eq/in where `in` resolves { data, error }.
 */
function mockPortalRows(
  rows: Array<{ client_id: string; access_type?: AccessType; scoped_admin?: boolean }>,
  error: unknown = null,
) {
  const enriched = rows.map((r) => ({
    client_id: r.client_id,
    access_type: r.access_type ?? 'dashboard',
    scoped_admin: r.scoped_admin ?? false,
  }))
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: enriched, error }),
  }
  return chain
}

function installSupabaseMock(portalChain: ReturnType<typeof mockPortalRows>) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'client_portal_users') {
      return portalChain as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    return fakeHolder.current.from(table) as unknown as ReturnType<typeof supabaseAdmin.from>
  })
}

describe('guardContentGeneration (integration with real requirePaidClientAccess)', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mockGetUserPermissions.mockReturnValue(null)

    fakeHolder.current = createFakeTables({
      execution_items: [{ id: ITEM_A, client_id: CLIENT_A }],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when there is no session and never touches the DB', async () => {
    mockRequireSession.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    })

    const portalChain = mockPortalRows([])
    installSupabaseMock(portalChain)

    const response = await guardContentGeneration({ client_id: CLIENT_A })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
    expect(fakeHolder.current.calls).toEqual([])
  })

  it('rejects a self_serve user with 403 reason=paid_only', async () => {
    mockUser('free@example.com')
    const portalChain = mockPortalRows([{ client_id: CLIENT_A, access_type: 'self_serve' }])
    installSupabaseMock(portalChain)

    const response = await guardContentGeneration({ client_id: CLIENT_A })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(403)
    const body = await response?.json()
    expect(body.reason).toBe('paid_only')
  })

  it('rejects a self_serve user before any ownership lookup runs', async () => {
    mockUser('free@example.com')
    const portalChain = mockPortalRows([{ client_id: CLIENT_A, access_type: 'self_serve' }])
    installSupabaseMock(portalChain)

    const response = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: ITEM_A,
    })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(403)
    expect(fakeHolder.current.calls).not.toContain('execution_items')
  })

  it('allows a paid user through (returns null)', async () => {
    mockUser('paid@example.com')
    const portalChain = mockPortalRows([{ client_id: CLIENT_A, access_type: 'dashboard' }])
    installSupabaseMock(portalChain)

    const response = await guardContentGeneration({ client_id: CLIENT_A })

    expect(response).toBeNull()
  })

  it('returns 403 Forbidden when the paid user has no row for the requested client', async () => {
    mockUser('paid@example.com')
    const portalChain = mockPortalRows([{ client_id: CLIENT_B, access_type: 'dashboard' }])
    installSupabaseMock(portalChain)

    const response = await guardContentGeneration({ client_id: CLIENT_A })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(403)
    const body = await response?.json()
    expect(body.error).toBe('Forbidden')
  })

  it('allows a paid user with a matching execution_item and performs the ownership lookup', async () => {
    mockUser('paid@example.com')
    const portalChain = mockPortalRows([{ client_id: CLIENT_A, access_type: 'dashboard' }])
    installSupabaseMock(portalChain)

    const response = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: ITEM_A,
    })

    expect(response).toBeNull()
    expect(fakeHolder.current.calls).toEqual(['execution_items'])
  })

  it('fails closed with 500 when the portal lookup errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUser('paid@example.com')
    const portalChain = mockPortalRows([], { message: 'x' })
    installSupabaseMock(portalChain)

    const response = await guardContentGeneration({ client_id: CLIENT_A })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(500)
  })

  it('returns 401 (not 400) for an unauthenticated caller even with an invalid execution_item_id', async () => {
    mockRequireSession.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    })

    const portalChain = mockPortalRows([])
    installSupabaseMock(portalChain)

    const response = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: 'not-a-uuid',
    })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
  })
})
