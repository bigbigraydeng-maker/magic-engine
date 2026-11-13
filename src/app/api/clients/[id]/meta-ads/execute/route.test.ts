/**
 * POST /api/clients/[id]/meta-ads/execute — cross-client reverse cases.
 *
 * Same attack as stop-loss/route.test.ts: client A's staff pass a campaign_id
 * from client B's ad account while the resolved token is the shared fallback.
 * assertCampaignOwnedByClient runs for real (not mocked); every action type must
 * stop at 403 before any Meta write or flywheel_actions audit row.
 *
 * The Messenger-draft reactivation guard (checkMessengerDraftCampaign) runs
 * AFTER the ownership check and is NOT scoped to the requesting client, so a
 * draft recorded under any client for the same campaign blocks reactivation.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  draftRows: [] as Array<{ client_id: string; action_type: string; payload: { draft: { kind: string }; campaignId: string } }>,
  draftLookupError: null as null | { message: string },
  authority: vi.fn(),
  fwUpdate: vi.fn(),
  callOrder: [] as string[],
  requestCard: vi.fn(),
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
vi.mock('@/lib/ads/spend-activation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ads/spend-activation')>()
  return { ...actual, requireSpendActivationAuthority: m.authority }
})
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_meta_ad_accounts') {
        return { select: () => ({ eq: m.registeredAccounts }) }
      }
      if (table === 'flywheel_actions') {
        const filters: Array<[string, unknown]> = []
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = (col: string, val: unknown) => {
          filters.push([col, val])
          return builder
        }
        builder.maybeSingle = vi.fn().mockResolvedValue({ data: m.statusReceipt, error: null })
        builder.insert = (row: unknown) => {
          m.callOrder.push('receipt_insert')
          return m.otherTableInsert(row)
        }
        builder.update = (row: unknown) => {
          m.callOrder.push('receipt_update')
          m.fwUpdate(row)
          return { eq: async () => ({ data: null, error: null }) }
        }
        builder.limit = () => {
          const rows = m.draftRows.filter((row) =>
            filters.every(([col, val]) => {
              if (
                col !== 'action_type' &&
                col !== 'payload->draft->>kind' &&
                col !== 'payload->>campaignId'
              ) {
                throw new Error('unexpected column ' + col)
              }
              const path = col.replace('->>', '->').split('->')
              let current: unknown = row
              for (const segment of path) {
                if (current === null || typeof current !== 'object') return false
                current = (current as Record<string, unknown>)[segment]
              }
              return current === val
            }),
          )
          return Promise.resolve({ data: rows, error: m.draftLookupError })
        }
        return builder
      }
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.maybeSingle = vi.fn().mockResolvedValue({
        data: table === 'action_runs' ? m.statusRun : m.statusReceipt,
        error: null,
      })
      builder.insert = (row: unknown) => {
        m.callOrder.push('receipt_insert')
        return m.otherTableInsert(row)
      }
      return {
        ...builder,
        insert: (row: unknown) => {
          m.callOrder.push('receipt_insert')
          return m.otherTableInsert(row)
        },
      }
    },
  },
}))
vi.mock('@/lib/action-submission/campaign-status-card', () => ({
  requestCampaignStatusCard: m.requestCard,
}))
vi.mock('@/lib/meta/client', () => ({
  getCampaignDetails: m.getCampaignDetails,
  setCampaignStatus: (...args: unknown[]) => {
    m.callOrder.push('meta_set_status')
    return m.setCampaignStatus(...args)
  },
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
  m.draftRows = []
  m.draftLookupError = null
  m.callOrder = []
  m.authority.mockResolvedValue({ ok: true, actorUserId: 'u-pm', actorEmail: 'pm@magiclab.test', basis: 'global_admin' })
  m.requestCard.mockResolvedValue({
    status: 202,
    body: { success: false, status: 'awaiting_confirmation', wroteMeta: false },
  })
  m.registeredAccounts.mockResolvedValue({ data: [{ ad_account_id: 'act_1111111111' }], error: null })
  m.getCampaignDetails.mockResolvedValue({
    id: '120220000000000002', name: 'B campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '2222222222',
  })
})

describe('meta-ads/execute POST — campaign belonging to another client', () => {
  it.each([
    ['ads.pause_campaign', {}],
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

    expect(res.status).toBe(202)
    expect(m.requestCard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'pause',
      campaignId: '120210000000000001',
      clientId: CLIENT_A,
    }))
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })

  it.each([40, 60])('refuses a direct budget change (%s) before any queue or Meta read', async (newDailyBudget) => {
    m.getCampaignDetails.mockResolvedValue({
      id: '120210000000000001', name: 'A campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '1111111111',
    })

    const res = await post({
      action_type: 'ads.adjust_bid',
      campaign_id: '120210000000000001',
      params: { new_daily_budget: newDailyBudget },
    })

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ code: 'direct_budget_change_closed' })
    expect(m.queueBudget).not.toHaveBeenCalled()
    expect(m.inngestSend).not.toHaveBeenCalled()
    expect(m.getCampaignDetails).not.toHaveBeenCalled()
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
    expect(m.requestCard).not.toHaveBeenCalled()
    expect(m.otherTableInsert).not.toHaveBeenCalled()
  })

  it('polls only a budget run belonging to the authenticated client', async () => {
    m.statusRun = { id: 'bbbbbbbb-0000-4000-8000-000000000000', client_id: CLIENT_A, action_key: 'ads.cut_campaign_budget', status: 'succeeded', last_error: null }
    m.statusReceipt = { id: 'receipt-1', payload: { status: 'succeeded' } }

    const response = await get('bbbbbbbb-0000-4000-8000-000000000000')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'succeeded', receipt: { id: 'receipt-1' } })
  })
})

describe('meta-ads/execute POST — reactivating ME Messenger draft campaigns', () => {
  const CAMP = '120210000000000001'
  const CLIENT_B = 'bbbbbbbb-1111-4000-8000-000000000000'

  function messengerRow(clientId: string, campaignId: string, kind = 'messenger_conversation') {
    return { client_id: clientId, action_type: 'ads.create_ad', payload: { draft: { kind }, campaignId } }
  }

  beforeEach(() => {
    m.getCampaignDetails.mockResolvedValue({
      id: CAMP, name: 'A campaign', status: 'PAUSED', daily_budget: '5000', account_id: '1111111111',
    })
    m.setCampaignStatus.mockResolvedValue(true)
    m.otherTableInsert.mockReturnValue({
      select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'act1' }, error: null }) }),
    })
  })

  it('blocks reactivation when a Messenger draft exists for the client', async () => {
    m.draftRows = [messengerRow(CLIENT_A, CAMP)]

    const res = await post({ action_type: 'ads.reactivate_campaign', campaign_id: CAMP })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('messenger_reactivate_blocked')
    expect(body.error).toContain('审批流程')
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
    expect(m.getCampaignDetails).toHaveBeenCalledTimes(1)
    expect(m.otherTableInsert).not.toHaveBeenCalled()
  })

  it('reactivates when no Messenger draft exists', async () => {
    const res = await post({ action_type: 'ads.reactivate_campaign', campaign_id: CAMP })

    expect(res.status).toBe(202)
    expect(m.requestCard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'resume', campaignId: CAMP }))
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })

  it('fails closed when the draft lookup errors', async () => {
    m.draftLookupError = { message: 'db down' }

    const res = await post({ action_type: 'ads.reactivate_campaign', campaign_id: CAMP })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('messenger_draft_lookup_failed')
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })

  it('blocks reactivation even when the draft was recorded under another client (shared ad account)', async () => {
    m.draftRows = [messengerRow(CLIENT_B, CAMP)]

    const res = await post({ action_type: 'ads.reactivate_campaign', campaign_id: CAMP })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('messenger_reactivate_blocked')
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })

  it('does not block when the draft kind is not a Messenger conversation', async () => {
    m.draftRows = [messengerRow(CLIENT_A, CAMP, 'video_thruplay')]

    const res = await post({ action_type: 'ads.reactivate_campaign', campaign_id: CAMP })

    expect(res.status).toBe(202)
    expect(m.requestCard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'resume' }))
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })

  it('does not block pausing a campaign that has a Messenger draft', async () => {
    m.draftRows = [messengerRow(CLIENT_A, CAMP)]

    const res = await post({ action_type: 'ads.pause_campaign', campaign_id: CAMP })

    expect(res.status).toBe(202)
    expect(m.requestCard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'pause' }))
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })

  it('refuses a malformed campaign id spelling (leading zero) without writing', async () => {
    const MALFORMED = '0120210000000000001'
    m.getCampaignDetails.mockResolvedValue({
      id: MALFORMED, name: 'A campaign', status: 'PAUSED', daily_budget: '5000', account_id: '1111111111',
    })

    const res = await post({ action_type: 'ads.reactivate_campaign', campaign_id: MALFORMED })

    expect([403, 422]).toContain(res.status)
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })

  it('does not reveal Messenger drafts of campaigns outside the client account', async () => {
    m.draftRows = [messengerRow(CLIENT_B, '120220000000000002')]
    // The describe-level beforeEach points getCampaignDetails at client A's account;
    // this case needs a campaign that lives in an account client A has NOT registered.
    m.getCampaignDetails.mockResolvedValue({
      id: '120220000000000002', name: 'B campaign', status: 'PAUSED', daily_budget: '5000', account_id: '2222222222',
    })

    const res = await post({ action_type: 'ads.reactivate_campaign', campaign_id: '120220000000000002' })

    expect(res.status).toBe(403)
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })
})

describe('meta-ads/execute POST — reactivation needs PM authority and a receipt first', () => {
  const CAMP = '120210000000000001'

  beforeEach(() => {
    m.getCampaignDetails.mockResolvedValue({
      id: CAMP, name: 'A campaign', status: 'PAUSED', daily_budget: '5000', account_id: '1111111111',
    })
    m.setCampaignStatus.mockResolvedValue(true)
    m.otherTableInsert.mockReturnValue({
      select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'act1' }, error: null }) }),
    })
  })

  it('a paid client can ask to resume, and this route does not write Meta', async () => {
    m.authority.mockResolvedValue({ ok: false, status: 403, error: 'x', code: 'activation_requires_pm' })

    const res = await post({ action_type: 'ads.reactivate_campaign', campaign_id: CAMP })

    expect(res.status).toBe(202)
    expect(m.requestCard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'resume' }))
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
    expect(m.authority).not.toHaveBeenCalled()
    expect(m.otherTableInsert).not.toHaveBeenCalled()
  })

  it('pausing still asks for a card without PM authority and does not write Meta', async () => {
    m.authority.mockResolvedValue({ ok: false, status: 403, error: 'x', code: 'activation_requires_pm' })

    const res = await post({ action_type: 'ads.pause_campaign', campaign_id: CAMP })

    expect(res.status).toBe(202)
    expect(m.requestCard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'pause' }))
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
    expect(m.authority).not.toHaveBeenCalled()
  })

  it('refuses a direct budget decrease without asking for PM authority or a queue', async () => {
    m.authority.mockResolvedValue({ ok: false, status: 403, error: 'x', code: 'activation_requires_pm' })

    const res = await post({ action_type: 'ads.adjust_bid', campaign_id: CAMP, params: { new_daily_budget: 40 } })

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ code: 'direct_budget_change_closed' })
    expect(m.queueBudget).not.toHaveBeenCalled()
    expect(m.authority).not.toHaveBeenCalled()
    expect(m.getCampaignDetails).not.toHaveBeenCalled()
  })
})

describe('meta-ads/execute POST — hostile request bodies', () => {
  const CAMP = '120210000000000001'

  beforeEach(() => {
    m.getCampaignDetails.mockResolvedValue({
      id: CAMP, name: 'A campaign', status: 'PAUSED', daily_budget: '5000', account_id: '1111111111',
    })
    m.setCampaignStatus.mockResolvedValue(true)
    m.otherTableInsert.mockReturnValue({
      select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'act1' }, error: null }) }),
    })
  })

  it('params: null does not crash (no 500)', async () => {
    const res = await post({ action_type: 'ads.pause_campaign', campaign_id: CAMP, params: null })

    expect(res.status).toBe(202)
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })

  it('execution_item_id that is not a UUID → 400, nothing written', async () => {
    const res = await post({
      action_type: 'ads.reactivate_campaign',
      campaign_id: CAMP,
      params: { execution_item_id: 'not-a-uuid' },
    })

    expect(res.status).toBe(400)
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
    expect(m.otherTableInsert).not.toHaveBeenCalled()
  })

  it('the task drawer and this route no longer offer a direct budget write', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/clients/[id]/meta-ads/execute/route.ts'), 'utf8')
    const drawer = readFileSync(join(process.cwd(), 'src/app/dashboard/clients/[id]/execution/_components/AdsFixDrawer.tsx'), 'utf8')
    const worker = readFileSync(join(process.cwd(), 'src/lib/inngest/functions/ads-campaign-budget.ts'), 'utf8')
    expect(route).not.toContain('queueAdsCampaignBudgetDecrease')
    expect(route).not.toContain('ADS_CAMPAIGN_BUDGET_DECREASE_REQUESTED')
    expect(route).toContain('requestCampaignStatusCard')
    expect(drawer).not.toContain('ads.adjust_bid')
    expect(drawer).not.toContain('调整日预算')
    expect(drawer).not.toContain('new_daily_budget')
    expect(drawer).toContain('ads.pause_campaign')
    expect(worker).not.toContain('runQueuedAdsCampaignBudgetDecrease')
    expect(worker).not.toContain('getCampaignDetails')
    expect(worker).not.toContain('getMetaTokenForClient')
  })

  it('a valid UUID execution_item_id is accepted on reactivate', async () => {
    const res = await post({
      action_type: 'ads.reactivate_campaign',
      campaign_id: CAMP,
      params: { execution_item_id: '11111111-2222-4333-8444-555555555555' },
    })

    expect(res.status).toBe(202)
    expect(m.requestCard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      executionItemId: '11111111-2222-4333-8444-555555555555',
      kind: 'resume',
    }))
    expect(m.setCampaignStatus).not.toHaveBeenCalled()
  })
})
