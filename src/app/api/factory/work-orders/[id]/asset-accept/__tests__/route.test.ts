import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  runAssetDualReviewById: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminScope: mocks.requireAdminScope }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { tag: 'db' } }))
vi.mock('@/lib/factory/asset-dual-review-store', () => ({
  supabaseDualReviewIo: (db: unknown) => ({ db }),
}))
vi.mock('@/lib/factory/asset-dual-review-run', () => ({
  runAssetDualReviewById: mocks.runAssetDualReviewById,
}))

import { POST } from '../route'

const call = () => POST(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: 'wo-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminScope.mockResolvedValue({ ok: true, user: { email: 'staff@example.test' }, scope: { kind: 'global' } })
  mocks.runAssetDualReviewById.mockResolvedValue({
    applicable: true, passed: true, pooled: true, status: 'pooled', videoId: '555',
  })
})

describe('POST asset-accept', () => {
  it('internal staff runs the three-gate admission and returns the approved pool row', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(mocks.runAssetDualReviewById).toHaveBeenCalledWith({ db: { tag: 'db' } }, 'wo-1')
    expect(await res.json()).toMatchObject({
      ok: true,
      status: 'archived',
      pool: { action: 'pooled', status: 'approved', video_id: '555' },
    })
  })

  it('a scoped (single-client) admin is refused before anything is written', async () => {
    mocks.requireAdminScope.mockResolvedValue({ ok: true, user: { email: 'demo@example.test' }, scope: { kind: 'client', clientId: 'c-1' } })
    const res = await call()
    expect(res.status).toBe(403)
    expect(mocks.runAssetDualReviewById).not.toHaveBeenCalled()
  })

  it('not signed in → the guard status, nothing written', async () => {
    mocks.requireAdminScope.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const res = await call()
    expect(res.status).toBe(401)
    expect(mocks.runAssetDualReviewById).not.toHaveBeenCalled()
  })

  it('a non-material order is refused', async () => {
    mocks.runAssetDualReviewById.mockResolvedValue({ applicable: false, passed: false, pooled: false, status: 'skipped' })
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: '只有仅素材工单可以这样入库' })
  })

  it('does not archive when the video cannot be uploaded', async () => {
    mocks.runAssetDualReviewById.mockResolvedValue({
      applicable: true, passed: false, pooled: false, status: 'upload_failed', reason: '成片传到广告账户失败',
    })
    const res = await call()
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: '成片传到广告账户失败' })
  })

  it('stays out of the pool when a gate fails', async () => {
    mocks.runAssetDualReviewById.mockResolvedValue({ applicable: true, passed: false, pooled: false, status: 'recorded' })
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: '三关还没过，成片没有进素材池' })
  })
})
