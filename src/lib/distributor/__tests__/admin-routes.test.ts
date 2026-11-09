/**
 * The three distributor admin routes: only global admins, same-origin writes, validation before any
 * database call, and the actor email passed through for the audit columns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  access: { ok: true, user: { email: 'pm@example.com' } } as
    | { ok: true; user: { email: string } }
    | { ok: false; status: 401 | 403; error: string },
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn(async () => h.access) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/distributor/store', async () => {
  class DistributorStoreError extends Error {
    constructor(message: string, readonly status: number) {
      super(message)
    }
  }
  return {
    DistributorStoreError,
    listDistributors: vi.fn(async () => []),
    createDistributor: vi.fn(async () => ({ id: 'd1' })),
    decideDistributor: vi.fn(async () => ({ id: 'd1', status: 'approved' })),
    listSales: vi.fn(async () => []),
    recordSale: vi.fn(async () => ({ id: 's1' })),
    recordRefund: vi.fn(async () => ({ id: 'r1' })),
  }
})

import * as store from '@/lib/distributor/store'
import { GET as listGet, POST as createPost } from '@/app/api/admin/distributors/route'
import { POST as decisionPost } from '@/app/api/admin/distributors/[id]/decision/route'
import { POST as salesPost } from '@/app/api/admin/distributors/sales/route'

const ID = '3f2b8c1e-6a4d-4e2f-9b1a-0c5d7e8f9a0b'

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://me.test/api/admin/distributors', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  h.access = { ok: true, user: { email: 'pm@example.com' } }
  vi.clearAllMocks()
})

describe('access', () => {
  it('refuses non-admins and scoped admins before touching the store', async () => {
    h.access = { ok: false, status: 403, error: 'Forbidden' }
    expect((await listGet(new Request('http://me.test/x'))).status).toBe(403)
    expect((await createPost(req({ display_name: 'A' }))).status).toBe(403)
    expect((await salesPost(req({ type: 'sale' }))).status).toBe(403)
    expect(store.listDistributors).not.toHaveBeenCalled()
    expect(store.createDistributor).not.toHaveBeenCalled()
  })

  it('refuses signed-out users with 401', async () => {
    h.access = { ok: false, status: 401, error: 'Unauthorized' }
    expect((await listGet(new Request('http://me.test/x'))).status).toBe(401)
  })

  it('refuses cross-origin writes', async () => {
    const res = await createPost(req({ display_name: 'A' }, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(store.createDistributor).not.toHaveBeenCalled()
  })

  it('refuses an admin session with an empty email', async () => {
    h.access = { ok: true, user: { email: '' } }
    expect((await createPost(req({ display_name: 'A' }))).status).toBe(403)
  })
})

describe('writes', () => {
  it('validates before writing', async () => {
    expect((await createPost(req({ display_name: '' }))).status).toBe(400)
    expect((await decisionPost(req({ decision: 'approve' }), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(400)
    expect((await salesPost(req({ type: 'gift' }))).status).toBe(400)
    expect(store.createDistributor).not.toHaveBeenCalled()
    expect(store.decideDistributor).not.toHaveBeenCalled()
  })

  it('passes the admin email as the actor', async () => {
    const res = await decisionPost(req({ decision: 'approve' }), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(200)
    expect(store.decideDistributor).toHaveBeenCalledWith(ID, 'approve', 'pm@example.com')
    const sale = await salesPost(req({ type: 'refund', refund_of_sale_id: ID, amount_cents: 100, order_ref: 'RF', paid_at: '2026-11-09T10:00:00+13:00' }))
    expect(sale.status).toBe(201)
    expect(store.recordRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 100 }), 'pm@example.com')
  })

  it('maps store conflicts to their status and hides database errors', async () => {
    vi.mocked(store.createDistributor).mockRejectedValueOnce(new store.DistributorStoreError('the upline must be an approved distributor', 409))
    const conflict = await createPost(req({ display_name: 'A' }))
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'the upline must be an approved distributor' })
    vi.mocked(store.createDistributor).mockRejectedValueOnce(new store.DistributorStoreError('secret detail', 500))
    const broken = await createPost(req({ display_name: 'A' }))
    expect(await broken.json()).toEqual({ error: 'Database error' })
  })
})
