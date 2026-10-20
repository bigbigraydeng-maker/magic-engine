/**
 * POST /api/factory/work-orders/[id]/review — approval marker (review_ref) 草稿测试。
 *
 * 盯的是「谁批的」这条审计线索：内部员工走全站管理员 → internal_staff；
 * 客户范围的 demo 管理员 → scoped_admin。路由本身不拦 scoped_admin（账本事后判定），
 * 所以第 2 例断言 200 而不是 403。另外确认非 approve 动作不碰 requireGlobalAdmin，
 * 以及 guardAdmin 的 403 直接短路、不进入花钱路径。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  guardAdmin: vi.fn(),
  requireAdmin: vi.fn(),
  requireGlobalAdmin: vi.fn(),
  parseReviewBody: vi.fn(),
  applyApprove: vi.fn(),
  applyQualityReject: vi.fn(),
  applyBudgetUpdate: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: mocks.guardAdmin,
  requireAdmin: mocks.requireAdmin,
  requireGlobalAdmin: mocks.requireGlobalAdmin,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/factory/review-actions', () => ({ parseReviewBody: mocks.parseReviewBody }))
vi.mock('@/lib/factory/review-apply', () => ({
  applyApprove: mocks.applyApprove,
  applyQualityReject: mocks.applyQualityReject,
  applyBudgetUpdate: mocks.applyBudgetUpdate,
}))

import { POST } from '../route'

const STAFF = 'staff@example.test'

function callRoute(body: unknown = { action: 'approve' }) {
  return POST(
    new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'wo-1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.guardAdmin.mockResolvedValue(null)
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: { email: STAFF } })
  mocks.requireGlobalAdmin.mockResolvedValue({ ok: true, user: { email: STAFF } })
  mocks.parseReviewBody.mockReturnValue({ ok: true, action: 'approve', checklistHuman: [] })
  mocks.applyApprove.mockResolvedValue({ ok: true, status: 200, data: {} })
  mocks.applyQualityReject.mockResolvedValue({ ok: true, status: 200, data: {} })
  mocks.applyBudgetUpdate.mockResolvedValue({ ok: true, status: 200, data: {} })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('review route — approval marker', () => {
  it('内部员工（全站管理员）→ approver_scope internal_staff', async () => {
    mocks.requireGlobalAdmin.mockResolvedValue({ ok: true, user: { email: STAFF } })

    const res = await callRoute()

    expect(res.status).toBe(200)
    expect(mocks.applyApprove).toHaveBeenCalledTimes(1)
    expect(mocks.applyApprove).toHaveBeenCalledWith(
      {},
      'wo-1',
      STAFF,
      undefined,
      [],
      { approval_source: 'me_review_route', approver_scope: 'internal_staff' },
    )
  })

  it('客户范围 demo 管理员 → approver_scope scoped_admin，路由本身放行（200）', async () => {
    mocks.requireGlobalAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await callRoute()

    expect(res.status).toBe(200)
    expect(mocks.applyApprove).toHaveBeenCalledTimes(1)
    expect(mocks.applyApprove).toHaveBeenCalledWith(
      {},
      'wo-1',
      STAFF,
      undefined,
      [],
      { approval_source: 'me_review_route', approver_scope: 'scoped_admin' },
    )
  })

  it('会话读不到（requireGlobalAdmin 401）→ 返回 401，不批准、不写错误标记', async () => {
    mocks.requireGlobalAdmin.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const res = await callRoute()

    expect(res.status).toBe(401)
    expect(mocks.applyApprove).not.toHaveBeenCalled()
  })

  it('reject_quality 不查全站管理员、不走 applyApprove', async () => {
    mocks.parseReviewBody.mockReturnValue({
      ok: true,
      action: 'reject_quality',
      feedback: 'x',
      checklistHuman: [],
    })

    const res = await callRoute({ action: 'reject_quality' })

    expect(res.status).toBe(200)
    expect(mocks.requireGlobalAdmin).not.toHaveBeenCalled()
    expect(mocks.applyApprove).not.toHaveBeenCalled()
    expect(mocks.applyQualityReject).toHaveBeenCalledTimes(1)
  })

  it('guardAdmin 403 → 直接返回该响应，不进入花钱路径', async () => {
    mocks.guardAdmin.mockResolvedValue(new Response(null, { status: 403 }))

    const res = await callRoute()

    expect(res.status).toBe(403)
    expect(mocks.applyApprove).not.toHaveBeenCalled()
    expect(mocks.requireGlobalAdmin).not.toHaveBeenCalled()
  })
})
