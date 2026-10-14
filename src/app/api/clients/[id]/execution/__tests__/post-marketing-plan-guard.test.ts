/**
 * POST /execution 手工加任务（来源为营销计划）：只有已批准的计划可以。
 * 以前只查「计划存在」，草稿计划也能往执行看板派活。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  planStatus: 'draft' as string | null,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
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
          ? { data: { id: 'plan-1', status: m.planStatus }, error: null }
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

const req = (body: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })
const params = { params: { id: 'client-1' } }
const body = { marketing_plan_id: 'plan-1', title: '补一条帖子', platform: 'facebook' }

beforeEach(() => {
  vi.clearAllMocks()
  m.inserts = []
  m.planStatus = 'draft'
  m.access.mockResolvedValue({ ok: true })
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
