/**
 * 批准加固（设计稿 §5.2）：保存接口锁内容 / 退回草稿清待办 / 批准写回执且重试安全。
 * 假的数据库，只验证路由行为。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  dispatch: vi.fn(),
  revoke: vi.fn(),
  revocable: vi.fn(),
  plan: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
vi.mock('@/lib/marketing-plan/task-dispatcher', () => ({
  dispatchPlanTasks: m.dispatch,
  revokePlanTasks: m.revoke,
  countRevokeBlockers: m.revocable,
}))
vi.mock('@/lib/supabase', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = () => c
    c.single = async () => ({ data: m.plan, error: m.plan ? null : { message: 'nf' } })
    c.maybeSingle = async () => ({ data: m.plan, error: null })
    c.update = (u: Record<string, unknown>) => {
      m.updates.push(u)
      m.plan = { ...(m.plan ?? {}), ...u }
      return c
    }
    return c
  }
  return { supabaseAdmin: { from: () => chain() } }
})

import { DELETE, PATCH } from '../route'
import { POST as APPROVE } from '../approve/route'

const P = { id: 'client-1', planId: 'plan-1' }
const mk = (body: unknown, method = 'PATCH') =>
  new NextRequest('http://localhost/x', { method, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  m.updates = []
  m.access.mockResolvedValue({ ok: true, user: { email: 'fde@example.com' } })
  m.revoke.mockResolvedValue({ revoked: 3 })
  m.revocable.mockResolvedValue({ tasks_in_progress: 0, packages_started: 0 })
  m.plan = { id: 'plan-1', client_id: 'client-1', status: 'draft', generation_meta: { model: 'x' }, plan_data: { tasks: [] } }
})

describe('PATCH — 已批准的计划内容被锁住', () => {
  it('草稿：可以改 plan_data', async () => {
    const res = await PATCH(mk({ plan_data: { tasks: [] } }), { params: P })
    expect(res.status).toBe(200)
    expect(m.updates).toHaveLength(1)
  })

  it.each(['approved', 'completed'])('%s：改 plan_data → 409，不写库', async (status) => {
    m.plan = { ...m.plan, status }
    const res = await PATCH(mk({ plan_data: { tasks: [{}] } }), { params: P })
    expect(res.status).toBe(409)
    expect((await res.json()).locked_fields).toEqual(['plan_data'])
    expect(m.updates).toHaveLength(0)
    expect(m.revoke).not.toHaveBeenCalled()
  })

  it('已批准：改起止日期也被拒', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    const res = await PATCH(mk({ start_date: '2026-11-01' }), { params: P })
    expect(res.status).toBe(409)
  })

  it('已批准：只改标题可以（不算内容）', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    const res = await PATCH(mk({ title: '新名字' }), { params: P })
    expect(res.status).toBe(200)
    expect(m.revoke).not.toHaveBeenCalled()
  })

  it('已批准 → 退回草稿：先清还没开始的待办，再允许同时改内容', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    const res = await PATCH(mk({ status: 'draft', plan_data: { tasks: [] } }), { params: P })
    expect(res.status).toBe(200)
    expect(m.revoke).toHaveBeenCalledWith('plan-1', 'client-1')
    expect((await res.json()).revoked_tasks).toBe(3)
    expect(m.updates[0]).toMatchObject({ status: 'draft' })
  })

  it('已批准 → 退回草稿：有待办已开工 / 生产包已开始时拒绝，计划内容不动', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    m.revocable.mockResolvedValue({ tasks_in_progress: 1, packages_started: 0 })
    const res = await PATCH(mk({ status: 'draft', plan_data: { tasks: [] } }), { params: P })
    expect(res.status).toBe(409)
    expect(m.revoke).not.toHaveBeenCalled()
    expect(m.updates).toHaveLength(0)
  })

  it('草稿保存"草稿"状态：不触发清待办', async () => {
    const res = await PATCH(mk({ status: 'draft', title: 't' }), { params: P })
    expect(res.status).toBe(200)
    expect(m.revoke).not.toHaveBeenCalled()
  })

  it('PATCH 仍不能直接设 approved', async () => {
    const res = await PATCH(mk({ status: 'approved' }), { params: P })
    expect(res.status).toBe(400)
  })

  it('计划不存在 → 404', async () => {
    m.plan = null
    const res = await PATCH(mk({ title: 't' }), { params: P })
    expect(res.status).toBe(404)
  })

  it('没权限 → 原样返回，不读库', async () => {
    m.access.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    const res = await PATCH(mk({ title: 't' }), { params: P })
    expect(res.status).toBe(403)
  })
})

describe('POST approve — 回执与重试', () => {
  it('草稿：派发后改成已批准，并写回执（含跳过数、操作者）', async () => {
    m.dispatch.mockResolvedValue({
      marketing_plan_id: 'plan-1', tasks_created: 2, tasks_skipped: 1,
      task_ids: ['a', 'b'], packages_created: 1, package_ids: ['p'],
    })
    const res = await APPROVE(mk({}, 'POST'), { params: P })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(m.dispatch).toHaveBeenCalledTimes(1)
    const upd = m.updates[0] as { status: string; generation_meta: { model: string; approval_receipt: Record<string, unknown> } }
    expect(upd.status).toBe('approved')
    expect(upd.generation_meta.model).toBe('x') // 原有字段保留
    expect(upd.generation_meta.approval_receipt).toMatchObject({
      approved_by: 'fde@example.com', tasks_created: 2, tasks_skipped: 1, packages_created: 1,
    })
    expect(upd.generation_meta.approval_receipt.request_id).toEqual(expect.any(String))
  })

  it('派发失败：计划保持草稿（不改状态），可再点一次', async () => {
    m.dispatch.mockRejectedValue(new Error('insert failed'))
    const res = await APPROVE(mk({}, 'POST'), { params: P })
    expect(res.status).toBe(500)
    expect(m.updates).toHaveLength(0)
  })

  it('已批准：直接返回，不再派发', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    const res = await APPROVE(mk({}, 'POST'), { params: P })
    expect((await res.json()).already_approved).toBe(true)
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  it('已归档：不能批准', async () => {
    m.plan = { ...m.plan, status: 'archived' }
    const res = await APPROVE(mk({}, 'POST'), { params: P })
    expect(res.status).toBe(400)
    expect(m.dispatch).not.toHaveBeenCalled()
  })
})

describe('DELETE — 先确认计划属于当前客户', () => {
  it('计划不属于这个客户 → 404，不碰它名下的待办 / 生产包', async () => {
    m.plan = null
    const res = await DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), { params: P })
    expect(res.status).toBe(404)
    expect(m.revoke).not.toHaveBeenCalled()
  })
})
