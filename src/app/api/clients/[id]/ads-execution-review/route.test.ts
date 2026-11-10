import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  accessOk: true,
  accessStatus: 200 as number,
  actions: [] as unknown[],
  outcomes: [] as unknown[],
  actionsError: null as { message: string } | null,
  outcomesError: null as { message: string } | null,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => (
    hoisted.accessOk
      ? { ok: true as const, user: { email: 'a@b.c' }, role: 'admin' as const, allowedClientId: null }
      : { ok: false as const, status: hoisted.accessStatus }
  )),
}))

vi.mock('@/lib/supabase', () => {
  function chainFor(table: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    for (const name of ['select', 'eq', 'in', 'not', 'order', 'limit']) {
      chain[name] = passthrough
    }
    chain.then = (resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) => {
      if (table === 'flywheel_actions') {
        return Promise.resolve({ data: hoisted.actions, error: hoisted.actionsError }).then(resolve)
      }
      if (table === 'flywheel_outcomes') {
        return Promise.resolve({ data: hoisted.outcomes, error: hoisted.outcomesError }).then(resolve)
      }
      return Promise.resolve({ data: [], error: null }).then(resolve)
    }
    return chain
  }
  return { supabaseAdmin: { from: (table: string) => chainFor(table) } }
})

const CLIENT = 'c0000000-0000-0000-0000-000000000001'

beforeEach(() => {
  hoisted.accessOk = true
  hoisted.accessStatus = 200
  hoisted.actions = []
  hoisted.outcomes = []
  hoisted.actionsError = null
  hoisted.outcomesError = null
})

describe('GET ads-execution-review', () => {
  it('returns 401 when not logged in', async () => {
    hoisted.accessOk = false
    hoisted.accessStatus = 401
    const { GET } = await import('./route')
    const res = await GET(new Request(`http://localhost/api/clients/${CLIENT}/ads-execution-review`), { params: { id: CLIENT } })
    expect(res.status).toBe(401)
  })

  it('returns panel payload on success', async () => {
    const { GET } = await import('./route')
    const res = await GET(new Request(`http://localhost/api/clients/${CLIENT}/ads-execution-review`), { params: { id: CLIENT } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.panel.client_id).toBe(CLIENT)
    expect(body.panel.items).toEqual([])
  })
})
