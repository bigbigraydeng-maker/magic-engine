/**
 * 成绩单调预算路由：加预算直接拒绝，不改在投计划；减只出确认卡。
 * 取数与内核提交用替身，这里只测路由自己的判断。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { planBudgetChange, type BudgetChangeFacts } from '@/lib/ads-strategy/budget-change/plan'

const h = vi.hoisted(() => ({
  load: vi.fn(),
  submitScale: vi.fn(),
  submitStop: vi.fn(),
  issue: vi.fn(),
  scaleAccess: vi.fn(),
  stopAccess: vi.fn(),
  owned: vi.fn(),
  goal: { data: { id: 'goal-1' } as { id: string } | null, error: null as { message: string } | null },
}))

vi.mock('@/lib/ads-strategy/budget-change/load', () => ({ loadBudgetChange: h.load }))
vi.mock('@/lib/action-submission/ads-o1-budget-scale', () => ({
  requireAdsO1BudgetScaleAccess: h.scaleAccess, submitAdsO1BudgetScale: h.submitScale,
}))
vi.mock('@/lib/action-submission/stop-loss', () => ({
  requireStopLossAccess: h.stopAccess, submitStopLossThroughKernel: h.submitStop,
}))
vi.mock('@/lib/kernel', () => ({ createKernel: () => ({}) }))
vi.mock('@/lib/action-submission/money-card', () => ({
  issueMoneyBudget: h.issue,
  clickerFromAccess: () => ({ kind: 'opc', email: 'staff@magiclab.test' }),
}))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: async () => 'tok' }))
vi.mock('@/lib/meta/campaign-ownership', () => ({ assertCampaignOwnedByClient: h.owned }))
vi.mock('@/lib/ads-strategy/account-timezone', () => ({
  resolveAccountTimezone: async () => 'Pacific/Auckland', accountDayKey: () => '2026-11-04',
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => h.goal }
      return q
    },
  },
}))

import { GET, POST } from './route'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const params = { params: { id: CLIENT } }
const unitBody = { level: 'adset', unit_id: '456', ad_account_id: 'act_123' }
const facts: BudgetChangeFacts = {
  currentCents: 10000, currency: 'NZD', metaUpdatedTime: '2026-10-30T00:00:00.000Z', now: new Date('2026-11-04T00:00:00.000Z'),
  scaleBlockedReason: null, envelope: { up10: { within: true, reasons: [] }, up20: { within: true, reasons: [] } },
  envelopeUnavailable: null, clientDailyCapCents: 50000, clientDailyTotalCents: 30000,
}
const loaded = (f: Partial<BudgetChangeFacts> = {}) => ({
  ok: true as const,
  plan: planBudgetChange({ ...facts, ...f }),
  target: { level: 'adset', id: '456', adAccountId: 'act_123', scaleAdsetId: '456', campaignId: '789', cycleDate: '2026-11-03' },
})
const admin = { ok: true, tier: 'admin', allowedClientId: null, user: { id: 'u1', email: 'staff@magiclab.test' } }

function post(body: Record<string, unknown>) {
  return POST(new NextRequest(`http://x/api/clients/${CLIENT}/ad-health/budget-change`, { method: 'POST', body: JSON.stringify(body) }), params)
}

beforeEach(() => {
  process.env.ADS_SPEND_APPROVER_EMAILS = 'pm@magiclab.test'
  h.load.mockResolvedValue(loaded())
  h.scaleAccess.mockResolvedValue(admin)
  h.stopAccess.mockResolvedValue(admin)
  h.owned.mockResolvedValue({ ok: true, campaign: { id: '789' } })
  h.goal = { data: { id: 'goal-1' }, error: null }
  h.submitScale.mockResolvedValue({ kind: 'pending_approval', run: { id: 'run-1' }, humanReason: null })
  h.submitStop.mockResolvedValue({ action: 'cut_unit', runs: [{ entityId: '456', name: '456', runId: 'run-2', kind: 'succeeded', humanReason: null, warnings: [] }] })
  h.issue.mockResolvedValue({ card: { runId: 'card-1' }, reason: null, wroteMeta: false })
})
afterEach(() => { vi.clearAllMocks(); delete process.env.ADS_SPEND_APPROVER_EMAILS })

describe('GET 预览', () => {
  it('参数不对 → 400，不取数', async () => {
    const res = await GET(new NextRequest(`http://x/api?level=ad&unit_id=456&ad_account_id=act_123`), params)
    expect(res.status).toBe(400)
    expect(h.load).not.toHaveBeenCalled()
  })

  it('回预览和闸是否在位', async () => {
    const res = await GET(new NextRequest(`http://x/api?level=adset&unit_id=456&ad_account_id=act_123`), params)
    expect(res.status).toBe(200)
    expect((await res.json()).spendGateReady).toBe(true)
  })
})

describe('POST 加预算', () => {
  it('🔴 加钱批准人名单没配 → 503，不提交', async () => {
    delete process.env.ADS_SPEND_APPROVER_EMAILS
    const res = await post({ ...unitBody, kind: 'up10' })
    expect(res.status).toBe(503)
    expect(h.submitScale).not.toHaveBeenCalled()
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('在投计划不能在这里加预算：请求体里的金额不起作用，不出卡，不写', async () => {
    const res = await post({ ...unitBody, kind: 'up10', after_cents: 999999 })
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body).toMatchObject({ wroteMeta: false })
    expect(body.error).toContain('新开一份计划')
    expect(h.submitScale).not.toHaveBeenCalled()
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('72 小时内改过 → 409 带原因，不提交', async () => {
    h.load.mockResolvedValue(loaded({ metaUpdatedTime: '2026-11-03T20:00:00.000Z' }))
    const res = await post({ ...unitBody, kind: 'up20' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('小时前刚改过')
    expect(h.submitScale).not.toHaveBeenCalled()
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('不是内部负责人 → 403', async () => {
    h.scaleAccess.mockResolvedValue({ ...admin, tier: 'paid_client' })
    expect((await post({ ...unitBody, kind: 'up10' })).status).toBe(403)
  })
})

describe('POST 减预算', () => {
  const rid = '11111111-2222-4333-8444-555555555555'

  it('🔴 一次超过 20%（7999）→ 409，不执行', async () => {
    const res = await post({ ...unitBody, kind: 'down_to', target_cents: 7999, request_id: rid })
    expect(res.status).toBe(409)
    expect(h.submitStop).not.toHaveBeenCalled()
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('8000 → 出降预算确认卡，不写 Meta', async () => {
    const res = await post({ ...unitBody, kind: 'down_to', target_cents: 8000, request_id: rid })
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ status: 'awaiting_confirmation', wroteMeta: false })
    expect(h.submitStop).not.toHaveBeenCalled()
    expect(h.issue).toHaveBeenCalledWith(expect.objectContaining({
      source: 'scorecard_down', beforeCents: 10000, afterCents: 8000, requestId: rid, campaignId: '789',
    }))
  })

  it('request_id 不是 UUID → 400', async () => {
    expect((await post({ ...unitBody, kind: 'down_to', target_cents: 8000, request_id: 'x' })).status).toBe(400)
  })

  it('🔴 系列不属于客户登记的广告账户 → 403，不执行', async () => {
    h.owned.mockResolvedValue({ ok: false, error: '不属于这个客户' })
    const res = await post({ ...unitBody, kind: 'down_to', target_cents: 8000, request_id: rid })
    expect(res.status).toBe(403)
    expect(h.submitStop).not.toHaveBeenCalled()
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('减系列预算 → 出系列降预算卡，不要求增长目标，不写 Meta', async () => {
    h.goal = { data: null, error: null }
    h.load.mockResolvedValue({ ...loaded(), target: { level: 'campaign', id: '789', adAccountId: 'act_123', scaleAdsetId: null, campaignId: '789', cycleDate: '2026-11-03' } })
    const res = await post({ level: 'campaign', unit_id: '789', ad_account_id: 'act_123', kind: 'down_to', target_cents: 8000, request_id: rid })
    expect(res.status).toBe(202)
    expect(h.submitStop).not.toHaveBeenCalled()
    expect(h.issue).toHaveBeenCalledWith(expect.objectContaining({ source: 'scorecard_down', level: 'campaign', goalId: null }))
  })

  it('没有出卡 → 409，不写 Meta', async () => {
    h.issue.mockResolvedValue({ card: null, reason: '没有出卡。', wroteMeta: false })
    const res = await post({ ...unitBody, kind: 'down_to', target_cents: 8000, request_id: rid })
    expect(res.status).toBe(409)
    expect(h.submitStop).not.toHaveBeenCalled()
  })
})
