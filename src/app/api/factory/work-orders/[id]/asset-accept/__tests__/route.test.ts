import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdminScope: vi.fn(), applyAssetAccept: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminScope: mocks.requireAdminScope }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/factory/review-apply', () => ({ applyAssetAccept: mocks.applyAssetAccept }))

import { POST } from '../route'

const call = () => POST(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: 'wo-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminScope.mockResolvedValue({ ok: true, user: { email: 'staff@example.test' }, scope: { kind: 'global' } })
  mocks.applyAssetAccept.mockResolvedValue({ ok: true, status: 200, data: { status: 'archived' } })
})

describe('POST asset-accept', () => {
  it('internal staff: accepts material', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(mocks.applyAssetAccept).toHaveBeenCalledWith({}, 'wo-1', 'staff@example.test')
  })

  it('a scoped (single-client) admin is refused before anything is written', async () => {
    mocks.requireAdminScope.mockResolvedValue({ ok: true, user: { email: 'demo@example.test' }, scope: { kind: 'client', clientId: 'c-1' } })
    const res = await call()
    expect(res.status).toBe(403)
    expect(mocks.applyAssetAccept).not.toHaveBeenCalled()
  })

  it('not signed in → the guard status, nothing written', async () => {
    mocks.requireAdminScope.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const res = await call()
    expect(res.status).toBe(401)
    expect(mocks.applyAssetAccept).not.toHaveBeenCalled()
  })

  it('a non-material order surfaces the 409 from the lib', async () => {
    mocks.applyAssetAccept.mockResolvedValue({ ok: false, status: 409, error: 'only asset_only work orders can be accepted as material' })
    const res = await call()
    expect(res.status).toBe(409)
  })
})
