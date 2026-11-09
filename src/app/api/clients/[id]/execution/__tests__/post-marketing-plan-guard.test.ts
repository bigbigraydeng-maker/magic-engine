/**
 * POST /execution 手工加任务（来源为营销计划）：只有已批准的计划可以。
 * 以前只查「计划存在」，草稿计划也能往执行看板派活。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  approver: vi.fn(),
  loadPromoFacts: vi.fn(),
  planStatus: 'draft' as string | null,
  planData: {} as Record<string, unknown>,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access, requirePlanApproverAccess: m.approver }))
vi.mock('@/lib/marketing-plan/promo/facts', () => ({ loadPromoFacts: m.loadPromoFacts }))
vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = () => c
    c.order = () => c
    c.limit = () => c
    c.single = async () =>
      table === 'marketing_plans'
        ? m.planStatus
          ? { data: { id: 'plan-1', status: m.planStatus, plan_data: m.planData }, error: null }
          : { data: null, error: { message: 'nf' } }
        : { data: { id: 'item-1' }, error: null }
    c.maybeSingle = async () => ({ data: null, error: null })
    c.insert = (row: Record<string, unknown>) => {
      m.inserts.push({ table, row })
      return c
    }
    // 日志写入是 insert(...).then(...) 的写法，替身要能被 then
    c.then = (resolve: (v: { error: null }) => unknown) => resolve({ error: null })
    return c
  }
  return { supabaseAdmin: { from } }
})

import { POST } from '../route'
import { baseSpec, goodFacts } from '@/lib/marketing-plan/promo/__tests__/fixtures'

const req = (body: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })
const params = { params: { id: 'client-1' } }
const body = { marketing_plan_id: 'plan-1', title: '补一条帖子', platform: 'facebook' }

beforeEach(() => {
  vi.clearAllMocks()
  m.inserts = []
  m.planStatus = 'draft'
  m.planData = {}
  m.access.mockResolvedValue({ ok: true })
  m.approver.mockResolvedValue({ ok: true })
  m.loadPromoFacts.mockResolvedValue({ gate: goodFacts() })
})

describe('POST /execution — marketing_plan 来源只认已批准的计划', () => {
  it.each(['draft', 'archived', 'completed'])('计划是 %s → 409，不写任何卡', async (status) => {
    m.planStatus = status
    const res = await POST(req(body), params)
    expect(res.status).toBe(409)
    expect(m.inserts.filter(i => i.table === 'execution_items')).toHaveLength(0)
  })

  it('计划已批准 → 照常新增', async () => {
    m.planStatus = 'approved'
    const res = await POST(req(body), params)
    expect(res.status).toBe(200)
    const inserted = m.inserts.filter(i => i.table === 'execution_items')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].row).toMatchObject({ marketing_plan_id: 'plan-1', source: 'marketing_plan', status: 'pending' })
  })

  it('计划不存在 → 404', async () => {
    m.planStatus = null
    const res = await POST(req(body), params)
    expect(res.status).toBe(404)
  })
})

describe('POST /execution — 推广计划的任务必须指明属于哪一步', () => {
  const stepRow = () => m.inserts.find(i => i.table === 'execution_items')?.row as { steps_json: Record<string, unknown> } | undefined

  beforeEach(() => { m.planStatus = 'approved'; m.planData = { promo: baseSpec() } })

  it('没带 promo_ref → 400，不写卡', async () => {
    const res = await POST(req(body), params)
    expect(res.status).toBe(400)
    expect(stepRow()).toBeUndefined()
  })

  it('指向不存在的阶段 / 步骤 → 400', async () => {
    expect((await POST(req({ ...body, promo_ref: { phase_id: 'p1', step_id: 'nope' } }), params)).status).toBe(400)
    expect((await POST(req({ ...body, promo_ref: { phase_id: 'p9', step_id: 's-ads' } }), params)).status).toBe(400)
    expect(stepRow()).toBeUndefined()
  })

  it('步骤存在 → 写卡，并把 promo_ref 记进 steps_json', async () => {
    const res = await POST(req({ ...body, promo_ref: { phase_id: 'p1', step_id: 's-soc' } }), params)
    expect(res.status).toBe(200)
    expect(stepRow()?.steps_json.promo_ref).toEqual({ phase_id: 'p1', step_id: 's-soc' })
  })

  it('promo 畸形 → 一律拒绝（fail closed），哪怕带了 promo_ref', async () => {
    m.planData = { promo: { schema: 'promo_v1' } }
    const res = await POST(req({ ...body, promo_ref: { phase_id: 'p1', step_id: 's-soc' } }), params)
    expect(res.status).toBe(400)
  })

  it('客户员工（非内部账号）不能往已批准的推广计划挂任务 → 403，不写卡', async () => {
    m.approver.mockResolvedValue({ ok: false, status: 403, error: '批准和修改推广计划需要 Magic Lab 内部账号', reason: 'approver_only' })
    const res = await POST(req({ ...body, promo_ref: { phase_id: 'p1', step_id: 's-soc' } }), params)
    expect(res.status).toBe(403)
    expect(stepRow()).toBeUndefined()
  })

  it('广告步骤所在阶段硬门没过（素材未批准）→ 409，不写卡', async () => {
    const res = await POST(req({ ...body, promo_ref: { phase_id: 'p1', step_id: 's-ads' } }), params)
    expect(res.status).toBe(409)
    expect(stepRow()).toBeUndefined()
  })

  it('🔴 往执行看板派广告任务前的阶段复查是授权动作：读事实时要求现读预算门', async () => {
    await POST(req({ ...body, promo_ref: { phase_id: 'p1', step_id: 's-ads' } }), params)
    expect(m.loadPromoFacts).toHaveBeenCalledTimes(1)
    expect(m.loadPromoFacts.mock.calls[0][4]).toEqual({ liveBudget: 'if_needed' })
  })

  it('旧版计划（没有 promo）：不要求 promo_ref，行为不变', async () => {
    m.planData = { tasks: [] }
    const res = await POST(req(body), params)
    expect(res.status).toBe(200)
    expect(stepRow()?.steps_json.promo_ref).toBeUndefined()
  })
})
