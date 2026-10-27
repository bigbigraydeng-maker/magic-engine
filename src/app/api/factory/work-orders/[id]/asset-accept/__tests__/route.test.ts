import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  applyAssetAccept: vi.fn(),
  admitAssetBeforeAccept: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminScope: mocks.requireAdminScope }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/factory/review-apply', () => ({ applyAssetAccept: mocks.applyAssetAccept }))
vi.mock('@/lib/ads-strategy/admit-finished-asset-run', () => ({ admitAssetBeforeAccept: mocks.admitAssetBeforeAccept }))

import { POST } from '../route'

const call = () => POST(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: 'wo-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminScope.mockResolvedValue({ ok: true, user: { email: 'staff@example.test' }, scope: { kind: 'global' } })
  mocks.applyAssetAccept.mockResolvedValue({ ok: true, status: 200, data: { status: 'archived' } })
  mocks.admitAssetBeforeAccept.mockResolvedValue({ ok: true, action: 'pooled', videoId: '555', status: 'candidate' })
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
    expect(mocks.admitAssetBeforeAccept).not.toHaveBeenCalled()
    expect(mocks.applyAssetAccept).not.toHaveBeenCalled()
  })

  it('not signed in → the guard status, nothing written', async () => {
    mocks.requireAdminScope.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const res = await call()
    expect(res.status).toBe(401)
    expect(mocks.admitAssetBeforeAccept).not.toHaveBeenCalled()
    expect(mocks.applyAssetAccept).not.toHaveBeenCalled()
  })

  it('a non-material order surfaces the 409 from the lib', async () => {
    mocks.admitAssetBeforeAccept.mockResolvedValue({ ok: true, action: 'not_material' })
    mocks.applyAssetAccept.mockResolvedValue({ ok: false, status: 409, error: 'only asset_only work orders can be accepted as material' })
    const res = await call()
    expect(res.status).toBe(409)
  })

  it('does not archive when the video cannot be uploaded', async () => {
    mocks.admitAssetBeforeAccept.mockResolvedValue({ ok: false, status: 502, error: '成片传到广告账户失败' })
    const res = await call()
    expect(res.status).toBe(502)
    expect(mocks.applyAssetAccept).not.toHaveBeenCalled()
  })

  it('returns the video id and leaves the pool entry pending approval', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      status: 'archived',
      pool: { action: 'pooled', status: 'candidate', video_id: '555' },
    })
  })
})
