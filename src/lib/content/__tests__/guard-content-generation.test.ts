import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({
  current: null as unknown,
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const fake = holder.current as {
        from: (t: string) => unknown
      }
      return fake.from(table)
    },
  },
}))

import { guardContentGeneration } from '../guard-content-generation'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createFakeTables, type FakeTables } from './fake-tables'

const mockAccess = vi.mocked(requirePaidClientAccess)

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

let fake: FakeTables

function body(res: { json: () => Promise<unknown> } | null) {
  return res!.json()
}

beforeEach(() => {
  fake = createFakeTables(SEED)
  holder.current = fake
  mockAccess.mockResolvedValue({ ok: true } as never)
})

afterEach(() => vi.clearAllMocks())

describe('guardContentGeneration', () => {
  it('rejects a missing client_id with 400 and never authenticates', async () => {
    const res = await guardContentGeneration({ client_id: undefined })
    expect(res!.status).toBe(400)
    expect((await body(res)) as { success: boolean }).toMatchObject({ success: false })
    expect(mockAccess).not.toHaveBeenCalled()
    expect(fake.calls).toEqual([])
  })

  it('rejects a numeric client_id with 400', async () => {
    const res = await guardContentGeneration({ client_id: 123 })
    expect(res!.status).toBe(400)
    expect((await body(res)) as { success: boolean }).toMatchObject({ success: false })
    expect(mockAccess).not.toHaveBeenCalled()
    expect(fake.calls).toEqual([])
  })

  it('rejects a non-uuid client_id with 400', async () => {
    const res = await guardContentGeneration({ client_id: 'abc' })
    expect(res!.status).toBe(400)
    expect((await body(res)) as { success: boolean }).toMatchObject({ success: false })
    expect(mockAccess).not.toHaveBeenCalled()
    expect(fake.calls).toEqual([])
  })

  it('rejects an uppercase client_id with 400', async () => {
    const res = await guardContentGeneration({ client_id: CLIENT_A.toUpperCase() })
    expect(res!.status).toBe(400)
    expect((await body(res)) as { success: boolean }).toMatchObject({ success: false })
    expect(mockAccess).not.toHaveBeenCalled()
    expect(fake.calls).toEqual([])
  })

  it('passes through an unauthenticated 401 without touching the DB', async () => {
    mockAccess.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
      reason: 'unauthorized',
    } as never)

    const res = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: ITEM_A,
    })

    expect(res!.status).toBe(401)
    expect(await body(res)).toEqual({
      success: false,
      error: 'Unauthorized',
      reason: 'unauthorized',
    })
    expect(fake.calls).toEqual([])
  })

  it('passes through a wrong-client 403', async () => {
    mockAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      reason: 'forbidden',
    } as never)

    const res = await guardContentGeneration({ client_id: CLIENT_A })
    expect(res!.status).toBe(403)
  })

  it('rejects self_serve with a paid_only 403', async () => {
    mockAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'This feature requires a paid plan. Contact Magic Lab to unlock.',
      reason: 'paid_only',
    } as never)

    const res = await guardContentGeneration({ client_id: CLIENT_A })
    expect(res!.status).toBe(403)
    expect((await body(res)) as { reason: string }).toMatchObject({ reason: 'paid_only' })
  })

  it('passes through a lookup_failed 500', async () => {
    mockAccess.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Authorization check failed',
      reason: 'lookup_failed',
    } as never)

    const res = await guardContentGeneration({ client_id: CLIENT_A })
    expect(res!.status).toBe(500)
  })

  it('calls requirePaidClientAccess exactly once with the client id', async () => {
    await guardContentGeneration({ client_id: CLIENT_A })
    expect(mockAccess).toHaveBeenCalledTimes(1)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
  })

  it('returns null with no optional ids and no DB reads', async () => {
    const res = await guardContentGeneration({ client_id: CLIENT_A })
    expect(res).toBeNull()
    expect(fake.calls).toEqual([])
  })

  it('returns null when optional ids are null/undefined', async () => {
    const res = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: null,
      production_package_id: undefined,
    })
    expect(res).toBeNull()
    expect(fake.calls).toEqual([])
  })

  it('allows an execution item owned by the client', async () => {
    const res = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: ITEM_A,
    })
    expect(res).toBeNull()
    expect(fake.calls).toEqual(['execution_items'])
  })

  it("rejects another client's execution item", async () => {
    const res = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: ITEM_B,
    })
    expect(res!.status).toBe(403)
    expect((await body(res)) as { error: string }).toMatchObject({ error: 'Forbidden' })
  })

  it('rejects a non-existent execution item with the same body as a foreign one', async () => {
    const foreign = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: ITEM_B,
    })
    const missing = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: 'e0000000-0000-4000-8000-0000000000ff',
    })

    expect(missing!.status).toBe(403)
    expect(await body(missing)).toEqual(await body(foreign))
  })

  it('allows an owned package and rejects a foreign package', async () => {
    const own = await guardContentGeneration({
      client_id: CLIENT_A,
      production_package_id: PKG_A,
    })
    expect(own).toBeNull()
    expect(fake.calls).toEqual(['production_packages'])

    fake = createFakeTables(SEED)
    holder.current = fake

    const foreign = await guardContentGeneration({
      client_id: CLIENT_A,
      production_package_id: PKG_B,
    })
    expect(foreign!.status).toBe(403)
    expect((await body(foreign)) as { error: string }).toMatchObject({ error: 'Forbidden' })
  })

  it('rejects an execution item id passed as a production_package_id', async () => {
    const res = await guardContentGeneration({
      client_id: CLIENT_A,
      production_package_id: ITEM_A,
    })
    expect(res!.status).toBe(403)
  })

  it('allows both owned ids and reads both tables in order', async () => {
    const res = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: ITEM_A,
      production_package_id: PKG_A,
    })
    expect(res).toBeNull()
    expect(fake.calls).toEqual(['execution_items', 'production_packages'])
  })

  it('rejects invalid execution_item_id values with 400', async () => {
    const invalid: unknown[] = ['', 0, false, {}, [], 'abc', ITEM_A.toUpperCase()]

    for (const value of invalid) {
      fake = createFakeTables(SEED)
      holder.current = fake

      const res = await guardContentGeneration({
        client_id: CLIENT_A,
        execution_item_id: value,
      })

      expect(res!.status).toBe(400)
      expect((await body(res)) as { error: string }).toMatchObject({
        error: expect.stringContaining('execution_item_id'),
      })
      expect(fake.calls).toEqual([])
    }
  })

  it('rejects invalid production_package_id values with 400', async () => {
    const invalid: unknown[] = ['', 0, false, {}, [], 'abc', PKG_A.toUpperCase()]

    for (const value of invalid) {
      fake = createFakeTables(SEED)
      holder.current = fake

      const res = await guardContentGeneration({
        client_id: CLIENT_A,
        production_package_id: value,
      })

      expect(res!.status).toBe(400)
      expect((await body(res)) as { error: string }).toMatchObject({
        error: expect.stringContaining('production_package_id'),
      })
      expect(fake.calls).toEqual([])
    }
  })

  it('fails closed with 500 when the DB errors', async () => {
    fake = createFakeTables(SEED, { errorOnTable: 'execution_items' })
    holder.current = fake

    const res = await guardContentGeneration({
      client_id: CLIENT_A,
      execution_item_id: ITEM_A,
    })

    expect(res!.status).toBe(500)
    expect((await body(res)) as { error: string }).toMatchObject({
      error: 'Authorization check failed',
    })
  })

  it('fails closed with 500 and leaks nothing when access throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAccess.mockRejectedValue(new Error('secret db password leaked'))

    const res = await guardContentGeneration({ client_id: CLIENT_A })

    expect(res!.status).toBe(500)
    const parsed = await body(res)
    expect(parsed).toMatchObject({ error: 'Authorization check failed' })
    expect(JSON.stringify(parsed)).not.toContain('secret')

    spy.mockRestore()
  })
})
