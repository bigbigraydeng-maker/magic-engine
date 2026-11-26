/**
 * 已批准计划只改投放阶段。上限和步骤预算必须逐字不变。不写广告后台。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { baseSpec } from '@/lib/marketing-plan/promo/__tests__/fixtures'
import { STAGE_GOAL } from '@/lib/marketing-plan/promo/delivery-stage'
import { stableStringify } from '@/lib/marketing-plan/plan-guard'
import { todayInNz } from '@/lib/marketing-plan/promo/schedule-view'
import type { PromoSpec } from '@/lib/marketing-plan/promo/spec'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  plans: [] as Record<string, unknown>[],
  actions: [] as Record<string, unknown>[],
  writes: [] as Record<string, unknown>[],
  tables: [] as string[],
  auditError: false,
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePlanApproverAccess: m.access }))
vi.mock('@/lib/supabase', () => {
  function matches(row: Record<string, unknown>, filters: [string, unknown][]): boolean {
    return filters.every(([key, value]) => row[key] === value)
  }
  function chain(table: string) {
    const filters: [string, unknown][] = []
    let op = 'select'
    let payload: Record<string, unknown> | null = null
    const run = async () => {
      m.tables.push(table)
      if (table === 'flywheel_actions' && op === 'insert') {
        if (m.auditError) return { data: null, error: { message: 'down' } }
        m.actions.push(payload ?? {})
        return { data: { id: 'audit-1' }, error: null }
      }
      if (table === 'marketing_plans' && op === 'update') {
        const row = m.plans.find(item => matches(item, filters))
        if (!row) return { data: null, error: null }
        Object.assign(row, payload)
        m.writes.push(structuredClone(payload ?? {}))
        return { data: { id: row.id }, error: null }
      }
      return { data: m.plans.filter(item => matches(item, filters)), error: null }
    }
    const api: Record<string, unknown> = {}
    api.select = () => api
    api.eq = (key: string, value: unknown) => { filters.push([key, value]); return api }
    api.insert = (row: Record<string, unknown>) => { op = 'insert'; payload = row; return api }
    api.update = (row: Record<string, unknown>) => { op = 'update'; payload = row; return api }
    api.maybeSingle = async () => {
      const result = await run()
      return Array.isArray(result.data) ? { data: result.data[0] ?? null, error: result.error } : result
    }
    api.then = (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) => run().then(resolve, reject)
    return api
  }
  return { supabaseAdmin: { from: (table: string) => chain(table) } }
})

import { PATCH } from '../delivery/route'

const P = { id: 'client-1', planId: 'plan-live' }
const req = (body: unknown) => new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) })

function plan(id: string, status: string, promo: unknown, extra: Record<string, unknown> = {}) {
  return {
    id, client_id: 'client-1', status, title: '春季', updated_at: '2026-11-01T00:00:00.000Z',
    approved_at: id === 'plan-old' ? '2026-10-01T00:00:00.000Z' : '2026-11-01T00:00:00.000Z',
    generation_meta: null, plan_data: { tasks: [], promo }, ...extra,
  }
}

function money(promo: PromoSpec): string {
  return JSON.stringify({ daily_total_cap_cents: promo.daily_total_cap_cents, phases: promo.phases })
}

function withoutDelivery(planData: { promo: PromoSpec }): string {
  const promo = { ...planData.promo }
  delete promo.delivery
  return stableStringify({ ...planData, promo })
}

beforeEach(() => {
  m.access.mockReset()
  m.access.mockResolvedValue({ ok: true, user: { email: 'fde@example.com' } })
  m.plans = []
  m.actions = []
  m.writes = []
  m.tables = []
  m.auditError = false
})

describe('PATCH promo/delivery', () => {
  it('只改阶段，上限和步骤预算与改前逐字相同，并写下是谁改的', async () => {
    const spec = baseSpec()
    spec.delivery = { stage: 'test', goal: '试', started_on: '2026-11-01', test_share: 0.3, proven_share: 0.7 }
    const beforeMoney = money(spec)
    const beforeRest = withoutDelivery({ tasks: [], promo: spec } as { promo: PromoSpec })
    m.plans = [plan('plan-live', 'approved', spec)]
    const res = await PATCH(req({ stage: 'steady' }), { params: P })
    expect(res.status).toBe(200)
    const written = m.writes[0].plan_data as { tasks: unknown[]; promo: PromoSpec }
    expect(money(written.promo)).toBe(beforeMoney)
    expect(withoutDelivery(written as { promo: PromoSpec })).toBe(beforeRest)
    expect(written.promo.delivery).toEqual({
      stage: 'steady', goal: STAGE_GOAL.steady, started_on: todayInNz(), test_share: 0.3, proven_share: 0.7,
    })
    expect(Object.keys(m.writes[0])).toEqual(['plan_data'])
    expect(m.actions).toHaveLength(1)
    expect(m.actions[0]).toMatchObject({
      client_id: 'client-1', flywheel: 'ads', action_type: 'ads.mark_delivery_stage', execution_mode: 'in_house',
      payload: { plan_id: 'plan-live', from_stage: 'test', to_stage: 'steady', by: 'fde@example.com', wrote_meta: false },
    })
    expect(JSON.stringify(m.actions[0])).not.toContain('daily_total_cap')
    expect(JSON.stringify(m.actions[0])).not.toContain('daily_budget')
    expect(m.tables.every(table => table === 'marketing_plans' || table === 'flywheel_actions')).toBe(true)
  })

  it('还没标阶段时可以标成稳住，不新造比例', async () => {
    m.plans = [plan('plan-live', 'approved', baseSpec())]
    expect((await PATCH(req({ stage: 'steady' }), { params: P })).status).toBe(200)
    const promo = (m.writes[0].plan_data as { promo: PromoSpec }).promo
    expect(promo.delivery?.stage).toBe('steady')
    expect(promo.delivery?.test_share).toBeUndefined()
    expect(promo.delivery?.proven_share).toBeUndefined()
    expect(m.actions[0].payload).toMatchObject({ from_stage: 'none', to_stage: 'steady' })
  })

  it('稳住可以改回试投', async () => {
    const spec = baseSpec()
    spec.delivery = { stage: 'steady', goal: STAGE_GOAL.steady, started_on: '2026-11-01' }
    m.plans = [plan('plan-live', 'approved', spec)]
    expect((await PATCH(req({ stage: 'test' }), { params: P })).status).toBe(200)
    expect((m.writes[0].plan_data as { promo: PromoSpec }).promo.delivery?.stage).toBe('test')
  })

  it.each([
    { stage: 'steady', daily_total_cap_cents: 1 },
    { stage: 'steady', daily_budget_cents: 1 },
    { stage: 'steady', promo: { schema: 'promo_v1' } },
    { stage: 'steady', goal_id: 'goal-2' },
  ])('请求里夹了别的字段 → 拒绝，不写库 %#', async (body) => {
    m.plans = [plan('plan-live', 'approved', baseSpec())]
    const res = await PATCH(req(body), { params: P })
    expect(res.status).toBe(400)
    expect(m.writes).toHaveLength(0)
    expect(m.actions).toHaveLength(0)
  })

  it('放量被拒绝，仍走另起草稿', async () => {
    m.plans = [plan('plan-live', 'approved', baseSpec())]
    const res = await PATCH(req({ stage: 'scale' }), { params: P })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('生成放量草稿')
    expect(m.writes).toHaveLength(0)
  })

  it.each(['test', 'scale'])('不是从稳住改回试投（当前 %s）→ 拒绝', async (stage) => {
    const spec = baseSpec()
    spec.delivery = { stage: stage as 'test', goal: '试', started_on: '2026-11-01' }
    m.plans = [plan('plan-live', 'approved', spec)]
    expect((await PATCH(req({ stage: 'test' }), { params: P })).status).toBe(409)
    expect(m.writes).toHaveLength(0)
  })

  it('还没标阶段不能直接改成试投', async () => {
    m.plans = [plan('plan-live', 'approved', baseSpec())]
    expect((await PATCH(req({ stage: 'test' }), { params: P })).status).toBe(409)
    expect(m.writes).toHaveLength(0)
  })

  it.each(['draft', 'archived'])('%s 计划 → 拒绝', async (status) => {
    m.plans = [plan('plan-live', status, baseSpec())]
    expect((await PATCH(req({ stage: 'steady' }), { params: P })).status).toBe(409)
    expect(m.writes).toHaveLength(0)
    expect(m.actions).toHaveLength(0)
  })

  it('更早的已批准计划、以及已被替换的计划都不是当前这份', async () => {
    m.plans = [
      plan('plan-old', 'approved', baseSpec()),
      plan('plan-live', 'approved', baseSpec()),
    ]
    expect((await PATCH(req({ stage: 'steady' }), { params: { id: 'client-1', planId: 'plan-old' } })).status).toBe(409)
    expect(m.writes).toHaveLength(0)
    m.plans = [plan('plan-live', 'approved', baseSpec(), {
      generation_meta: { superseded_by: { plan_id: 'plan-next', at: '2026-11-02T00:00:00.000Z' } },
    })]
    expect((await PATCH(req({ stage: 'steady' }), { params: P })).status).toBe(409)
    expect(m.actions).toHaveLength(0)
  })

  it('台账写失败就改回原来的计划内容', async () => {
    const spec = baseSpec()
    const before = money(spec)
    m.plans = [plan('plan-live', 'approved', spec)]
    m.auditError = true
    expect((await PATCH(req({ stage: 'steady' }), { params: P })).status).toBe(500)
    expect(m.actions).toHaveLength(0)
    const restored = m.plans[0].plan_data as { promo: PromoSpec }
    expect(money(restored.promo)).toBe(before)
    expect(restored.promo.delivery).toBeUndefined()
  })
})
