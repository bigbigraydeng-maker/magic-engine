/**
 * POST /api/clients/[id]/tiktok-ads/execute — unit tests (P18.C.2+3)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockFlywheelInsert = vi.fn()

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  requirePaidClientAccess: vi.fn(),
  getCampaign:                  vi.fn(),
  setCampaignStatus:            vi.fn(),
  setCampaignBudget:            vi.fn(),
  loadTikTokAdsCreds:           vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
  requirePaidClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/tiktok-ads/client', () => ({
  getCampaign:        mocks.getCampaign,
  setCampaignStatus:  mocks.setCampaignStatus,
  setCampaignBudget:  mocks.setCampaignBudget,
  loadTikTokAdsCreds: mocks.loadTikTokAdsCreds,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () => mockFlywheelInsert(),
        }),
      }),
    }),
  },
}))

import { POST } from '../route'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLIENT_ID     = 'client-abc'
const ADVERTISER_ID = '7000000001'
const CAMPAIGN_ID   = 'camp-001'

const CAMPAIGN_DETAILS = {
  campaign_id:    CAMPAIGN_ID,
  campaign_name:  'NZ Summer Sale',
  status:         'ENABLE',
  budget:         100,
  budget_mode:    'BUDGET_MODE_DAY',
  objective_type: 'CONVERSIONS',
  advertiser_id:  ADVERTISER_ID,
  create_time:    '2026-05-01T00:00:00Z',
  modify_time:    '2026-05-28T00:00:00Z',
}

const VALID_CREDS = { accessToken: 'tok-abc', advertiserId: ADVERTISER_ID }

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function makeRequest(body: unknown) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/tiktok-ads/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function routeCtx() {
  return { params: { id: CLIENT_ID } }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/clients/[id]/tiktok-ads/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
    mocks.loadTikTokAdsCreds.mockReturnValue(VALID_CREDS)
    mocks.getCampaign.mockResolvedValue(CAMPAIGN_DETAILS)
    mocks.setCampaignStatus.mockResolvedValue(true)
    mocks.setCampaignBudget.mockResolvedValue(true)
    mockFlywheelInsert.mockResolvedValue({ data: { id: 'action-uuid' }, error: null })
  })

  // ── Auth & validation ─────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })
    const res = await POST(makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID }), routeCtx())
    expect(res.status).toBe(401)
  })

  it('returns 400 when action_type is missing', async () => {
    const res = await POST(makeRequest({ campaign_id: CAMPAIGN_ID }), routeCtx())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('action_type')
  })

  it('returns 400 when campaign_id is missing', async () => {
    const res = await POST(makeRequest({ action_type: 'ads.pause_campaign' }), routeCtx())
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/tiktok-ads/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req, routeCtx())
    expect(res.status).toBe(400)
  })

  it('returns 422 for unsupported action_type', async () => {
    const res = await POST(makeRequest({ action_type: 'ads.unsupported', campaign_id: CAMPAIGN_ID }), routeCtx())
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('Unsupported action_type')
  })

  it('returns 424 when TikTok Ads not configured', async () => {
    mocks.loadTikTokAdsCreds.mockReturnValue(null)
    const res = await POST(makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID }), routeCtx())
    expect(res.status).toBe(424)
    const json = await res.json()
    expect(json.error).toContain('TikTok Ads not configured')
  })

  it('returns 502 when getCampaign returns null', async () => {
    mocks.getCampaign.mockResolvedValue(null)
    const res = await POST(makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID }), routeCtx())
    expect(res.status).toBe(502)
  })

  // ── ads.pause_campaign ────────────────────────────────────────────────────

  it('pauses campaign and returns before/after with status DISABLE', async () => {
    const res = await POST(makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID }), routeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.before.status).toBe('ENABLE')
    expect(json.after.status).toBe('DISABLE')
    expect(mocks.setCampaignStatus).toHaveBeenCalledWith(VALID_CREDS, CAMPAIGN_ID, 'DISABLE')
  })

  it('returns 502 when setCampaignStatus returns false for pause', async () => {
    mocks.setCampaignStatus.mockResolvedValue(false)
    const res = await POST(makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID }), routeCtx())
    expect(res.status).toBe(502)
  })

  // ── ads.reactivate_campaign ───────────────────────────────────────────────

  it('reactivates campaign and returns after status ENABLE', async () => {
    mocks.getCampaign.mockResolvedValue({ ...CAMPAIGN_DETAILS, status: 'DISABLE' })
    const res = await POST(
      makeRequest({ action_type: 'ads.reactivate_campaign', campaign_id: CAMPAIGN_ID }),
      routeCtx()
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.after.status).toBe('ENABLE')
    expect(mocks.setCampaignStatus).toHaveBeenCalledWith(VALID_CREDS, CAMPAIGN_ID, 'ENABLE')
  })

  // ── ads.adjust_bid ────────────────────────────────────────────────────────

  it('adjusts budget within ±20% and returns after budget', async () => {
    const res = await POST(
      makeRequest({
        action_type:  'ads.adjust_bid',
        campaign_id:  CAMPAIGN_ID,
        params:       { new_daily_budget: 110 },
      }),
      routeCtx()
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.after.budget).toBe(110)
    expect(mocks.setCampaignBudget).toHaveBeenCalledWith(VALID_CREDS, CAMPAIGN_ID, 110)
  })

  it('returns 400 when new_daily_budget is missing for adjust_bid', async () => {
    const res = await POST(
      makeRequest({ action_type: 'ads.adjust_bid', campaign_id: CAMPAIGN_ID }),
      routeCtx()
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('new_daily_budget')
  })

  it('returns 422 when budget change exceeds ±20%', async () => {
    const res = await POST(
      makeRequest({
        action_type: 'ads.adjust_bid',
        campaign_id: CAMPAIGN_ID,
        params:      { new_daily_budget: 200 },  // +100%
      }),
      routeCtx()
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('±20%')
    expect(json.minBudget).toBeDefined()
    expect(json.maxBudget).toBeDefined()
  })

  it('returns 422 when campaign uses BUDGET_MODE_INFINITE', async () => {
    mocks.getCampaign.mockResolvedValue({ ...CAMPAIGN_DETAILS, budget_mode: 'BUDGET_MODE_INFINITE' })
    const res = await POST(
      makeRequest({
        action_type: 'ads.adjust_bid',
        campaign_id: CAMPAIGN_ID,
        params:      { new_daily_budget: 110 },
      }),
      routeCtx()
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('BUDGET_MODE_INFINITE')
  })

  // ── flywheel_actions audit log ────────────────────────────────────────────

  it('records flywheel_actions entry on success', async () => {
    const res = await POST(makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID }), routeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.actionId).toBe('action-uuid')
  })

  it('still returns 200 when flywheel_actions insert fails (non-fatal)', async () => {
    mockFlywheelInsert.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID }), routeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.actionId).toBeNull()

    consoleSpy.mockRestore()
  })

  it('passes tiktok_advertiser_id from body to loadTikTokAdsCreds', async () => {
    const res = await POST(
      makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID, tiktok_advertiser_id: '9999' }),
      routeCtx()
    )
    expect(res.status).toBe(200)
    expect(mocks.loadTikTokAdsCreds).toHaveBeenCalledWith('9999')
  })
})
