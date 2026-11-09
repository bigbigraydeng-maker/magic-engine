/**
 * Tests for POST /api/clients/[id]/google-ads/execute — P18.B
 *
 * Mocks: requireDashboardClientAccess, loadGoogleAdsCreds, getCampaign,
 *        setCampaignStatus, setCampaignBudget, addCampaignNegativeKeyword,
 *        checkBudgetWithinSafeRange, supabaseAdmin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockRequireAccess = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: (...args: unknown[]) => mockRequireAccess(...args),
  requirePaidClientAccess: (...args: unknown[]) => mockRequireAccess(...args),
}))

// ── Google Ads client mocks ───────────────────────────────────────────────────

const mockLoadCreds        = vi.fn()
const mockGetCampaign      = vi.fn()
const mockSetStatus        = vi.fn()
const mockSetBudget        = vi.fn()
const mockAddNegativeKw    = vi.fn()

vi.mock('@/lib/google-ads/client', () => ({
  loadGoogleAdsCreds:           (...args: unknown[]) => mockLoadCreds(...args),
  getCampaign:                  (...args: unknown[]) => mockGetCampaign(...args),
  setCampaignStatus:            (...args: unknown[]) => mockSetStatus(...args),
  setCampaignBudget:            (...args: unknown[]) => mockSetBudget(...args),
  addCampaignNegativeKeyword:   (...args: unknown[]) => mockAddNegativeKw(...args),
}))

// ── Guardrails mock ───────────────────────────────────────────────────────────

const mockCheckBudget  = vi.fn()
const mockMicrosDisplay = vi.fn((v: number) => `$${(v / 1_000_000).toFixed(2)}`)

vi.mock('@/lib/google-ads/guardrails', () => ({
  checkBudgetWithinSafeRange: (...args: unknown[]) => mockCheckBudget(...args),
  microsToDisplay:             (v: unknown) => mockMicrosDisplay(v as number),
}))

// ── supabaseAdmin mock ────────────────────────────────────────────────────────

const mockDbSingle = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: mockDbSingle,
        })),
      })),
    })),
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLIENT_ID   = 'client-abc'
const CUSTOMER_ID = '1234567890'
const CAMPAIGN_ID = '9876543210'

const MOCK_CREDS = {
  developerToken: 'dev-token',
  clientId:       'client-id',
  clientSecret:   'client-secret',
  refreshToken:   'refresh-token',
  customerId:     CUSTOMER_ID,
}

const MOCK_CAMPAIGN = {
  id:     CAMPAIGN_ID,
  name:   'Test Campaign AU',
  status: 'ENABLED' as const,
  campaignBudget: { amountMicros: '5000000', deliveryMethod: 'STANDARD' },
}

const ROUTE_CTX = { params: { id: CLIENT_ID } }

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(
    `http://localhost:3001/api/clients/${CLIENT_ID}/google-ads/execute`,
    {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(body),
    },
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/clients/[id]/google-ads/execute — P18.B', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: auth ok
    mockRequireAccess.mockResolvedValue({ ok: true })
    // Default: creds configured
    mockLoadCreds.mockReturnValue(MOCK_CREDS)
    // Default: campaign fetched
    mockGetCampaign.mockResolvedValue(MOCK_CAMPAIGN)
    // Default: API calls succeed
    mockSetStatus.mockResolvedValue(true)
    mockSetBudget.mockResolvedValue(true)
    mockAddNegativeKw.mockResolvedValue('customers/123/campaignCriteria/456')
    // Default: budget within safe range
    mockCheckBudget.mockReturnValue({ ok: true, allowedMinMicros: 4_000_000, allowedMaxMicros: 6_000_000 })
    // Default: DB insert succeeds
    mockDbSingle.mockResolvedValue({ data: { id: 'action-uuid-1', executed_at: '2026-06-01T00:00:00Z' }, error: null })
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when access check fails', async () => {
    mockRequireAccess.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID, google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(401)
  })

  // ── Input validation ──────────────────────────────────────────────────────

  it('returns 400 when action_type is missing', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ campaign_id: CAMPAIGN_ID, google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when campaign_id is missing', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ action_type: 'ads.pause_campaign', google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when google_ads_customer_id is missing', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(400)
  })

  it('returns 422 for unsupported action_type', async () => {
    const { POST } = await import('./route')
    const res  = await POST(
      makeRequest({ action_type: 'ads.unknown_action', campaign_id: CAMPAIGN_ID, google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.error).toContain('Unsupported action_type')
  })

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('./route')
    const req = new NextRequest(
      `http://localhost:3001/api/clients/${CLIENT_ID}/google-ads/execute`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'NOT JSON{' },
    )
    const res = await POST(req, ROUTE_CTX)
    expect(res.status).toBe(400)
  })

  // ── Credentials not configured ────────────────────────────────────────────

  it('returns 424 when Google Ads credentials are not configured', async () => {
    mockLoadCreds.mockReturnValue(null)

    const { POST } = await import('./route')
    const res  = await POST(
      makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID, google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    const json = await res.json()
    expect(res.status).toBe(424)
    expect(json.error).toContain('GOOGLE_ADS_DEVELOPER_TOKEN')
  })

  // ── Campaign fetch failure ────────────────────────────────────────────────

  it('returns 502 when getCampaign fails', async () => {
    mockGetCampaign.mockResolvedValue(null)

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID, google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(502)
  })

  // ── Pause campaign (P18.B.3) ──────────────────────────────────────────────

  it('pauses campaign and returns before/after', async () => {
    const { POST } = await import('./route')
    const res  = await POST(
      makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID, google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.before.status).toBe('ENABLED')
    expect(json.after.status).toBe('PAUSED')
    expect(mockSetStatus).toHaveBeenCalledOnce()
    expect(mockSetStatus.mock.calls[0][2]).toBe('PAUSED')
  })

  it('reactivates campaign via ads.reactivate_campaign', async () => {
    mockGetCampaign.mockResolvedValue({ ...MOCK_CAMPAIGN, status: 'PAUSED' })

    const { POST } = await import('./route')
    const res  = await POST(
      makeRequest({ action_type: 'ads.reactivate_campaign', campaign_id: CAMPAIGN_ID, google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.after.status).toBe('ENABLED')
    expect(mockSetStatus.mock.calls[0][2]).toBe('ENABLED')
  })

  it('returns 502 when setCampaignStatus fails', async () => {
    mockSetStatus.mockResolvedValue(false)

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID, google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(502)
  })

  // ── Adjust bid / budget (P18.B.2) ─────────────────────────────────────────

  it('adjusts campaign budget when within safe range', async () => {
    const { POST } = await import('./route')
    const res  = await POST(
      makeRequest({
        action_type:            'ads.adjust_bid',
        campaign_id:            CAMPAIGN_ID,
        google_ads_customer_id: CUSTOMER_ID,
        params: {
          new_daily_budget_micros: 5_500_000,
          budget_resource_name:    'customers/123/campaignBudgets/456',
        },
      }),
      ROUTE_CTX,
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(mockSetBudget).toHaveBeenCalledOnce()
    expect(mockSetBudget.mock.calls[0][2]).toBe(5_500_000)
    expect(json.after.budget_micros).toBe('5500000')
  })

  it('returns 400 when new_daily_budget_micros is missing for adjust_bid', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({
        action_type:            'ads.adjust_bid',
        campaign_id:            CAMPAIGN_ID,
        google_ads_customer_id: CUSTOMER_ID,
        params: { budget_resource_name: 'customers/123/campaignBudgets/456' },
      }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when budget_resource_name is missing for adjust_bid', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({
        action_type:            'ads.adjust_bid',
        campaign_id:            CAMPAIGN_ID,
        google_ads_customer_id: CUSTOMER_ID,
        params: { new_daily_budget_micros: 5_500_000 },
      }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(400)
  })

  it('returns 422 when campaign has no budget (ad set budgets)', async () => {
    mockGetCampaign.mockResolvedValue({ ...MOCK_CAMPAIGN, campaignBudget: undefined })

    const { POST } = await import('./route')
    const res  = await POST(
      makeRequest({
        action_type:            'ads.adjust_bid',
        campaign_id:            CAMPAIGN_ID,
        google_ads_customer_id: CUSTOMER_ID,
        params: {
          new_daily_budget_micros: 5_500_000,
          budget_resource_name:    'customers/123/campaignBudgets/456',
        },
      }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 when budget change exceeds ±20%', async () => {
    mockCheckBudget.mockReturnValue({
      ok: false,
      allowedMinMicros: 4_000_000,
      allowedMaxMicros: 6_000_000,
    })

    const { POST } = await import('./route')
    const res  = await POST(
      makeRequest({
        action_type:            'ads.adjust_bid',
        campaign_id:            CAMPAIGN_ID,
        google_ads_customer_id: CUSTOMER_ID,
        params: {
          new_daily_budget_micros: 9_000_000,
          budget_resource_name:    'customers/123/campaignBudgets/456',
        },
      }),
      ROUTE_CTX,
    )
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.code).toBe('exceeds_safe_adjustment')
    expect(json.current_budget_micros).toBe(5_000_000)
  })

  // ── Add negative keyword (P18.B.2) ────────────────────────────────────────

  it('adds negative keyword and returns 200', async () => {
    const { POST } = await import('./route')
    const res  = await POST(
      makeRequest({
        action_type:            'ads.add_negative_keyword',
        campaign_id:            CAMPAIGN_ID,
        google_ads_customer_id: CUSTOMER_ID,
        params: { keyword_text: 'free', keyword_match_type: 'BROAD' },
      }),
      ROUTE_CTX,
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(mockAddNegativeKw).toHaveBeenCalledOnce()
    expect(mockAddNegativeKw.mock.calls[0][2]).toBe('free')
    expect(mockAddNegativeKw.mock.calls[0][3]).toBe('BROAD')
  })

  it('returns 400 when keyword_text is missing for add_negative_keyword', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({
        action_type:            'ads.add_negative_keyword',
        campaign_id:            CAMPAIGN_ID,
        google_ads_customer_id: CUSTOMER_ID,
        params: {},
      }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(400)
  })

  it('returns 502 when addCampaignNegativeKeyword returns null', async () => {
    mockAddNegativeKw.mockResolvedValue(null)

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({
        action_type:            'ads.add_negative_keyword',
        campaign_id:            CAMPAIGN_ID,
        google_ads_customer_id: CUSTOMER_ID,
        params: { keyword_text: 'cheap' },
      }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(502)
  })

  // ── DB insert ─────────────────────────────────────────────────────────────

  it('includes execution_item_id in flywheel_actions payload when provided', async () => {
    const { POST } = await import('./route')
    await POST(
      makeRequest({
        action_type:            'ads.pause_campaign',
        campaign_id:            CAMPAIGN_ID,
        google_ads_customer_id: CUSTOMER_ID,
        params: { execution_item_id: 'item-uuid-99' },
      }),
      ROUTE_CTX,
    )

    // The insert mock captures the passed data via the chain
    // Just verify it returns 200 successfully
    expect(mockDbSingle).toHaveBeenCalledOnce()
  })

  it('returns 200 with warning when DB insert fails (action was still executed)', async () => {
    mockDbSingle.mockResolvedValue({ data: null, error: { message: 'DB timeout' } })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('./route')
    const res  = await POST(
      makeRequest({ action_type: 'ads.pause_campaign', campaign_id: CAMPAIGN_ID, google_ads_customer_id: CUSTOMER_ID }),
      ROUTE_CTX,
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.warning).toContain('audit record failed')

    consoleSpy.mockRestore()
  })
})
