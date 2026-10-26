/**
 * POST /api/clients/[id]/ad-health/stop-loss — 账户号形状（生产 503 回归）。
 *
 * 生产缺陷：Meta 的 campaign.account_id 是纯数字（`953025114498626`），而
 * `resolveAccountTimezone` 按 `ad_entity_snapshots.ad_account_id`（`act_…` 形式）
 * 查，纯数字永远查不到 → 503 `timezone_unreadable`。
 *
 * 🔴 这里**故意不 mock** `@/lib/ads-strategy/account-timezone`：原测试把它 mock 成
 * 永远返回时区，正好把这条缺陷盖住了。本文件让真的 `resolveAccountTimezone` 跑，
 * 只 mock 数据库，断言路由入口把纯数字规范化成 `act_` 形式。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  registeredAccounts: vi.fn(),
  getCampaignDetails: vi.fn(),
  setCampaignStatus: vi.fn(),
  setCampaignDailyBudget: vi.fn(),
  setAdSetDailyBudget: vi.fn(),
  setAdSetStatus: vi.fn(),
  submitStopLoss: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn().mockResolvedValue({ ok: true, tier: 'paid_client', user: { id: 'operator-1' } }),
}))
vi.mock('@/lib/action-submission/stop-loss', () => ({
  requireStopLossAccess: vi.fn().mockResolvedValue({ ok: true, tier: 'paid_client', user: { id: 'operator-1' } }),
  submitStopLossThroughKernel: m.submitStopLoss,
}))
vi.mock('@/lib/kernel', () => ({ createKernel: vi.fn(() => ({ kernel: true })) }))
vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: vi.fn().mockResolvedValue('SHARED_FALLBACK_TOKEN'),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_meta_ad_accounts') {
        return { select: () => ({ eq: m.registeredAccounts }) }
      }
      if (table === 'goals') {
        const q = { eq: () => q, order: () => q, limit: () => q, maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'goal-1' }, error: null }) }
        return { select: () => q }
      }
      if (table === 'ad_entity_snapshots') {
        // 模拟 resolveAccountTimezone 的查询链：
        //   .select('timezone_name').eq('ad_account_id', X).eq('level', 'account').order(...).limit(1)
        // 只有 X === 'act_1111111111' 才有时区；纯数字查不到 —— 这正是生产缺陷的形状。
        const filters: Record<string, unknown> = {}
        const chain = {
          eq(col: string, val: unknown) {
            filters[col] = val
            return chain
          },
          order() {
            return chain
          },
          limit() {
            if (filters.ad_account_id === 'act_1111111111' && filters.level === 'account') {
              return Promise.resolve({ data: [{ timezone_name: 'Pacific/Auckland' }], error: null })
            }
            return Promise.resolve({ data: [], error: null })
          },
        }
        return { select: () => chain }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    },
  },
}))
vi.mock('@/lib/meta/client', () => ({
  getCampaignDetails: m.getCampaignDetails,
  setCampaignStatus: m.setCampaignStatus,
  setCampaignDailyBudget: m.setCampaignDailyBudget,
}))
vi.mock('@/lib/meta/adsets', () => ({
  listAdSetsInCampaign: vi.fn().mockResolvedValue([]),
  setAdSetDailyBudget: m.setAdSetDailyBudget,
  getAdSetStatus: vi.fn().mockResolvedValue(null),
  setAdSetStatus: m.setAdSetStatus,
}))

import { POST } from './route'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000000'

function post(body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/clients/${CLIENT_A}/ad-health/stop-loss`, {
      method: 'POST',
      body: JSON.stringify({ request_id: 'de305d54-75b4-431b-adb2-eb6b9e546014', ...(body as object) }),
    }),
    { params: { id: CLIENT_A } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  m.registeredAccounts.mockResolvedValue({ data: [{ ad_account_id: 'act_1111111111' }], error: null })
  m.submitStopLoss.mockResolvedValue({
    action: 'pause_campaign',
    runs: [{ entityId: '120220000000000002', name: 'A campaign', runId: 'run-1', kind: 'succeeded', humanReason: null, warnings: [] }],
  })
})

describe('stop-loss POST — 账户号形状', () => {
  it('Meta 返回纯数字账户号 → 真的取到时区 → 200，且交给内核的 adAccountId 是 act_ 形式', async () => {
    m.getCampaignDetails.mockResolvedValue({
      id: '120220000000000002', name: 'A campaign', status: 'PAUSED', daily_budget: '1000', account_id: '1111111111',
    })

    const res = await post({ campaign_id: '120220000000000002', action: 'pause' })

    expect(res.status).toBe(200)
    expect(m.submitStopLoss).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      adAccountId: 'act_1111111111',
    }))
  })

  it('Meta 返回 act_ 形式 → 原样使用', async () => {
    m.getCampaignDetails.mockResolvedValue({
      id: '120220000000000002', name: 'A campaign', status: 'PAUSED', daily_budget: '1000', account_id: 'act_1111111111',
    })

    const res = await post({ campaign_id: '120220000000000002', action: 'pause' })

    expect(res.status).toBe(200)
    expect(m.submitStopLoss).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      adAccountId: 'act_1111111111',
    }))
  })

  it('Meta 没给账户号 → 归属校验先拒（403），绝不提交内核', async () => {
    // 实测：这一步在 toActAccountId 之前，真的归属校验（AD-SEC-1）已经 fail-closed。
    // 路由里 account_id_unreadable 那个 503 因此是第二道兜底，这个形状走不到它。
    m.getCampaignDetails.mockResolvedValue({
      id: '120220000000000002', name: 'A campaign', status: 'PAUSED', daily_budget: '1000',
    })

    const res = await post({ campaign_id: '120220000000000002', action: 'pause' })

    expect(res.status).toBe(403)
    expect(m.submitStopLoss).not.toHaveBeenCalled()
  })

  it('账户号形状不认识（比如 abc）→ 归属校验先拒（403），绝不提交内核', async () => {
    m.getCampaignDetails.mockResolvedValue({
      id: '120220000000000002', name: 'A campaign', status: 'PAUSED', daily_budget: '1000', account_id: 'abc',
    })

    const res = await post({ campaign_id: '120220000000000002', action: 'pause' })

    expect(res.status).toBe(403)
    expect(m.submitStopLoss).not.toHaveBeenCalled()
  })
})
