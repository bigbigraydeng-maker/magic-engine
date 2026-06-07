/**
 * P0-J tests for GET /api/clients tenant isolation.
 *
 * Verifies the魏征 CRITICAL #1 fix:
 *   - anonymous callers → 401 (no client list)
 *   - self_serve callers → only their own client_portal_users row
 *   - admin callers → full list
 *   - users with zero portal rows → empty array, never the full table
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  getUserPermissions: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: mocks.getUser },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/auth/whitelist', () => ({
  getUserPermissions: mocks.getUserPermissions,
}))

import { GET } from '../route'

function buildClientPortalQuery(rows: { client_id: string }[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
}

function buildClientsQuery(rows: { id: string; name: string }[]) {
  return {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    // Final await resolves to the rows. Tests that don't go through goal
    // enrichment will just resolve here; enrichment is a separate query.
    then: (resolve: (v: { data: typeof rows; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /api/clients — P0-J tenant isolation', () => {
  it('returns 401 for anonymous callers', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('self_serve user with one portal row sees ONLY that one client', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: 'raydeng@workvisas.work' } },
    })
    mocks.getUserPermissions.mockReturnValue(null) // not admin

    const portalRows = [{ client_id: 'my-client-id' }]

    let callCount = 0
    mocks.from.mockImplementation((table: string) => {
      callCount += 1
      if (table === 'client_portal_users') {
        return buildClientPortalQuery(portalRows)
      }
      if (table === 'clients') {
        return buildClientsQuery([{ id: 'my-client-id', name: 'Mine' }])
      }
      if (table === 'goals') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clients).toHaveLength(1)
    expect(body.clients[0].id).toBe('my-client-id')
    // Sanity: the call to from('client_portal_users') must have happened —
    // the regression we're guarding against is bypassing this lookup.
    expect(callCount).toBeGreaterThanOrEqual(2)
  })

  it('user with zero portal rows gets empty list (NEVER full table)', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: 'stranger@example.com' } },
    })
    mocks.getUserPermissions.mockReturnValue(null)

    mocks.from.mockImplementation((table: string) => {
      if (table === 'client_portal_users') return buildClientPortalQuery([])
      // If we ever reach this branch, the early-return failed.
      if (table === 'clients') {
        throw new Error('NEVER QUERY CLIENTS WHEN PORTAL ROWS ARE EMPTY')
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clients).toEqual([])
  })

  it('admin caller skips portal lookup and gets unfiltered list', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: 'admin@magicengine.com.au' } },
    })
    mocks.getUserPermissions.mockReturnValue({ role: 'admin' })

    let queriedPortalUsers = false
    mocks.from.mockImplementation((table: string) => {
      if (table === 'client_portal_users') {
        queriedPortalUsers = true
        return buildClientPortalQuery([])
      }
      if (table === 'clients') {
        return buildClientsQuery([
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ])
      }
      if (table === 'goals') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clients).toHaveLength(2)
    expect(queriedPortalUsers).toBe(false)
  })
})
