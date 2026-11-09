// @vitest-environment node
/**
 * Auth guard tests for /api/visual/* (video, avatar, upload, status, queue, assets, batch-image).
 *
 * Verifies for each route:
 *   - no session            → 401, and zero paid provider / DB calls
 *   - session, wrong client → 403 (404 for status and batch-image), and zero paid provider calls
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { chain, fromMock } = vi.hoisted(() => {
  const result = { data: null as unknown, error: null as unknown }
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update']) {
    chain[m] = vi.fn(() => chain)
  }
  chain.single = vi.fn(async () => result)
  ;(chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result)
  chain.__result = result
  return { chain, fromMock: vi.fn(() => chain) }
})

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: fromMock, storage: { createBucket: vi.fn(), updateBucket: vi.fn() } } }))
vi.mock('@/lib/visual/seedance', () => ({ submitVideoGeneration: vi.fn(), checkVideoStatus: vi.fn() }))
vi.mock('@/lib/visual/heygen', () => ({ submitAvatarVideo: vi.fn(), checkAvatarStatus: vi.fn() }))
vi.mock('@/lib/visual/atlas', () => ({ checkImageStatus: vi.fn() }))
vi.mock('@/lib/visual/openai-images', () => ({ generateImage: vi.fn() }))
vi.mock('@/lib/visual/storage', () => ({ uploadFromBase64: vi.fn(), uploadFromUrl: vi.fn() }))
vi.mock('@/lib/auth/require-session', () => ({ requireSession: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))

import { POST as videoPOST } from '../video/route'
import { POST as avatarPOST } from '../avatar/route'
import { POST as uploadPOST } from '../upload/route'
import { POST as batchPOST } from '../batch-image/route'
import { GET as statusGET } from '../status/[assetId]/route'
import { GET as queueGET } from '../queue/route'
import { GET as assetsGET } from '../assets/route'
import { submitVideoGeneration, checkVideoStatus } from '@/lib/visual/seedance'
import { submitAvatarVideo } from '@/lib/visual/heygen'
import { generateImage } from '@/lib/visual/openai-images'
import { requireSession } from '@/lib/auth/require-session'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const mockSession = vi.mocked(requireSession)
const mockAccess = vi.mocked(requireDashboardClientAccess)
const result = chain.__result as { data: unknown; error: unknown }

const UNAUTH = { ok: false, status: 401, error: 'Unauthorized' } as const
const FORBIDDEN = { ok: false, status: 403, error: 'Forbidden', reason: 'forbidden' } as const

function json(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function uploadReq() {
  const fd = new FormData()
  fd.set('file', new File(['x'], 'a.png', { type: 'image/png' }))
  fd.set('post_id', 'p1')
  fd.set('client_id', 'c1')
  return new NextRequest('http://test/api/visual/upload', { method: 'POST', body: fd })
}

function expectNoPaidCalls() {
  expect(submitVideoGeneration).not.toHaveBeenCalled()
  expect(checkVideoStatus).not.toHaveBeenCalled()
  expect(submitAvatarVideo).not.toHaveBeenCalled()
  expect(generateImage).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  result.data = null
  result.error = null
  mockSession.mockResolvedValue({ ok: true, user: { id: 'u1', email: 'a@b.c' } as never })
  mockAccess.mockResolvedValue(UNAUTH)
})

describe('unauthenticated → 401, zero paid calls', () => {
  beforeEach(() => {
    mockSession.mockResolvedValue(UNAUTH)
    mockAccess.mockResolvedValue(UNAUTH)
  })

  it.each([
    ['video', () => videoPOST(json('http://test/v', { post_id: 'p1', client_id: 'c1' }))],
    ['avatar', () => avatarPOST(json('http://test/a', { post_id: 'p1', client_id: 'c1' }))],
    ['upload', () => uploadPOST(uploadReq())],
    ['batch-image', () => batchPOST(json('http://test/b', { post_ids: ['p1'] }))],
    ['status', () => statusGET(new NextRequest('http://test/s'), { params: { assetId: 'a1' } })],
    ['queue', () => queueGET(new NextRequest('http://test/q'))],
    ['assets', () => assetsGET(new NextRequest('http://test/as?client_id=c1'))],
  ])('%s', async (_name, call) => {
    const res = await call()
    expect(res.status).toBe(401)
    expectNoPaidCalls()
    expect(fromMock).not.toHaveBeenCalledWith('production_items')
  })
})

describe('logged in but not this client → 403, zero paid calls', () => {
  beforeEach(() => {
    mockAccess.mockResolvedValue(FORBIDDEN)
  })

  it('video', async () => {
    const res = await videoPOST(json('http://test/v', { post_id: 'p1', client_id: 'other' }))
    expect(res.status).toBe(403)
    expectNoPaidCalls()
  })

  it('avatar', async () => {
    const res = await avatarPOST(json('http://test/a', { post_id: 'p1', client_id: 'other' }))
    expect(res.status).toBe(403)
    expectNoPaidCalls()
  })

  it('upload', async () => {
    const res = await uploadPOST(uploadReq())
    expect(res.status).toBe(403)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('assets', async () => {
    const res = await assetsGET(new NextRequest('http://test/as?client_id=other'))
    expect(res.status).toBe(403)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('status hides other clients assets as 404 and never polls the provider', async () => {
    result.data = { id: 'a1', client_id: 'other', provider: 'seedance', generation_status: 'generating' }
    const res = await statusGET(new NextRequest('http://test/s'), { params: { assetId: 'a1' } })
    expect(res.status).toBe(404)
    expectNoPaidCalls()
  })

  it('batch-image hides other clients posts as 404', async () => {
    result.data = null
    result.error = null
    ;(chain.in as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      data: [{ id: 'p1', client_id: 'other', visual_brief: 'x' }],
      error: null,
    }))
    const res = await batchPOST(json('http://test/b', { post_ids: ['p1'] }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ success: false, error: 'Post not found' })
    expectNoPaidCalls()
  })

  it('batch-image rejects the whole batch when one post belongs to another client', async () => {
    mockAccess.mockImplementation(async (cid: string) =>
      cid === 'c1'
        ? { ok: true, user: {} as never, role: 'client-viewer', tier: 'paid_client', allowedClientId: 'c1' }
        : FORBIDDEN
    )
    ;(chain.in as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      data: [
        { id: 'p1', client_id: 'c1', visual_brief: 'x' },
        { id: 'p2', client_id: 'other', visual_brief: 'y' },
      ],
      error: null,
    }))
    const res = await batchPOST(json('http://test/b', { post_ids: ['p1', 'p2'] }))
    expect(res.status).toBe(404)
    expectNoPaidCalls()
  })
})

describe('post belongs to a different client than the authorised one', () => {
  beforeEach(() => {
    mockAccess.mockResolvedValue({ ok: true, user: {} as never, role: 'client-viewer', tier: 'paid_client', allowedClientId: 'c1' })
  })

  it('video → 404, no generation', async () => {
    result.data = { visual_brief: 'x', revision_notes: null, client_id: 'other' }
    const res = await videoPOST(json('http://test/v', { post_id: 'p1', client_id: 'c1' }))
    expect(res.status).toBe(404)
    expectNoPaidCalls()
  })

  it('avatar → 404, no generation', async () => {
    result.data = { script: 'x', client_id: 'other' }
    const res = await avatarPOST(json('http://test/a', { post_id: 'p1', client_id: 'c1' }))
    expect(res.status).toBe(404)
    expectNoPaidCalls()
  })
})

describe('authorised caller still works', () => {
  it('queue → 200', async () => {
    const res = await queueGET(new NextRequest('http://test/q'))
    expect(res.status).toBe(200)
  })

  it('assets → 200 scoped by client_id', async () => {
    mockAccess.mockResolvedValue({ ok: true, user: {} as never, role: 'client-viewer', tier: 'paid_client', allowedClientId: 'c1' })
    result.data = []
    const res = await assetsGET(new NextRequest('http://test/as?client_id=c1'))
    expect(res.status).toBe(200)
    expect(chain.eq).toHaveBeenCalledWith('client_id', 'c1')
  })

  it('assets without client_id → 400', async () => {
    const res = await assetsGET(new NextRequest('http://test/as'))
    expect(res.status).toBe(400)
  })
})
