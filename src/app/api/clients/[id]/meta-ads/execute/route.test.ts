/**
 * POST /api/clients/[id]/meta-ads/execute — cross-client reverse cases.
 *
 * Same attack as stop-loss/route.test.ts: client A's staff pass a campaign_id
 * from client B's ad account while the resolved token is the shared fallback.
 * assertCampaignOwnedByClient runs for real (not mocked); every action type must
 * stop at 403 before any Meta write or flywheel_actions audit row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  registeredAccounts: vi.fn(),
  getCampaignDetails: vi.fn(),
  setCampaignStatus: vi.fn(),
  setCampaignDailyBudget: vi.fn(),
  otherTableInsert: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn().mockResolvedValue({ ok: true, tier: 'paid_client' }),
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
      return {
        select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
        insert: m.otherTableInsert,
      }
    },
  },
}))
vi.mock('@/lib/meta/client', () => ({
  getCampaignDetails: m.getCampaignDetails,
  setCampaignStatus: m.setCampaignStatus,
  setCampaignDailyBudget: m.setCampaignDailyBudget,
}))

import { POST } from './route'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000000'

function post(body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/clients/${CLIENT_A}/meta-ads/execute`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: { id: CLIENT_A } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  m.registeredAccounts.mockResolvedValue({ data: [{ ad_account_id: 'act_1111111111' }], error: null })
  m.getCampaignDetails.mockResolvedValue({
    id: '120220000000000002', name: 'B campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '2222222222',
  })
})

describe('meta-ads/execute POST — campaign belonging to another client', () => {
  it.each([
    ['ads.pause_campaign', {}],
    ['ads.adjust_bid', { new_daily_budget: 1 }],
    ['ads.reactivate_campaign', {}],
  ])('%s on client B campaign → 403, no Meta write, no audit row', async (action_type, params) => {
    const res = await post({ action_type, campaign_id: '120220000000000002', params })

    expect(res.status).toBe(403)
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
    expect(m.setCampaignDailyBudget).not.toHaveBeenCalled()
    expect(m.otherTableInsert).not.toHaveBeenCalled()
  })

  it('campaign in client A own account → passes the ownership gate (control case)', async () => {
    m.getCampaignDetails.mockResolvedValue({
      id: '120210000000000001', name: 'A campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '1111111111',
    })
    m.setCampaignStatus.mockResolvedValue(true)
    m.otherTableInsert.mockReturnValue({
      select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'act1' }, error: null }) }),
    })

    const res = await post({ action_type: 'ads.pause_campaign', campaign_id: '120210000000000001' })

    expect(res.status).not.toBe(403)
    expect(m.setCampaignStatus).toHaveBeenCalledWith('120210000000000001', 'SHARED_FALLBACK_TOKEN', 'PAUSED')
  })
})
