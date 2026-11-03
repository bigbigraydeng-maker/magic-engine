import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ email: null as string | null }))

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () =>
    h.email === null
      ? { ok: false, status: 401, error: 'Unauthorized' }
      : { ok: true, user: { id: 'u', email: h.email } },
}))

const store = vi.hoisted(() => ({
  listVariantBases: vi.fn(),
  getVariantBaseDetail: vi.fn(),
  createVariantOrder: vi.fn(),
}))
vi.mock('@/lib/factory/variant-order-store', () => store)
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { tag: 'admin' } }))

import { GET, POST } from './route'

const CLIENT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const BASE = 'bbbbbbbb-0000-4000-8000-000000000002'

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.ADMIN_EMAILS = 'fde@magiclab.test'
  process.env.DEMO_ADMINS = `demo@x.test:${CLIENT_A}`
  process.env.CLIENT_VIEWERS = `viewer@x.test:${CLIENT_A}`

  h.email = 'fde@magiclab.test'

  store.listVariantBases.mockReset()
  store.getVariantBaseDetail.mockReset()
  store.createVariantOrder.mockReset()

  store.listVariantBases.mockResolvedValue({ ok: true, data: [] })
  store.getVariantBaseDetail.mockResolvedValue({ ok: true, data: { id: BASE } })
  store.createVariantOrder.mockResolvedValue({ ok: true, data: { id: 'new-id', status: 'queued', summary: 'S' } })
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const get = (qs = '') => GET(new Request(`http://x/api/factory/work-orders/variant${qs}`))
const post = (body: unknown) =>
  POST(
    new Request('http://x/api/factory/work-orders/variant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

const validBody = {
  base_work_order_id: BASE,
  change: {
    kind: 'hook',
    lines: [
      { text: 'FROM', badge: null },
      { text: 'NZ$1,999', badge: null },
      { text: '+ FLIGHTS', badge: null },
    ],
  },
  note: 'test',
}

describe('GET /api/factory/work-orders/variant', () => {
  it('no session → 401 and no store call', async () => {
    h.email = null

    const res = await get()

    expect(res.status).toBe(401)
    expect(store.listVariantBases).not.toHaveBeenCalled()
    expect(store.getVariantBaseDetail).not.toHaveBeenCalled()
  })

  it('client-scoped admin → 403 and no store call (internal staff only)', async () => {
    h.email = 'demo@x.test'

    const res = await get()

    expect(res.status).toBe(403)
    expect(store.listVariantBases).not.toHaveBeenCalled()
    expect(store.getVariantBaseDetail).not.toHaveBeenCalled()
  })

  it('client viewer → 403', async () => {
    h.email = 'viewer@x.test'

    const res = await get()

    expect(res.status).toBe(403)
    expect(store.listVariantBases).not.toHaveBeenCalled()
    expect(store.getVariantBaseDetail).not.toHaveBeenCalled()
  })

  it('internal staff, no query → 200, lists all bases', async () => {
    const { supabaseAdmin } = await import('@/lib/supabase')

    const res = await get()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(store.listVariantBases).toHaveBeenCalledTimes(1)
    expect(store.listVariantBases).toHaveBeenCalledWith(supabaseAdmin, null)
    expect(json).toEqual({ bases: [] })
  })

  it('internal staff, ?client=CLIENT_A → passes client through', async () => {
    const { supabaseAdmin } = await import('@/lib/supabase')

    const res = await get(`?client=${CLIENT_A}`)

    expect(res.status).toBe(200)
    expect(store.listVariantBases).toHaveBeenCalledWith(supabaseAdmin, CLIENT_A)
  })

  it('?client=not-a-uuid → 400 and no store call', async () => {
    const res = await get('?client=not-a-uuid')

    expect(res.status).toBe(400)
    expect(store.listVariantBases).not.toHaveBeenCalled()
    expect(store.getVariantBaseDetail).not.toHaveBeenCalled()
  })

  it('?base=BASE → 200, returns base detail', async () => {
    const { supabaseAdmin } = await import('@/lib/supabase')

    const res = await get(`?base=${BASE}`)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(store.getVariantBaseDetail).toHaveBeenCalledWith(supabaseAdmin, BASE)
    expect(json.base.id).toBe(BASE)
  })

  it('?base=xyz → 400', async () => {
    const res = await get('?base=xyz')

    expect(res.status).toBe(400)
    expect(store.getVariantBaseDetail).not.toHaveBeenCalled()
  })

  it('passes through a store error', async () => {
    store.getVariantBaseDetail.mockResolvedValue({ ok: false, status: 409, error: 'E' })

    const res = await get(`?base=${BASE}`)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toBe('E')
  })
})

describe('POST /api/factory/work-orders/variant', () => {
  it('client-scoped admin → 403 and createVariantOrder not called', async () => {
    h.email = 'demo@x.test'

    const res = await post(validBody)

    expect(res.status).toBe(403)
    expect(store.createVariantOrder).not.toHaveBeenCalled()
  })

  it('invalid JSON → 400', async () => {
    const res = await post('{')

    expect(res.status).toBe(400)
    expect(store.createVariantOrder).not.toHaveBeenCalled()
  })

  it('2 hook lines → 400 and createVariantOrder not called', async () => {
    const res = await post({
      ...validBody,
      change: {
        kind: 'hook',
        lines: [
          { text: 'FROM', badge: null },
          { text: 'NZ$1,999', badge: null },
        ],
      },
    })

    expect(res.status).toBe(400)
    expect(store.createVariantOrder).not.toHaveBeenCalled()
  })

  it('valid body → 201 and creates the order', async () => {
    const { supabaseAdmin } = await import('@/lib/supabase')

    const res = await post(validBody)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.order.id).toBe('new-id')
    expect(store.createVariantOrder).toHaveBeenCalledTimes(1)
    expect(store.createVariantOrder).toHaveBeenCalledWith(supabaseAdmin, {
      baseId: BASE,
      change: { kind: 'hook', lines: validBody.change.lines },
      note: 'test',
      actor: 'fde@magiclab.test',
    })
  })

  it('passes through a store 429', async () => {
    store.createVariantOrder.mockResolvedValue({ ok: false, status: 429, error: 'cap' })

    const res = await post(validBody)
    const json = await res.json()

    expect(res.status).toBe(429)
    expect(json.error).toBe('cap')
  })
})
