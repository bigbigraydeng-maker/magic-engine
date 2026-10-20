/**
 * POST /api/factory/work-orders/[id]/review — 客户范围 + 批准权限。
 *
 * 钉住四件事：
 *   1. 谁批的审计标记：内部员工批准 → approver_scope internal_staff。
 *   2. 限定客户的管理员只能审自己客户的工单：打回 / 改预算把他的客户 id 传给 apply*。
 *   3. 批准只给内部员工：限定客户的管理员 approve 一律 403，且不进入 applyApprove。
 *   4. 读不到身份一律拒（401 / 403），不调用任何 apply 函数。
 *
 * 走真实鉴权链（requireAdminScope → requireSession + whitelist），只 mock 会话与 apply 层。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'

const h = vi.hoisted(() => ({
  email: null as string | null,
  calls: 0,
  failOn: 0,
}))

const mocks = vi.hoisted(() => ({
  parseReviewBody: vi.fn(),
  applyApprove: vi.fn(),
  applyQualityReject: vi.fn(),
  applyBudgetUpdate: vi.fn(),
}))

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () => {
    if (h.email === null) return { ok: false, status: 401, error: 'Unauthorized' }
    if (h.failOn > 0 && ++h.calls === h.failOn) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
    return { ok: true, user: { id: 'u', email: h.email } }
  },
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/factory/review-actions', () => ({ parseReviewBody: mocks.parseReviewBody }))
vi.mock('@/lib/factory/review-apply', () => ({
  applyApprove: mocks.applyApprove,
  applyQualityReject: mocks.applyQualityReject,
  applyBudgetUpdate: mocks.applyBudgetUpdate,
}))

import { POST } from '../route'

const ENV_KEYS = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
let savedEnv: Record<string, string | undefined> = {}

function callRoute(body: unknown = { action: 'approve' }) {
  return POST(
    new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'wo-1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.ADMIN_EMAILS = 'staff@example.test'
  delete process.env.ADMIN_EMAIL_DOMAIN
  process.env.DEMO_ADMINS = `demo@x.test:${CLIENT_A}`
  process.env.CLIENT_VIEWERS = `viewer@x.test:${CLIENT_A}`

  h.email = null
  h.calls = 0
  h.failOn = 0

  mocks.parseReviewBody.mockReturnValue({ ok: true, action: 'approve', checklistHuman: [] })
  mocks.applyApprove.mockResolvedValue({ ok: true, status: 200, data: {} })
  mocks.applyQualityReject.mockResolvedValue({ ok: true, status: 200, data: {} })
  mocks.applyBudgetUpdate.mockResolvedValue({ ok: true, status: 200, data: {} })
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.clearAllMocks()
})

describe('review route — client scope + approve permission', () => {
  it('内部员工批准 → approver_scope internal_staff，clientId 为 undefined', async () => {
    h.email = 'staff@example.test'

    const res = await callRoute()

    expect(res.status).toBe(200)
    expect(mocks.applyApprove).toHaveBeenCalledTimes(1)
    expect(mocks.applyApprove).toHaveBeenCalledWith(
      {},
      'wo-1',
      'staff@example.test',
      undefined,
      [],
      { approval_source: 'me_review_route', approver_scope: 'internal_staff' },
    )
  })

  it('限定客户的管理员批准 → 403，不调用 applyApprove', async () => {
    h.email = 'demo@x.test'

    const res = await callRoute()

    expect(res.status).toBe(403)
    expect(mocks.applyApprove).not.toHaveBeenCalled()
  })

  it('限定客户的管理员打回 → 200，客户 id 传给 applyQualityReject', async () => {
    h.email = 'demo@x.test'
    mocks.parseReviewBody.mockReturnValue({
      ok: true,
      action: 'reject_quality',
      feedback: 'x',
      checklistHuman: [],
    })

    const res = await callRoute({ action: 'reject_quality' })

    expect(res.status).toBe(200)
    expect(mocks.applyQualityReject).toHaveBeenCalledTimes(1)
    expect(mocks.applyQualityReject).toHaveBeenCalledWith({}, 'wo-1', 'x', 'demo@x.test', CLIENT_A, [])
  })

  it('限定客户的管理员改预算 → 客户 id 传给 applyBudgetUpdate', async () => {
    h.email = 'demo@x.test'
    mocks.parseReviewBody.mockReturnValue({ ok: true, action: 'reject_budget', newBudget: 20 })

    const res = await callRoute({ action: 'reject_budget', new_budget_usd: 20 })

    expect(res.status).toBe(200)
    expect(mocks.applyBudgetUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.applyBudgetUpdate).toHaveBeenCalledWith({}, 'wo-1', 20, 'demo@x.test', CLIENT_A)
  })

  it('内部员工打回 / 改预算 → 客户 id 为 undefined', async () => {
    h.email = 'staff@example.test'

    mocks.parseReviewBody.mockReturnValue({
      ok: true,
      action: 'reject_quality',
      feedback: 'x',
      checklistHuman: [],
    })
    await callRoute({ action: 'reject_quality' })
    expect(mocks.applyQualityReject).toHaveBeenCalledWith({}, 'wo-1', 'x', 'staff@example.test', undefined, [])

    mocks.parseReviewBody.mockReturnValue({ ok: true, action: 'reject_budget', newBudget: 20 })
    await callRoute({ action: 'reject_budget', new_budget_usd: 20 })
    expect(mocks.applyBudgetUpdate).toHaveBeenCalledWith({}, 'wo-1', 20, 'staff@example.test', undefined)
  })

  it('apply 返回 403（工单不属于该客户）→ 原样返回 403', async () => {
    h.email = 'demo@x.test'
    mocks.parseReviewBody.mockReturnValue({ ok: true, action: 'reject_budget', newBudget: 20 })
    mocks.applyBudgetUpdate.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'work order not in this client',
    })

    const res = await callRoute({ action: 'reject_budget', new_budget_usd: 20 })

    expect(res.status).toBe(403)
    expect(mocks.applyBudgetUpdate).toHaveBeenCalledTimes(1)
  })

  it('无会话 → 401，不调用任何 apply', async () => {
    h.email = null

    const res = await callRoute()

    expect(res.status).toBe(401)
    expect(mocks.applyApprove).not.toHaveBeenCalled()
    expect(mocks.applyQualityReject).not.toHaveBeenCalled()
    expect(mocks.applyBudgetUpdate).not.toHaveBeenCalled()
  })

  it('已登录但非管理员 → 403，不调用任何 apply', async () => {
    for (const email of ['viewer@x.test', 'stranger@x.test']) {
      vi.clearAllMocks()
      mocks.parseReviewBody.mockReturnValue({ ok: true, action: 'approve', checklistHuman: [] })
      h.email = email

      const res = await callRoute()

      expect(res.status).toBe(403)
      expect(mocks.applyApprove).not.toHaveBeenCalled()
      expect(mocks.applyQualityReject).not.toHaveBeenCalled()
      expect(mocks.applyBudgetUpdate).not.toHaveBeenCalled()
    }
  })

  it('会话邮箱为空 → 403，不调用任何 apply', async () => {
    // ADMIN_EMAILS 末尾多一个逗号：getUserPermissions('') 会把没有邮箱的登录当成全局管理员，守卫必须自己拦住
    process.env.ADMIN_EMAILS = 'fde@magiclab.test,'
    h.email = ''

    const res = await callRoute()

    expect(res.status).toBe(403)
    expect(mocks.applyApprove).not.toHaveBeenCalled()
    expect(mocks.applyQualityReject).not.toHaveBeenCalled()
    expect(mocks.applyBudgetUpdate).not.toHaveBeenCalled()
  })

  it('approvalMarker 读会话失败（第二次 requireSession）→ 401，不调用 applyApprove', async () => {
    h.email = 'staff@example.test'
    h.failOn = 2

    const res = await callRoute()

    expect(res.status).toBe(401)
    expect(mocks.applyApprove).not.toHaveBeenCalled()
  })

  it('请求体非法 → 400，不调用任何 apply', async () => {
    h.email = 'staff@example.test'
    mocks.parseReviewBody.mockReturnValue({ ok: false, error: 'bad' })

    const res = await callRoute({ action: 'nope' })

    expect(res.status).toBe(400)
    expect(mocks.applyApprove).not.toHaveBeenCalled()
    expect(mocks.applyQualityReject).not.toHaveBeenCalled()
    expect(mocks.applyBudgetUpdate).not.toHaveBeenCalled()
  })
})
