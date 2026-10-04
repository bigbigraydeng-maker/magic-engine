import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-session', () => ({ requireSession: vi.fn() }))
vi.mock('@/lib/auth/whitelist', () => ({ getUserPermissions: vi.fn(() => null) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { guardContentGeneration } from '@/lib/content/guard-content-generation'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'
import { createFakeTables, type FakeTables } from '@/lib/content/__tests__/fake-tables'
import type { AccessType } from '@/lib/auth/access-types'

const CLIENT_A = 'a0000000-0000-4000-8000-000000000001'
const CLIENT_B = 'b0000000-0000-4000-8000-000000000002'
const ITEM_A = 'e0000000-0000-4000-8000-0000000000a1'
const ITEM_B = 'e0000000-0000-4000-8000-0000000000b1'
const PKG_A = 'f0000000-0000-4000-8000-0000000000a1'
const PKG_B = 'f0000000-0000-4000-8000-0000000000b1'

const SEED = {
  execution_items: [
    { id: ITEM_A, client_id: CLIENT_A },
    { id: ITEM_B, client_id: CLIENT_B },
  ],
  production_packages: [
    { id: PKG_A, client_id: CLIENT_A },
    { id: PKG_B, client_id: CLIENT_B },
  ],
}

const mockRequireSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)
const holder: { current: FakeTables } = { current: createFakeTables(SEED) }

function mockUser(email: string) {
  mockRequireSession.mockResolvedValue({
    ok: true,
    user: { id: 'user-1', email },
  } as never)
}

function mockPortalRows(
  rows: Array<{ client_id: string; access_type?: AccessType }>,
  error: unknown = null,
) {
  const enriched = rows.map((r) => ({
    client_id: r.client_id,
    access_type: r.access_type ?? 'dashboard',
    scoped_admin: false,
  }))
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: enriched, error }),
  }
}

function install(portal: ReturnType<typeof mockPortalRows>) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'client_portal_users') return portal as never
    return holder.current.from(table) as never
  })
}

function paid(clientId: string) {
  mockUser('paid@example.com')
  install(mockPortalRows([{ client_id: clientId, access_type: 'dashboard' }]))
}

async function body(res: { json: () => Promise<unknown> } | null) {
  return res!.json()
}

beforeEach(() => {
  vi.resetAllMocks()
  holder.current = createFakeTables(SEED)
})

afterEach(() => vi.restoreAllMocks())

