/**
 * 批准加固（设计稿 §5.2）：保存接口锁内容 / 退回草稿清待办 / 批准写回执且重试安全。
 * 假的数据库，只验证路由行为。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  approver: vi.fn(),
  dispatch: vi.fn(),
  revoke: vi.fn(),
  revocable: vi.fn(),
  casMiss: false,
  updErr: false,
  missed: false,
  statusAfter: 'draft',
  plan: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access, requirePlanApproverAccess: m.approver }))
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
    c.maybeSingle = async () => {
      if (m.updErr && c.updated) return { data: null, error: { message: 'db down' } }
      if (m.casMiss && c.updated) { m.missed = true; return { data: null, error: null } }
      if (m.casMiss && m.missed) return { data: { status: m.statusAfter }, error: null }
      return { data: m.plan, error: null }
    }
    c.update = (u: Record<string, unknown>) => {
      c.updated = true
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
  m.updErr = false; m.casMiss = false; m.missed = false; m.statusAfter = 'draft'
  m.access.mockResolvedValue({ ok: true, user: { email: 'fde@example.com' } })
  m.approver.mockResolvedValue({ ok: true, user: { email: 'fde@example.com' } })
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

describe('PATCH — 推广结构只能走专用保存接口', () => {
  const promo = { schema: 'promo_v1', goal_id: 'g1', phases: [{ id: 'p', name: 'x', start_date: '2026-11-01', end_date: '2026-11-02', steps: [] }], checks: [] }
  beforeEach(() => { m.plan = { ...m.plan, plan_data: { tasks: [], promo } } })

  it('草稿：把推广结构改掉 → 409，不写库', async () => {
    const res = await PATCH(mk({ plan_data: { tasks: [], promo: { ...promo, goal_id: 'other-client-goal' } } }), { params: P })
    expect(res.status).toBe(409)
    expect(m.updates).toHaveLength(0)
  })
  it('草稿：把推广结构删掉（想躲批准前的检查）→ 409，不写库', async () => {
    const res = await PATCH(mk({ plan_data: { tasks: [] } }), { params: P })
    expect(res.status).toBe(409)
    expect(m.updates).toHaveLength(0)
  })
  it('草稿：给没有推广结构的计划塞一份 → 409', async () => {
    m.plan = { ...m.plan, plan_data: { tasks: [] } }
    const res = await PATCH(mk({ plan_data: { tasks: [], promo } }), { params: P })
    expect(res.status).toBe(409)
  })
  it.each([['null', null], ['字符串', 'x'], ['数组', []]])('plan_data 是%s → 400，不写库', async (_n, bad) => {
    const res = await PATCH(mk({ plan_data: bad }), { params: P })
    expect(res.status).toBe(400)
    expect(m.updates).toHaveLength(0)
  })
  it('已批准 + 推广结构被改：仍被拦（不会因为状态不同放行）', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    const res = await PATCH(mk({ plan_data: { tasks: [], promo: { ...promo, goal_id: 'x' } } }), { params: P })
    expect([409]).toContain(res.status)
    expect(m.updates).toHaveLength(0)
  })
  it('草稿：推广结构原样带回（键顺序不同）+ 改别的内容 → 可以保存', async () => {
    const reordered = JSON.parse(JSON.stringify(promo, ['checks', 'phases', 'goal_id', 'schema', 'id', 'name', 'start_date', 'end_date', 'steps']))
    const res = await PATCH(mk({ plan_data: { tasks: [{ title: 'new' }], promo: reordered } }), { params: P })
    expect(res.status).toBe(200)
    expect(m.updates).toHaveLength(1)
  })
  it('只改标题（不带 plan_data）不受影响', async () => {
    const res = await PATCH(mk({ title: '改个名' }), { params: P })
    expect(res.status).toBe(200)
  })
})

describe('PATCH — 并发 / 状态 / 退回草稿留底', () => {
  it('读完到写入之间计划被别处改过（时间戳对不上）→ 409，不覆盖', async () => {
    m.casMiss = true
    const res = await PATCH(mk({ title: '改个名' }), { params: P })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('刷新')
  })
  it('退回草稿时刚好被别处改了：409，如实说待办已清、计划仍是已批准，要再点一次', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    m.casMiss = true
    const res = await PATCH(mk({ status: 'draft' }), { params: P })
    expect(res.status).toBe(409)
    expect(m.revoke).toHaveBeenCalled()
    const json = await res.json()
    expect(json.error).toContain('仍是已批准')
    expect(json.error).toContain('再点一次')
  })
  it('草稿不能直接标成已完成（没批准过）', async () => {
    const res = await PATCH(mk({ status: 'completed' }), { params: P })
    expect(res.status).toBe(409)
    expect(m.updates).toHaveLength(0)
  })
  it('已批准 → 已完成：允许', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    expect((await PATCH(mk({ status: 'completed' }), { params: P })).status).toBe(200)
  })
  it('已批准 → 退回草稿：批准时间清空，旧回执挪到 previous_approvals，草稿上不再留「有效」回执', async () => {
    const receipt = { request_id: 'r1', approved_by: 'pm@example.com', approved_at: '2026-10-20T03:04:05Z', tasks_created: 3, tasks_skipped: 0, packages_created: 0 }
    m.plan = { ...m.plan, status: 'approved', approved_at: '2026-10-20T03:04:05Z', generation_meta: { model: 'x', approval_receipt: receipt } }
    const res = await PATCH(mk({ status: 'draft' }), { params: P })
    expect(res.status).toBe(200)
    const upd = m.updates[0] as { approved_at: unknown; generation_meta: Record<string, unknown> }
    expect(upd.approved_at).toBeNull()
    expect(upd.generation_meta.approval_receipt).toBeUndefined()
    expect(upd.generation_meta.previous_approvals).toEqual([receipt])
    expect(upd.generation_meta.model).toBe('x')
  })
})

describe('退回草稿作废旧核实', () => {
  it('promo_checks 挪进 previous_promo_checks，草稿上不再留着参与判定的核实', async () => {
    const check = { phase_id: 'p1', check_key: 'landing.item_live', verified_by: 'a@example.com', verified_at: '2026-10-20T00:00:00Z', note: '', content_hash: 'abc' }
    m.plan = { ...m.plan, status: 'approved', approved_at: '2026-10-20T03:04:05Z', generation_meta: { model: 'x', promo_checks: [check] } }
    const res = await PATCH(mk({ status: 'draft' }), { params: P })
    expect(res.status).toBe(200)
    const upd = m.updates[0] as { generation_meta: Record<string, unknown> }
    expect(upd.generation_meta.promo_checks).toBeUndefined()
    expect(upd.generation_meta.previous_promo_checks).toEqual([check])
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

describe('POST approve — 并发批准', () => {
  it('更新没命中是因为另一个批准请求已经赢了 → 409，绝不撤销赢家派的待办', async () => {
    m.dispatch.mockResolvedValue({ marketing_plan_id: 'plan-1', tasks_created: 1, tasks_skipped: 0, task_ids: ['t'], packages_created: 0, package_ids: [] })
    m.casMiss = true; m.statusAfter = 'approved'
    const res = await APPROVE(new NextRequest('http://localhost/x', { method: 'POST', body: '{}' }), { params: P })
    expect(res.status).toBe(409)
    expect(m.revoke).not.toHaveBeenCalled()
  })
  it('更新没命中是因为草稿内容被改了 → 409，并撤销本次派发', async () => {
    m.dispatch.mockResolvedValue({ marketing_plan_id: 'plan-1', tasks_created: 1, tasks_skipped: 0, task_ids: ['t'], packages_created: 0, package_ids: [] })
    m.casMiss = true; m.statusAfter = 'draft'
    const res = await APPROVE(new NextRequest('http://localhost/x', { method: 'POST', body: '{}' }), { params: P })
    expect(res.status).toBe(409)
    expect(m.revoke).toHaveBeenCalledWith('plan-1', 'client-1')
  })
})

describe('PATCH — 归档 / 非草稿回草稿都不能绕过清理', () => {
  it('PATCH 不能直接把计划改成 archived（要走 DELETE）', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    expect((await PATCH(mk({ status: 'archived' }), { params: P })).status).toBe(400)
    expect(m.updates).toHaveLength(0)
  })
  it('已归档 → 草稿也算退回：先检查在途工作再清待办', async () => {
    m.plan = { ...m.plan, status: 'archived' }
    const res = await PATCH(mk({ status: 'draft' }), { params: P })
    expect(res.status).toBe(200)
    expect(m.revocable).toHaveBeenCalled()
    expect(m.revoke).toHaveBeenCalled()
  })
})

describe('只有内部账号能批准 / 退回草稿 / 归档', () => {
  beforeEach(() => {
    m.approver.mockResolvedValue({ ok: false, status: 403, error: '批准和修改推广计划需要 Magic Lab 内部账号', reason: 'approver_only' })
  })

  it('POST approve → 403，不派发、不写库', async () => {
    const res = await APPROVE(mk({}, 'POST'), { params: P })
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe('approver_only')
    expect(m.updates).toHaveLength(0)
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  it('PATCH 退回草稿 → 403，不清待办、不写库', async () => {
    m.plan = { ...m.plan, status: 'approved' }
    const res = await PATCH(mk({ status: 'draft' }), { params: P })
    expect(res.status).toBe(403)
    expect(m.revoke).not.toHaveBeenCalled()
    expect(m.updates).toHaveLength(0)
  })

  it('PATCH 普通字段（草稿改标题）→ 仍 200，不查内部账号', async () => {
    const res = await PATCH(mk({ title: 'x' }), { params: P })
    expect(res.status).toBe(200)
    expect(m.approver).not.toHaveBeenCalled()
  })

  it('DELETE 归档 → 403，不清待办、不写库', async () => {
    const res = await DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), { params: P })
    expect(res.status).toBe(403)
    expect(m.revoke).not.toHaveBeenCalled()
    expect(m.updates).toHaveLength(0)
  })
})

describe('POST approve — 改状态失败', () => {
  it('任务已派但状态没保存成功 → 撤销本次派发并返回 500，不报成功', async () => {
    m.dispatch.mockResolvedValue({ marketing_plan_id: 'plan-1', tasks_created: 1, tasks_skipped: 0, task_ids: ['t'], packages_created: 0, package_ids: [] })
    m.updErr = true
    const res = await APPROVE(new NextRequest('http://localhost/x', { method: 'POST', body: '{}' }), { params: P })
    expect(res.status).toBe(500)
    expect(m.revoke).toHaveBeenCalledWith('plan-1', 'client-1')
  })
})
