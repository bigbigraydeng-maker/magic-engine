/**
 * POST /api/clients/[id]/ad-health/stop-loss — cross-client reverse cases.
 *
 * Attack being locked out (2026-09-13 魏征 finding): client A's staff pass the
 * campaign_id of a campaign that lives in client B's ad account. The token is the
 * shared fallback that can read/write both accounts, so the ONLY thing standing
 * between A and B's budget is assertCampaignOwnedByClient. It is deliberately NOT
 * mocked here — the test drives the real guard through the route and asserts no
 * Meta write function is ever reached.
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
  stopLossAccess: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn().mockResolvedValue({ ok: true, tier: 'paid_client', user: { id: 'operator-1' } }),
}))
vi.mock('@/lib/action-submission/stop-loss', () => ({
  requireStopLossAccess: m.stopLossAccess,
  submitStopLossThroughKernel: m.submitStopLoss,
}))
vi.mock('@/lib/kernel', () => ({ createKernel: vi.fn(() => ({ kernel: true })) }))
vi.mock('@/lib/ads-strategy/account-timezone', () => ({ resolveAccountTimezone: vi.fn().mockResolvedValue('Pacific/Auckland'), accountDayKey: vi.fn(() => '2026-09-30') }))
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

function expectNoMetaWrite() {
  expect(m.setCampaignStatus).not.toHaveBeenCalled()
  expect(m.setCampaignDailyBudget).not.toHaveBeenCalled()
  expect(m.setAdSetDailyBudget).not.toHaveBeenCalled()
  expect(m.setAdSetStatus).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  m.stopLossAccess.mockResolvedValue({ ok: true, tier: 'admin', user: { id: 'operator-1' } })
  // Client A only ever registered its own account.
  m.registeredAccounts.mockResolvedValue({ data: [{ ad_account_id: 'act_1111111111' }], error: null })
  m.submitStopLoss.mockResolvedValue({ action: 'pause_campaign', runs: [] })
})

describe('stop-loss POST — non-internal account', () => {
  it.each(['pause', 'cut'] as const)('action=%s by a client account → 403, nothing submitted', async action => {
    m.stopLossAccess.mockResolvedValue({ ok: false, status: 403, error: '批准和修改推广计划需要 Magic Lab 内部账号', reason: 'approver_only' })
    const res = await post({ campaign_id: '120220000000000001', action })
    expect(res.status).toBe(403)
    expect(m.getCampaignDetails).not.toHaveBeenCalled()
    expect(m.submitStopLoss).not.toHaveBeenCalled()
    expectNoMetaWrite()
  })
})

describe('stop-loss POST — campaign belonging to another client', () => {
  it('requires a stable request ID before any Meta lookup', async () => {
    const res = await post({ campaign_id: '120220000000000002', action: 'pause', request_id: null })
    expect(res.status).toBe(400)
    expect(m.getCampaignDetails).not.toHaveBeenCalled()
    expectNoMetaWrite()
  })

  it.each(['pause', 'cut'] as const)('action=%s on client B campaign → 403, no Meta write', async action => {
    m.getCampaignDetails.mockResolvedValue({
      id: '120220000000000002', name: 'B campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '2222222222',
    })

    const res = await post({ campaign_id: '120220000000000002', action })

    expect(res.status).toBe(403)
    expectNoMetaWrite()
  })

  it('campaign_id smuggling extra Graph params → 403 before any Meta request is built', async () => {
    const res = await post({ campaign_id: '120220000000000002?method=post&status=PAUSED', action: 'pause' })

    expect(res.status).toBe(403)
    expect(m.getCampaignDetails).not.toHaveBeenCalled()
    expectNoMetaWrite()
  })

  it('registry lookup fails → 403 fail-closed, Meta campaign never even read', async () => {
    m.registeredAccounts.mockResolvedValue({ data: null, error: { message: 'timeout' } })

    const res = await post({ campaign_id: '120220000000000002', action: 'pause' })

    expect(res.status).toBe(403)
    expect(m.getCampaignDetails).not.toHaveBeenCalled()
    expectNoMetaWrite()
  })

  it('belongs-to-client budget cut returns Kernel warnings without a direct Meta write', async () => {
    m.getCampaignDetails.mockResolvedValue({
      id: '120220000000000002', name: 'A campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '1111111111',
    })
    m.submitStopLoss.mockResolvedValueOnce({ action: 'cut_campaign', runs: [
      { entityId: '120220000000000002', name: 'A campaign', runId: 'run-1', kind: 'succeeded', humanReason: null, warnings: ['广告系列状态已变化，未自动重新开启。'] },
    ] })
    const res = await post({ campaign_id: '120220000000000002', action: 'cut' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, executed: true, status: 'executed', runs: [{ runId: 'run-1' }], warnings: ['广告系列状态已变化，未自动重新开启。'] })
    // 内核和库里都用 act_ 形式；Meta 返回纯数字，路由入口负责规范化。
    expect(m.submitStopLoss).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clientId: CLIENT_A, goalId: undefined, campaignId: '120220000000000002', adAccountId: 'act_1111111111',
      cycleDate: '2026-09-30', requestId: 'de305d54-75b4-431b-adb2-eb6b9e546014', action: 'cut_campaign',
    }))
    expectNoMetaWrite()
  })
})
