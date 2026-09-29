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
  otherTableInsert: vi.fn(),
  queueBudget: vi.fn(),
  inngestSend: vi.fn(),
  statusRun: null as null | Record<string, unknown>,
  statusReceipt: null as null | Record<string, unknown>,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn().mockResolvedValue({ ok: true, tier: 'paid_client', user: { id: 'user-a', email: 'a@example.test' } }),
}))
vi.mock('@/lib/action-submission/ads-campaign-budget', () => ({
  requireAdsCampaignBudgetAccess: vi.fn(async () => ({ ok: true, tier: 'paid_client', user: { id: 'user-a', email: 'a@example.test' } })),
  queueAdsCampaignBudgetDecrease: m.queueBudget,
}))
vi.mock('@/lib/inngest/client', () => ({ CLOUD_FN_PREFIX: 'cloud-', inngest: { send: m.inngestSend } }))
vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: vi.fn().mockResolvedValue('SHARED_FALLBACK_TOKEN'),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_meta_ad_accounts') {
        return { select: () => ({ eq: m.registeredAccounts }) }
      }
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.maybeSingle = vi.fn().mockResolvedValue({
        data: table === 'action_runs' ? m.statusRun : m.statusReceipt,
        error: null,
      })
      builder.insert = m.otherTableInsert
      return {
        ...builder,
        insert: m.otherTableInsert,
      }
    },
  },
}))
vi.mock('@/lib/meta/client', () => ({
  getCampaignDetails: m.getCampaignDetails,
  setCampaignStatus: m.setCampaignStatus,
}))

import { GET, POST } from './route'

const CLIENT_A = 'aaaaaaaa-0000-4000-8000-000000000000'

function post(body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/clients/${CLIENT_A}/meta-ads/execute`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: { id: CLIENT_A } },
  )
}

function get(runId: string) {
  return GET(
    new NextRequest(`http://localhost/api/clients/${CLIENT_A}/meta-ads/execute?runId=${runId}`),
    { params: { id: CLIENT_A } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  m.queueBudget.mockResolvedValue({ run: { id: 'bbbbbbbb-0000-4000-8000-000000000000' }, existing: false })
  m.inngestSend.mockResolvedValue({ ids: ['event-1'] })
  m.statusRun = null
  m.statusReceipt = null
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

  it('queues the Kernel action in Inngest and does not call a Meta writer from the route', async () => {
    m.getCampaignDetails.mockResolvedValue({
      id: '120210000000000001', name: 'A campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '1111111111',
    })
    m.otherTableInsert.mockReturnValue({
      select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'act1' }, error: null }) }),
    })

    const res = await post({ action_type: 'ads.adjust_bid', campaign_id: '120210000000000001', params: { new_daily_budget: 40 } })

    expect(res.status).toBe(202)
    expect(m.queueBudget).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clientId: CLIENT_A,
      campaignId: '120210000000000001',
      adAccountId: '1111111111',
      afterCents: 4_000,
      access: expect.objectContaining({ ok: true }),
    }))
    expect(m.inngestSend).toHaveBeenCalledWith(expect.objectContaining({
      name: 'ads.campaign_budget.decrease_requested',
      data: { client_id: CLIENT_A, action_run_id: 'bbbbbbbb-0000-4000-8000-000000000000' },
    }))
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
    expect(m.otherTableInsert).not.toHaveBeenCalled()
  })

  it('rejects increases before Kernel submission', async () => {
    m.getCampaignDetails.mockResolvedValue({
      id: '120210000000000001', name: 'A campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '1111111111',
    })
    const res = await post({ action_type: 'ads.adjust_bid', campaign_id: '120210000000000001', params: { new_daily_budget: 60 } })
    expect(res.status).toBe(422)
    expect(m.queueBudget).not.toHaveBeenCalled()
  })

  it('polls only a budget run belonging to the authenticated client', async () => {
    m.statusRun = { id: 'bbbbbbbb-0000-4000-8000-000000000000', client_id: CLIENT_A, action_key: 'ads.cut_campaign_budget', status: 'succeeded', last_error: null }
    m.statusReceipt = { id: 'receipt-1', payload: { status: 'succeeded' } }

    const response = await get('bbbbbbbb-0000-4000-8000-000000000000')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'succeeded', receipt: { id: 'receipt-1' } })
  })
})
