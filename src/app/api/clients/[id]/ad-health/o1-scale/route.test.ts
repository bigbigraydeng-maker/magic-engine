import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  query: vi.fn(),
  submit: vi.fn(),
  listAdSets: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => m.query(table) },
}))
vi.mock('@/lib/kernel', () => ({ createKernel: vi.fn(() => ({ kernel: true })) }))
vi.mock('@/lib/meta/adsets', () => ({ listAdSetsInCampaign: m.listAdSets }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn().mockResolvedValue('meta-token') }))
vi.mock('@/lib/action-submission/ads-o1-budget-scale', () => ({
  ADS_O1_BUDGET_SCALE_ACTION_KEY: 'ads.scale_unit_budget',
  requireAdsO1BudgetScaleAccess: vi.fn().mockResolvedValue({
    ok: true, tier: 'admin', allowedClientId: null, user: { id: 'staff-1', email: 'staff@example.com' },
  }),
  submitAdsO1BudgetScale: m.submit,
}))

import { POST } from './route'

const CLIENT_ID = 'aaaaaaaa-0000-0000-0000-000000000000'
const ADSET_ID = '120000000000001'
const CAMPAIGN_ID = '120000000000002'
const ACCOUNT_ID = 'act_1111111111'

function query(data: unknown) {
  const q: Record<string, unknown> = {}
  let from = 0
  let to = Number.MAX_SAFE_INTEGER
  for (const method of ['select', 'eq', 'order', 'limit', 'lte', 'or', 'range']) {
    q[method] = vi.fn(() => q)
  }
  q.range = vi.fn((start: number, end: number) => { from = start; to = end; return q })
  q.maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  // The sibling-adset lookup awaits the builder directly; other row lookups call maybeSingle.
  q.then = (resolve: (value: unknown) => unknown) => resolve({ data: Array.isArray(data) ? data.slice(from, to + 1) : [], error: null })
  return q
}

function post() {
  return POST(new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/ad-health/o1-scale`, {
    method: 'POST', body: JSON.stringify({ adset_id: ADSET_ID }),
  }), { params: { id: CLIENT_ID } })
}

function setup(
  siblings: Array<{ entity_id: string; effective_status: string | null }> = [{ entity_id: ADSET_ID, effective_status: 'ACTIVE' }],
) {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const state = {
    date: today,
    updated_at: now.toISOString(),
    data_completeness: 'complete',
    payload: { opportunities: [{ code: 'O1', status: 'hit', units: [{ id: ADSET_ID, adAccountId: ACCOUNT_ID }], evidence: { signal: 'positive' } }] },
  }
  const adset = {
    ad_account_id: ACCOUNT_ID, daily_budget_minor: null, budget_level: null,
    effective_status: 'ACTIVE', currency: 'USD', campaign_id: CAMPAIGN_ID, captured_at: now.toISOString(),
  }
  const campaign = {
    ad_account_id: ACCOUNT_ID, daily_budget_minor: 5000, budget_level: 'cbo',
    effective_status: 'ACTIVE', currency: 'USD', captured_at: adset.captured_at,
  }
  const rows = new Map<string, unknown[]>([
    ['ads_growth_states', [state]],
    ['ad_entity_snapshots', [adset, campaign]],
    ['goals', [{ id: 'goal-1' }]],
    ['client_automation_policies', [{ id: 'policy-1' }]],
  ])
  m.query.mockImplementation((table: string) => {
    const values = rows.get(table) ?? []
    const data = values.shift()
    return query(data ?? null)
  })
  m.listAdSets.mockResolvedValue(siblings.map(row => ({
    id: row.entity_id,
    name: row.entity_id,
    status: row.effective_status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
    effective_status: row.effective_status,
    account_id: ACCOUNT_ID.replace(/^act_/, ''),
  })))
}

beforeEach(() => {
  vi.clearAllMocks()
  setup()
  m.listAdSets.mockResolvedValue([{ id: ADSET_ID, name: 'Source', status: 'ACTIVE', effective_status: 'ACTIVE', account_id: '1111111111' }])
  m.submit.mockResolvedValue({ kind: 'pending_approval', run: { id: 'run-1', authorization_decision_id: 'decision-1' } })
})

describe('O1 campaign-budget proposal', () => {
  it('turns a $50/day campaign budget into a $60/day approval proposal', async () => {
    const response = await post()

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(202)
    expect(await response.json()).toMatchObject({ ok: true, beforeCents: 5000, afterCents: 6000 })
    expect(m.submit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clientId: CLIENT_ID, goalId: 'goal-1', adAccountId: ACCOUNT_ID, adsetId: ADSET_ID,
      campaignId: CAMPAIGN_ID, beforeCents: 5000, afterCents: 6000,
      evidence: expect.objectContaining({ currency: 'USD', target_level: 'campaign' }),
    }))
  })

  it('refuses to raise the whole campaign budget when another child ad set is delivering', async () => {
    setup([
      { entity_id: ADSET_ID, effective_status: 'ACTIVE' },
      { entity_id: '120000000000003', effective_status: 'ACTIVE' },
    ])

    const response = await post()

    expect(response.status).toBe(409)
    expect(m.submit).not.toHaveBeenCalled()
  })

  it('refuses when Meta cannot return a complete child list', async () => {
    m.listAdSets.mockResolvedValue(null)

    const response = await post()

    expect(response.status).toBe(409)
    expect(m.submit).not.toHaveBeenCalled()
  })

  it('finds a delivering child beyond the first 1000 rows', async () => {
    const siblings = [
      { entity_id: ADSET_ID, effective_status: 'ACTIVE' },
      ...Array.from({ length: 999 }, (_, index) => ({ entity_id: `paused-${index}`, effective_status: 'PAUSED' })),
      { entity_id: '120000000000003', effective_status: 'ACTIVE' },
    ]
    m.listAdSets.mockResolvedValue(siblings.map(row => ({
      id: row.entity_id, name: row.entity_id,
      status: row.effective_status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      effective_status: row.effective_status, account_id: '1111111111',
    })))

    const response = await post()

    expect(response.status).toBe(409)
    expect(m.submit).not.toHaveBeenCalled()
  })

  it('refuses if any child ad-set delivery status is unknown', async () => {
    m.listAdSets.mockResolvedValue([
      { id: ADSET_ID, name: 'Source', status: 'ACTIVE', effective_status: 'ACTIVE', account_id: '1111111111' },
      { id: '120000000000003', name: 'Unknown', status: 'ACTIVE', effective_status: null, account_id: '1111111111' },
    ])

    const response = await post()

    expect(response.status).toBe(409)
    expect(m.submit).not.toHaveBeenCalled()
  })
})
