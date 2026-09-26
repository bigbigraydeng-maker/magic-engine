/**
 * POST /api/clients/[id]/ad-health/stop-loss
 *
 * ① 跨客户反向用例（2026-09-13 魏征发现的攻击面）：A 客户的人提交一条属于 B 客户
 *    广告账户的 campaign_id。令牌是能同时读写两个账户的共用兜底令牌，所以挡在 A 和
 *    B 的预算之间的**只有** `assertCampaignOwnedByClient`。这里刻意**不** mock 它 ——
 *    用真守卫跑一遍路由，并断言什么都没被提交出去。
 *
 * 🔴 2026-09-27（WP3.1b）：判据换了。这条路径已经收编进执行内核，路由自己不再打 Meta，
 *    所以「没有调过 Meta 写函数」这句断言从此**恒真** —— 恒真的断言等于没有断言
 *    （本仓反复出事的形状：绿有两种来路，一种是真的没事，一种是判据整个失效）。
 *    现在真正要锁的是：**没有任何 `action_run` 被提交**。Meta 写模块那条断言也保留，
 *    但指向真正的写模块 `@/lib/meta/adset-writes`。
 *
 * ② 收编之后的前置闸：没有在跑的增长目标 / 预算挂在广告系列上（CBO）→ 都必须 fail closed
 *    且带上人工任务三件套，不许静默什么都不做，也不许假装做了。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  registeredAccounts: vi.fn(),
  legacyAccount: vi.fn(),
  goals: vi.fn(),
  getCampaignDetails: vi.fn(),
  listAdSetsInCampaign: vi.fn(),
  submitStopLoss: vi.fn(),
  setAdSetDailyBudget: vi.fn(),
  setAdSetStatus: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn().mockResolvedValue({
    ok: true, tier: 'paid_client', user: { email: 'pm@example.com' },
  }),
}))
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
        return { select: () => ({ eq: () => ({ eq: () => ({ order: m.goals }) }) }) }
      }
      if (table === 'clients') {
        return { select: () => ({ eq: () => ({ maybeSingle: m.legacyAccount }) }) }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    },
  },
}))
vi.mock('@/lib/meta/client', () => ({ getCampaignDetails: m.getCampaignDetails }))
vi.mock('@/lib/meta/adsets', () => ({
  listAdSetsInCampaign: m.listAdSetsInCampaign,
  getAdSetStatus: vi.fn().mockResolvedValue(null),
}))
// 真正的对外写模块 —— 收编之后路由**不该**再 import 它；mock 在这里是为了万一有人
// 把它接回去，下面那条断言能立刻咬住（架构测试也会同时咬，两道各一次）。
vi.mock('@/lib/meta/adset-writes', () => ({
  setAdSetDailyBudget: m.setAdSetDailyBudget,
  setAdSetStatus: m.setAdSetStatus,
}))
vi.mock('@/lib/ads-strategy/stop-loss-submission', () => ({
  submitStopLossThroughKernel: m.submitStopLoss,
}))
vi.mock('@/lib/capabilities/ads-kernel-deps', () => ({
  createAdsKernelDeps: vi.fn().mockReturnValue({}),
}))

import { POST } from './route'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000000'
const B_CAMPAIGN = '120220000000000002'

function post(body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/clients/${CLIENT_A}/ad-health/stop-loss`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: { id: CLIENT_A } },
  )
}

/** 🔴 收编之后真正该锁的那句：一条 action_run 都没提交出去。 */
function expectNothingSubmitted() {
  expect(m.submitStopLoss).not.toHaveBeenCalled()
  expect(m.setAdSetDailyBudget).not.toHaveBeenCalled()
  expect(m.setAdSetStatus).not.toHaveBeenCalled()
}

const ACTIVE_GOAL = {
  id: 'goal-1', client_id: CLIENT_A, title: '每月 30 个留资',
  primary_metric_key: 'leads_count', status: 'active',
}

beforeEach(() => {
  vi.clearAllMocks()
  // Client A only ever registered its own account.
  m.registeredAccounts.mockResolvedValue({ data: [{ ad_account_id: 'act_1111111111' }], error: null })
  m.legacyAccount.mockResolvedValue({ data: null, error: null })
  m.goals.mockResolvedValue({ data: [ACTIVE_GOAL], error: null })
  m.listAdSetsInCampaign.mockResolvedValue([])
  m.submitStopLoss.mockResolvedValue({ action: 'pause', units: [] })
})

