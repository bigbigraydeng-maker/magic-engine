/**
 * 广告起草接口：只读、不落库。
 * 数据读取层（facts / promo-draft-facts）用假实现，这里只验证路由的决策与「绝不写库」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  approver: vi.fn(),
  bookingAccess: vi.fn(),
  owned: vi.fn(),
  facts: vi.fn(),
  plan: null as Record<string, unknown> | null,
  industry: null as string | null,
  writes: [] as { op: string; table: string; payload: unknown }[],
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePlanApproverAccess: m.approver }))
vi.mock('@/lib/crm/booking-access', () => ({ requireBookingAccess: m.bookingAccess }))
vi.mock('@/lib/marketing-plan/promo/facts', () => ({ loadOwnedAccounts: m.owned }))
vi.mock('@/lib/ads-strategy/promo-draft-facts', () => ({ loadAdsDraftFacts: m.facts }))
vi.mock('@/lib/supabase', () => {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = () => c
    c.maybeSingle = async () => {
      if (table === 'clients') return { data: { industry: m.industry }, error: null }
      return { data: m.plan, error: null }
    }
    // 任何写操作一旦被调用就记下来，供「绝不写库」断言
    c.update = (payload: unknown) => { m.writes.push({ op: 'update', table, payload }); return c }
    c.insert = (payload: unknown) => { m.writes.push({ op: 'insert', table, payload }); return c }
    c.upsert = (payload: unknown) => { m.writes.push({ op: 'upsert', table, payload }); return c }
    return c
  }
  return { supabaseAdmin: { from: (table: string) => chain(table) } }
})

import { POST } from '../draft/route'

const P = { id: 'client-1', planId: 'plan-1' }
const req = (body: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

const draftFacts = () => ({
  today: '2026-11-12',
  insights_as_of: '2026-11-11T00:00:00Z',
  headroom: { ok: false as const, reason: 'no_cap' },
  account_delivering_minor: null,
  account_cap_minor: null,
  committed_minor: 0,
  daily: null,
  audiences: null,
  audiences_complete: null,
  approved_creatives: null,
  budget_share_of_headroom: 0.5,
  min_audience_size: 1000,
  max_creatives: 3,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.writes = []
  m.approver.mockResolvedValue({ ok: true, user: { email: 'fde@example.com' } })
  m.bookingAccess.mockResolvedValue({ ok: true, role: 'me_admin' })
  m.owned.mockResolvedValue([{ id: 'act_1', cap: null }])
  m.facts.mockResolvedValue(draftFacts())
  m.plan = { id: 'plan-1', status: 'draft', client_id: 'client-1', plan_data: {} }
  m.industry = 'ecommerce'
})

describe('POST promo/draft — 广告起草（只读）', () => {
  it('非内部账号 → 403 reason approver_only，不读事实', async () => {
    m.approver.mockResolvedValue({ ok: false, status: 403, error: 'no', reason: 'approver_only' })
    const res = await POST(req({ ad_account_id: 'act_1' }), { params: P })
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe('approver_only')
    expect(m.facts).not.toHaveBeenCalled()
  })

  it('缺 ad_account_id → 400', async () => {
    const res = await POST(req({}), { params: P })
    expect(res.status).toBe(400)
    expect(m.facts).not.toHaveBeenCalled()
  })

  it('other_steps 金额为负数 → 400', async () => {
    const res = await POST(req({ ad_account_id: 'act_1', other_steps: [{ ad_account_id: 'act_1', daily_budget_cents: -1 }] }), { params: P })
    expect(res.status).toBe(400)
    expect(m.facts).not.toHaveBeenCalled()
  })

  it('计划不存在 → 404', async () => {
    m.plan = null
    const res = await POST(req({ ad_account_id: 'act_1' }), { params: P })
    expect(res.status).toBe(404)
  })

  it('计划不是草稿 → 409', async () => {
    m.plan = { id: 'plan-1', status: 'approved', client_id: 'client-1', plan_data: {} }
    const res = await POST(req({ ad_account_id: 'act_1' }), { params: P })
    expect(res.status).toBe(409)
    expect(m.facts).not.toHaveBeenCalled()
  })

  it('账户读失败（owned 返回 null）→ 503', async () => {
    m.owned.mockResolvedValue(null)
    const res = await POST(req({ ad_account_id: 'act_1' }), { params: P })
    expect(res.status).toBe(503)
    expect(m.facts).not.toHaveBeenCalled()
  })

  it('账户不属于该客户 → 400，不读事实', async () => {
    m.owned.mockResolvedValue([{ id: 'act_other', cap: null }])
    const res = await POST(req({ ad_account_id: 'act_1' }), { params: P })
    expect(res.status).toBe(400)
    expect(m.facts).not.toHaveBeenCalled()
  })

  it('正常：返回草稿，且绝不写库', async () => {
    const res = await POST(req({ ad_account_id: 'act_1', other_steps: [{ ad_account_id: 'act_1', daily_budget_cents: 5000 }, { ad_account_id: 'act_2', daily_budget_cents: 700 }] }), { params: P })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.today).toBe('2026-11-12')
    expect(json.insights_as_of).toBe('2026-11-11T00:00:00Z')
    expect(json.draft).toBeTruthy()
    for (const key of ['daily_budget_cents', 'audience_ref', 'creative_refs', 'warnings']) {
      expect(json.draft).toHaveProperty(key)
    }
    expect(m.writes).toHaveLength(0)
    expect(m.bookingAccess).toHaveBeenCalledWith(P.id, 'view')
    expect(m.facts).toHaveBeenCalledWith(expect.objectContaining({ companyConfirmedBookingsAllowed: true }))
    // 同账户的占用扣账户上限，所有账户的占用都扣客户总上限
    expect(m.facts).toHaveBeenCalledWith(expect.objectContaining({ committedMinor: 5000, committedAllMinor: 5700 }))
  })

  it('CRM 预订权限无法确认时仍返回原草稿路径，不加载 CRM 依据', async () => {
    m.bookingAccess.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    const res = await POST(req({ ad_account_id: 'act_1' }), { params: P })
    expect(res.status).toBe(200)
    expect(m.facts).toHaveBeenCalledWith(expect.objectContaining({ companyConfirmedBookingsAllowed: false }))
    expect(m.writes).toHaveLength(0)
  })

  it('loadAdsDraftFacts 抛错 → 500', async () => {
    m.facts.mockRejectedValue(new Error('boom'))
    const res = await POST(req({ ad_account_id: 'act_1' }), { params: P })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })
})
