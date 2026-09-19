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
      body: JSON.stringify(body),
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
  // Client A only ever registered its own account.
  m.registeredAccounts.mockResolvedValue({ data: [{ ad_account_id: 'act_1111111111' }], error: null })
})

describe('stop-loss POST — campaign belonging to another client', () => {
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
})
