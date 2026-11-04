import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const access = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: (id: string) => access(id) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
const mirror = vi.fn(async (_a: unknown): Promise<'ok' | 'conflict' | 'failed'> => 'ok')
const patchCall = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('@/lib/telephony/transcribe/store', () => ({ supabaseAnalysisStore: { patchCall: (...a: unknown[]) => patchCall(...a) } }))
vi.mock('@/lib/telephony/transcribe/call-stance', () => ({ mirrorReviewToTouchpoints: (a: unknown) => mirror(a) }))

import { supabaseAdmin } from '@/lib/supabase'
import { PATCH } from './route'

let update: Record<string, unknown> | null = null
let eqs: Array<[string, unknown]> = []

function mockDb(found: boolean, error: { message: string } | null = null) {
  update = null
  eqs = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    update: (v: Record<string, unknown>) => {
      update = v
      const chain = {
        eq: (c: string, val: unknown) => {
          eqs.push([c, val])
          return chain
        },
        select: () => ({ maybeSingle: async () => ({ data: found ? { id: 'an-1', call_id: 'call-1' } : null, error }) }),
      }
      return chain
    },
  }))
}

const call = (body: unknown) =>
  PATCH(new NextRequest('http://localhost:3001/x', { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: { id: 'client-a', aid: 'an-1' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ ok: true, user: { email: 'pm@example.com' }, tier: 'admin', allowedClientId: null })
  mockDb(true)
})

describe('PATCH call-analyses', () => {
  it('确认：记复核人和时间，并按 client_id 收口', async () => {
    const res = await call({ review: 'confirmed' })
    expect(res.status).toBe(200)
    expect(update).toMatchObject({ review_status: 'confirmed', reviewed_by: 'pm@example.com' })
    expect(typeof update?.reviewed_at).toBe('string')
    expect(eqs).toEqual(expect.arrayContaining([['id', 'an-1'], ['client_id', 'client-a']]))
  })

  it('复核状态同步到 CRM 触点（驳回后 CRM 不再按这份分析的客人表态挪人）', async () => {
    await call({ review: 'rejected' })
    expect(mirror).toHaveBeenCalledWith({ clientId: 'client-a', analysisId: 'an-1', review: 'rejected' })
  })

  it('同步成功 → 响应不带 touchpointSync，也不写回执', async () => {
    const res = await call({ review: 'rejected' })
    expect(await res.json()).toEqual({ reviewStatus: 'rejected' })
    expect(patchCall).not.toHaveBeenCalled()
  })

  it.each(['conflict', 'failed'] as const)('同步结果 %s → 复核照样成功，响应带 touchpointSync，通话回执留一条', async (sync) => {
    mirror.mockResolvedValueOnce(sync)
    const res = await call({ review: 'rejected' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reviewStatus: 'rejected', touchpointSync: sync })
    expect(patchCall).toHaveBeenCalledWith('call-1', {}, { stage: 'review_sync', status: sync, detail: 'rejected' })
  })

  it('回执也写不上 → 只记日志，复核仍返回 200', async () => {
    mirror.mockResolvedValueOnce('failed')
    patchCall.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await call({ review: 'rejected' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reviewStatus: 'rejected', touchpointSync: 'failed' })
    err.mockRestore()
  })

  it('撤回成待复核：清掉复核人和时间', async () => {
    await call({ review: 'pending_review' })
    expect(update).toEqual({ review_status: 'pending_review', reviewed_by: null, reviewed_at: null })
  })

  it('非法取值 / 坏 JSON → 400，且不写库', async () => {
    expect((await call({ review: 'approved' })).status).toBe(400)
    expect((await call('not json')).status).toBe(400)
    expect(update).toBeNull()
  })

  it('没有权限 → 原样返回，不写库', async () => {
    access.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    expect((await call({ review: 'confirmed' })).status).toBe(403)
    expect(update).toBeNull()
  })

  it('别家客户的分析 → 404；库出错 → 500', async () => {
    mockDb(false)
    expect((await call({ review: 'rejected' })).status).toBe(404)
    expect(mirror).not.toHaveBeenCalled()
    mockDb(false, { message: 'db down' })
    expect((await call({ review: 'rejected' })).status).toBe(500)
  })
})
