import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const paid = vi.fn()
const operator = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: (...a: unknown[]) => paid(...a),
  requireOperatorAccess: (...a: unknown[]) => operator(...a),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/supabase-paginate', () => ({ fetchAll: async () => [] }))
vi.mock('@/lib/ledger/load', () => ({
  loadLedger: () => ({
    entries: [{ id: 'x', title: '内部卡', status: 'decided', verifyBy: '2026-11-04' }],
    errors: [],
    warnings: [],
  }),
}))

import { GET } from './route'

const call = (month = '2026-11') =>
  GET(new NextRequest(`http://localhost/api/clients/c1/crm/calendar?month=${month}`), { params: { id: 'c1' } })
const ok = (allowedClientId: string | null) => ({ ok: true, allowedClientId, tier: 'admin', role: 'admin', user: {} })

describe('GET /crm/calendar', () => {
  beforeEach(() => {
    paid.mockResolvedValue(ok(null))
    operator.mockResolvedValue(ok(null))
  })

  it('rejects when not allowed', async () => {
    paid.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    expect((await call()).status).toBe(403)
  })

  it('rejects a malformed month', async () => {
    expect((await call('2026-13')).status).toBe(400)
  })

  it('gives the ledger to a global admin only', async () => {
    const body = await (await call()).json()
    expect(body.includesLedger).toBe(true)
    expect(body.items.map((i: { refId: string }) => i.refId)).toEqual(['x'])
  })

  it('hides the ledger from a client-scoped admin', async () => {
    operator.mockResolvedValue(ok('c1'))
    const body = await (await call()).json()
    expect(body.includesLedger).toBe(false)
    expect(body.items).toEqual([])
  })

  it('hides the ledger from a non-operator (client role)', async () => {
    operator.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    const body = await (await call()).json()
    expect(body.includesLedger).toBe(false)
  })
})
