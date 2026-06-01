/**
 * Tests for GET /api/clients/[id]/google-ads/campaigns — P18.B.1
 *
 * Mocks: requireDashboardClientAccess, loadGoogleAdsCreds, listCampaigns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockRequireAccess = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: (...args: unknown[]) => mockRequireAccess(...args),
}))

// ── Google Ads client mocks ───────────────────────────────────────────────────

const mockLoadCreds   = vi.fn()
const mockListCampaigns = vi.fn()

vi.mock('@/lib/google-ads/client', () => ({
  loadGoogleAdsCreds: (...args: unknown[]) => mockLoadCreds(...args),
  listCampaigns:      (...args: unknown[]) => mockListCampaigns(...args),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLIENT_ID   = 'client-abc'
const CUSTOMER_ID = '1234567890'

const MOCK_CREDS = {
  developerToken: 'dev-token',
  clientId:       'client-id',
  clientSecret:   'client-secret',
  refreshToken:   'refresh-token',
  customerId:     CUSTOMER_ID,
}

const MOCK_CAMPAIGNS = [
  { id: '111', name: 'Campaign A', status: 'ENABLED', campaignBudget: { amountMicros: '5000000', deliveryMethod: 'STANDARD' } },
  { id: '222', name: 'Campaign B', status: 'PAUSED',  campaignBudget: { amountMicros: '3000000', deliveryMethod: 'STANDARD' } },
]

const ROUTE_CTX = { params: { id: CLIENT_ID } }

function makeRequest(customerId?: string, limit?: string) {
  const params = new URLSearchParams()
  if (customerId !== undefined) params.set('google_ads_customer_id', customerId)
  if (limit !== undefined)      params.set('limit', limit)
  return new NextRequest(
    `http://localhost:3001/api/clients/${CLIENT_ID}/google-ads/campaigns?${params.toString()}`,
    { method: 'GET' },
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/google-ads/campaigns — P18.B.1', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAccess.mockResolvedValue({ ok: true })
    mockLoadCreds.mockReturnValue(MOCK_CREDS)
    mockListCampaigns.mockResolvedValue(MOCK_CAMPAIGNS)
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when access check fails', async () => {
    mockRequireAccess.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CUSTOMER_ID), ROUTE_CTX)
    expect(res.status).toBe(401)
  })

  // ── Missing params ────────────────────────────────────────────────────────

  it('returns 400 when google_ads_customer_id is missing', async () => {
    const { GET } = await import('./route')
    const res  = await GET(makeRequest(), ROUTE_CTX)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toContain('google_ads_customer_id')
  })

  // ── Credentials not configured ────────────────────────────────────────────

  it('returns 424 when credentials are not configured', async () => {
    mockLoadCreds.mockReturnValue(null)

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CUSTOMER_ID), ROUTE_CTX)
    const json = await res.json()
    expect(res.status).toBe(424)
    expect(json.error).toContain('GOOGLE_ADS_DEVELOPER_TOKEN')
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 200 with campaign list', async () => {
    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CUSTOMER_ID), ROUTE_CTX)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.campaigns).toHaveLength(2)
    expect(json.campaigns[0].name).toBe('Campaign A')
    expect(json.campaigns[1].status).toBe('PAUSED')
  })

  it('passes customerId to loadGoogleAdsCreds', async () => {
    const { GET } = await import('./route')
    await GET(makeRequest(CUSTOMER_ID), ROUTE_CTX)

    expect(mockLoadCreds).toHaveBeenCalledWith(CUSTOMER_ID)
  })

  it('respects limit param (capped at 100)', async () => {
    const { GET } = await import('./route')
    await GET(makeRequest(CUSTOMER_ID, '50'), ROUTE_CTX)

    const limit = mockListCampaigns.mock.calls[0][1] as number
    expect(limit).toBe(50)
  })

  it('caps limit at 100 when over-large value is provided', async () => {
    const { GET } = await import('./route')
    await GET(makeRequest(CUSTOMER_ID, '999'), ROUTE_CTX)

    const limit = mockListCampaigns.mock.calls[0][1] as number
    expect(limit).toBe(100)
  })

  it('defaults limit to 20 when not provided', async () => {
    const { GET } = await import('./route')
    await GET(makeRequest(CUSTOMER_ID), ROUTE_CTX)

    const limit = mockListCampaigns.mock.calls[0][1] as number
    expect(limit).toBe(20)
  })

  // ── API error ─────────────────────────────────────────────────────────────

  it('returns 502 when listCampaigns throws', async () => {
    mockListCampaigns.mockRejectedValue(new Error('Google OAuth token refresh failed'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CUSTOMER_ID), ROUTE_CTX)
    const json = await res.json()

    expect(res.status).toBe(502)
    expect(json.error).toContain('Google Ads API error')

    consoleSpy.mockRestore()
  })

  it('returns empty array (200) when listCampaigns returns []', async () => {
    mockListCampaigns.mockResolvedValue([])

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CUSTOMER_ID), ROUTE_CTX)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.campaigns).toEqual([])
  })
})
