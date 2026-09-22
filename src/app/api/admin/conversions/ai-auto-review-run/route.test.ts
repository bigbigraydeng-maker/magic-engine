/**
 * POST /api/admin/conversions/ai-auto-review-run 测试。
 * 这一层只是个薄封装（鉴权 + 决定跑哪些客户 + 汇总结果），核心逻辑在
 * `ai-auto-review-run.ts` 里已经测过，这里不重复断言状态机细节。
 *
 * 重点钉住魏征最终复审 BLOCKER：传了 clientId 时受限管理员只能碰自己的客户
 * （`guardConversionRoute`），不传 clientId（一次跑遍所有客户）时必须是
 * 全局管理员（`guardGlobalAdmin`），不能靠单一的 `guardAdmin` 蒙混过关。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth/require-admin', () => ({
  guardGlobalAdmin: vi.fn(async () => null),
}))
vi.mock('@/lib/conversions/route-guard', () => ({
  guardConversionRoute: vi.fn(async () => ({
    ok: true,
    ctx: { actor: 'fde@example.com', ip: '1.2.3.4', ua: 'test-agent', requestId: 'req-1' },
  })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/conversions/ai-auto-review-run', () => ({
  runAiAutoReviewForClient: vi.fn(async () => ({ ran: true, processed: 0, approved: 0, rejected: 0, uncertain: 0, expired: 0, items: [] })),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { guardConversionRoute } from '@/lib/conversions/route-guard'
import { runAiAutoReviewForClient } from '@/lib/conversions/ai-auto-review-run'
import { POST } from './route'

function req(body: unknown) {
  return new Request('http://localhost/api/admin/conversions/ai-auto-review-run', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.mocked(guardGlobalAdmin).mockClear()
  vi.mocked(guardGlobalAdmin).mockResolvedValue(null)
  vi.mocked(guardConversionRoute).mockClear()
  vi.mocked(guardConversionRoute).mockResolvedValue({
    ok: true,
    ctx: { actor: 'fde@example.com', ip: '1.2.3.4', ua: 'test-agent', requestId: 'req-1' },
  })
  vi.mocked(runAiAutoReviewForClient).mockClear()
  vi.mocked(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReset()
})

describe('POST ai-auto-review-run', () => {
  it('传了 clientId → 走 guardConversionRoute（受限管理员只能碰自己被指定的客户），只跑这一个客户', async () => {
    const res = await POST(req({ clientId: 'c1' }))
    const body = await res.json()
    expect(guardConversionRoute).toHaveBeenCalledWith(expect.anything(), 'c1')
    expect(guardGlobalAdmin).not.toHaveBeenCalled()
    expect(runAiAutoReviewForClient).toHaveBeenCalledTimes(1)
    expect(runAiAutoReviewForClient).toHaveBeenCalledWith('c1', expect.anything())
    expect(body.results.c1).toMatchObject({ ran: true })
  })

  it('传了 clientId 但这个客户不在自己权限范围内 → guardConversionRoute 拒绝，不跑任何客户', async () => {
    vi.mocked(guardConversionRoute).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: '无权处理该客户的记录' }, { status: 403 }),
    })
    const res = await POST(req({ clientId: 'someone-elses-client' }))
    expect(res.status).toBe(403)
    expect(runAiAutoReviewForClient).not.toHaveBeenCalled()
  })

  it('没传 clientId → 必须是全局管理员（guardGlobalAdmin），跑所有开了 ai_auto_review_enabled 的客户', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [{ id: 'c1' }, { id: 'c2' }], error: null }),
      }),
    }))
    const res = await POST(req({}))
    const body = await res.json()
    expect(guardGlobalAdmin).toHaveBeenCalledTimes(1)
    expect(guardConversionRoute).not.toHaveBeenCalled()
    expect(runAiAutoReviewForClient).toHaveBeenCalledTimes(2)
    expect(Object.keys(body.results).sort()).toEqual(['c1', 'c2'])
  })

  it('没传 clientId 且不是全局管理员（受限管理员）→ 直接拒绝，一个客户都不跑', async () => {
    vi.mocked(guardGlobalAdmin).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden — scoped admins cannot use it' }, { status: 403 }),
    )
    const res = await POST(req({}))
    expect(res.status).toBe(403)
    expect(runAiAutoReviewForClient).not.toHaveBeenCalled()
  })

  it('某个客户跑的时候抛错 → 那个客户记为 error，不影响其它客户', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [{ id: 'c1' }, { id: 'c2' }], error: null }),
      }),
    }))
    vi.mocked(runAiAutoReviewForClient).mockImplementation(async (id: string) => {
      if (id === 'c1') throw new Error('模拟故障')
      return { ran: true, processed: 0, approved: 0, rejected: 0, uncertain: 0, expired: 0, items: [] }
    })
    const res = await POST(req({}))
    const body = await res.json()
    expect(body.results.c1).toMatchObject({ ran: false, reason: 'error' })
    expect(body.results.c2).toMatchObject({ ran: true })
  })
})