describe('guardContentGeneration', () => {
  it.each([
    ['missing', undefined],
    ['numeric', 123],
    ['non-uuid', 'abc'],
    ['uppercase', CLIENT_A.toUpperCase()],
  ])('rejects a %s client_id with 400 and never authenticates', async (_label, value) => {
    const res = await guardContentGeneration({ client_id: value })
    expect(res!.status).toBe(400)
    expect(await body(res)).toMatchObject({ success: false })
    expect(mockRequireSession).not.toHaveBeenCalled()
    expect(holder.current.calls).toEqual([])
  })

  it('returns 401 with no session and never queries a table', async () => {
    mockRequireSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)
    install(mockPortalRows([]))
    const res = await guardContentGeneration({ client_id: CLIENT_A })
    expect(res!.status).toBe(401)
    expect(holder.current.calls).toEqual([])
  })

  it('rejects a self_serve user with 403 paid_only before any ownership lookup', async () => {
    mockUser('free@example.com')
    install(mockPortalRows([{ client_id: CLIENT_A, access_type: 'self_serve' }]))
    const res = await guardContentGeneration({ client_id: CLIENT_A, execution_item_id: ITEM_A })
    expect(res!.status).toBe(403)
    expect(await body(res)).toMatchObject({ reason: 'paid_only' })
    expect(holder.current.calls).not.toContain('execution_items')
  })

  it('allows a paid row for the requested client and rejects a foreign one', async () => {
    paid(CLIENT_A)
    expect(await guardContentGeneration({ client_id: CLIENT_A })).toBeNull()

    paid(CLIENT_B)
    const res = await guardContentGeneration({ client_id: CLIENT_A })
    expect(res!.status).toBe(403)
    expect(await body(res)).toMatchObject({ error: 'Forbidden' })
  })

  it('fails closed with 500 when the portal lookup errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUser('paid@example.com')
    install(mockPortalRows([], { message: 'x' }))
    const res = await guardContentGeneration({ client_id: CLIENT_A })
    expect(res!.status).toBe(500)
  })

  it('skips null/undefined optional ids without querying', async () => {
    paid(CLIENT_A)
    const res = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: null,
      production_package_id: undefined,
    })
    expect(res).toBeNull()
    expect(holder.current.calls).toEqual([])
  })

  it.each([
    ['execution_item_id', 'execution_items', ITEM_A, ITEM_B],
    ['production_package_id', 'production_packages', PKG_A, PKG_B],
  ])('checks ownership of %s', async (field, table, own, foreign) => {
    paid(CLIENT_A)
    expect(await guardContentGeneration({ client_id: CLIENT_A, [field]: own })).toBeNull()
    expect(holder.current.calls).toEqual([table])

    holder.current = createFakeTables(SEED)
    const foreignRes = await guardContentGeneration({ client_id: CLIENT_A, [field]: foreign })
    expect(foreignRes!.status).toBe(403)
    const foreignBody = await body(foreignRes)
    expect(foreignBody).toMatchObject({ error: 'Forbidden' })

    holder.current = createFakeTables(SEED)
    const missingRes = await guardContentGeneration({
      client_id: CLIENT_A,
      [field]: 'e0000000-0000-4000-8000-0000000000ff',
    })
    expect(missingRes!.status).toBe(403)
    expect(await body(missingRes)).toEqual(foreignBody)
  })

  it('rejects an execution item id passed as a production_package_id', async () => {
    paid(CLIENT_A)
    const res = await guardContentGeneration({ client_id: CLIENT_A, production_package_id: ITEM_A })
    expect(res!.status).toBe(403)
  })

  it('allows both owned ids and reads both tables in order', async () => {
    paid(CLIENT_A)
    const res = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: ITEM_A,
      production_package_id: PKG_A,
    })
    expect(res).toBeNull()
    expect(holder.current.calls).toEqual(['execution_items', 'production_packages'])
  })

  it.each([
    ['execution_item_id', ITEM_A],
    ['production_package_id', PKG_A],
  ])('rejects invalid %s values with 400 and no query', async (field, upper) => {
    paid(CLIENT_A)
    for (const value of ['', 0, false, {}, [], 'abc', upper.toUpperCase()]) {
      holder.current = createFakeTables(SEED)
      const res = await guardContentGeneration({ client_id: CLIENT_A, [field]: value })
      expect(res!.status).toBe(400)
      expect(await body(res)).toMatchObject({ error: expect.stringContaining(field) })
      expect(holder.current.calls).toEqual([])
    }
  })

  it('returns 401 (not 400) for an unauthenticated caller with an invalid execution_item_id', async () => {
    mockRequireSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)
    install(mockPortalRows([]))
    const res = await guardContentGeneration({ client_id: CLIENT_A, execution_item_id: 'not-a-uuid' })
    expect(res!.status).toBe(401)
  })

  it('fails closed with 500 when the ownership query errors', async () => {
    paid(CLIENT_A)
    holder.current = createFakeTables(SEED, { errorOnTable: 'execution_items' })
    const res = await guardContentGeneration({ client_id: CLIENT_A, execution_item_id: ITEM_A })
    expect(res!.status).toBe(500)
    expect(await body(res)).toMatchObject({ error: 'Authorization check failed' })
  })

  it('fails closed with 500 and leaks nothing when auth throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRequireSession.mockRejectedValue(new Error('secret db password leaked'))
    const res = await guardContentGeneration({ client_id: CLIENT_A })
    expect(res!.status).toBe(500)
    const parsed = await body(res)
    expect(parsed).toMatchObject({ error: 'Authorization check failed' })
    expect(JSON.stringify(parsed)).not.toContain('secret')
  })
})