describe('stop-loss POST — 跨客户反向用例', () => {
  it.each(['pause', 'cut'] as const)('action=%s 打到 B 客户的广告上 → 403，一条 run 都不提交', async action => {
    m.getCampaignDetails.mockResolvedValue({
      id: B_CAMPAIGN, name: 'B campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '2222222222',
    })

    const res = await post({ campaign_id: B_CAMPAIGN, action })

    expect(res.status).toBe(403)
    expectNothingSubmitted()
  })

  it('campaign_id 里夹带额外 Graph 参数 → 403，连 Meta 都还没读', async () => {
    const res = await post({ campaign_id: `${B_CAMPAIGN}?method=post&status=PAUSED`, action: 'pause' })

    expect(res.status).toBe(403)
    expect(m.getCampaignDetails).not.toHaveBeenCalled()
    expectNothingSubmitted()
  })

  it('账户登记查不出来 → 403 fail-closed，Meta 一次都没读', async () => {
    m.registeredAccounts.mockResolvedValue({ data: null, error: { message: 'timeout' } })

    const res = await post({ campaign_id: B_CAMPAIGN, action: 'pause' })

    expect(res.status).toBe(403)
    expect(m.getCampaignDetails).not.toHaveBeenCalled()
    expectNothingSubmitted()
  })
})

describe('stop-loss POST — 收编之后的前置闸', () => {
  /** 这条广告属于 A 自己登记的账户，归属校验会放行。 */
  function ownCampaign(over: Record<string, unknown> = {}) {
    m.getCampaignDetails.mockResolvedValue({
      id: B_CAMPAIGN, name: 'A 的广告系列', status: 'ACTIVE', account_id: '1111111111', ...over,
    })
  }

  it('没有在跑的增长目标 → 409，带三件套，一条 run 都不提交', async () => {
    ownCampaign({ daily_budget: undefined })
    m.goals.mockResolvedValue({ data: [], error: null })

    const res = await post({ campaign_id: B_CAMPAIGN, action: 'pause' })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('no_active_goal')
    expect(body.what).toBeTruthy()
    expect(body.how).toBeTruthy()
    expect(body.href).toContain(CLIENT_A)
    expectNothingSubmitted()
  })

  it('🔴 目标读不出来 → 503，不许当成「没有目标」', async () => {
    ownCampaign({ daily_budget: undefined })
    m.goals.mockResolvedValue({ data: null, error: { message: 'timeout' } })

    const res = await post({ campaign_id: B_CAMPAIGN, action: 'pause' })
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('goal_unreadable')
    expectNothingSubmitted()
  })

  it('预算挂在广告系列上（CBO）要砍预算 → 409，三件套告诉人去哪改', async () => {
    ownCampaign({ daily_budget: '5000' })

    const res = await post({ campaign_id: B_CAMPAIGN, action: 'cut' })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('campaign_level_budget')
    expect(body.what).toBeTruthy()
    expect(body.how).toBeTruthy()
    expect(body.href).toBeTruthy()
    expectNothingSubmitted()
  })

  it('读不到广告组列表 → 409，不许把「读不到」当成「没有广告组」', async () => {
    ownCampaign({ daily_budget: undefined })
    m.listAdSetsInCampaign.mockResolvedValue(null)

    const res = await post({ campaign_id: B_CAMPAIGN, action: 'pause' })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('adsets_unreadable')
    expectNothingSubmitted()
  })

  it('系列下没有在投的广告组 → 409 nothing_active', async () => {
    ownCampaign({ daily_budget: undefined })
    m.listAdSetsInCampaign.mockResolvedValue([{ id: 'as-1', name: '已停的组', status: 'PAUSED' }])

    const res = await post({ campaign_id: B_CAMPAIGN, action: 'pause' })

    expect(res.status).toBe(409)
    expectNothingSubmitted()
  })

  it('暂停 → 逐个在投广告组提交，账户 id 用登记在册的那种写法', async () => {
    ownCampaign({ daily_budget: undefined })
    m.listAdSetsInCampaign.mockResolvedValue([
      { id: 'as-1', name: '冷启', status: 'ACTIVE', daily_budget: '3000' },
      { id: 'as-2', name: '再营销', status: 'ACTIVE' },
      { id: 'as-3', name: '已停的组', status: 'PAUSED' },
    ])
    m.submitStopLoss.mockResolvedValue({
      action: 'pause',
      units: [
        { adsetId: 'as-1', name: '冷启', runId: 'r1', kind: 'succeeded', humanReason: null },
        { adsetId: 'as-2', name: '再营销', runId: 'r2', kind: 'pending_approval', humanReason: null },
      ],
    })

    const res = await post({ campaign_id: B_CAMPAIGN, action: 'pause' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(m.submitStopLoss).toHaveBeenCalledTimes(1)
    const submitted = m.submitStopLoss.mock.calls[0][1] as {
      adAccountId: string; goalId: string; units: Array<{ adsetId: string }>
    }
    // 🔴 提交的是登记在册的 'act_1111111111'，不是 Meta 回的裸数字 '1111111111'：
    //    信封事实按快照里的写法查，用错写法会读到空 → 一律判拒 → 按钮永远失败。
    expect(submitted.adAccountId).toBe('act_1111111111')
    expect(submitted.goalId).toBe('goal-1')
    expect(submitted.units.map(u => u.adsetId)).toEqual(['as-1', 'as-2'])
    // 已停的组不该被重新碰
    expect(submitted.units.map(u => u.adsetId)).not.toContain('as-3')
    // 汇总如实分开：做掉的 / 等人点头的，不合并成一个「成功」
    expect(body.executed).toBe(1)
    expect(body.awaiting_approval).toBe(1)
  })
})
