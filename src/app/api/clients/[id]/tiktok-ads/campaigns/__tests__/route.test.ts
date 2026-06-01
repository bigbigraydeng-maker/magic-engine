/**
 * GET /api/clients/[id]/tiktok-ads/campaigns — unit tests (P18.C.1)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  listCampaigns:                vi.fn(),
  loadTikTokAdsCreds:           vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/tiktok-ads/client', () => ({
  listCampaigns:      mocks.listCampaigns,
  loadTikTokAdsCreds: mocks.loadTikTokAdsCreds,
}))

import { GET } from '../route'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLIENT_ID     = 'client-abc'
const ADVERTISER_ID = '7000000001'

const CAMPAIGNS = [
  {
    campaign_id:    'camp-001',
    campaign_name:  'NZ Summer Sale',
    status:         'ENABLE',
    budget:         100,
    budget_mode:    'BUDGET_MODE_DAY',
    objective_type: 'CONVERSIONS',
    create_time:    '2026-05-01T00:00:00Z',
    modify_time:    '2026-05-28T00:00:00Z',
  },
]

const VALID_CREDS = { accessToken: 'tok-abc', advertiserId: ADVERTISER_ID }

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL(`http://localhost:3001/api/clients/${CLIENT_ID}/tiktok-ads/campaigns`)
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function routeCtx() {
  return { params: { id: CLIENT_ID } }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/tiktok-ads/campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
    mocks.loadTikTokAdsCreds.mockReturnValue(VALID_CREDS)
    mocks.listCampaigns.mockResolvedValue(CAMPAIGNS)
  })

  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })
    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(401)
  })

  it('returns 424 when TikTok Ads not configured', async () => {
    mocks.loadTikTokAdsCreds.mockReturnValue(null)
    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(424)
    const json = await res.json()
    expect(json.error).toContain('TikTok Ads not configured')
  })

  it('returns campaigns list on success', async () => {
    const res = await GET(makeRequest({ tiktok_advertiser_id: ADVERTISER_ID }), routeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.campaigns).toHaveLength(1)
    expect(json.campaigns[0].campaign_id).toBe('camp-001')
  })

  it('passes tiktok_advertiser_id to loadTikTokAdsCreds', async () => {
    await GET(makeRequest({ tiktok_advertiser_id: ADVERTISER_ID }), routeCtx())
    expect(mocks.loadTikTokAdsCreds).toHaveBeenCalledWith(ADVERTISER_ID)
  })

  it('passes undefined advertiser_id when not in query params', async () => {
    await GET(makeRequest(), routeCtx())
    expect(mocks.loadTikTokAdsCreds).toHaveBeenCalledWith(undefined)
  })

  it('passes limit to listCampaigns (default 20)', async () => {
    await GET(makeRequest(), routeCtx())
    expect(mocks.listCampaigns).toHaveBeenCalledWith(VALID_CREDS, 20)
  })

  it('passes custom limit to listCampaigns', async () => {
    await GET(makeRequest({ limit: '50' }), routeCtx())
    expect(mocks.listCampaigns).toHaveBeenCalledWith(VALID_CREDS, 50)
  })

  it('clamps limit to 100', async () => {
    await GET(makeRequest({ limit: '999' }), routeCtx())
    expect(mocks.listCampaigns).toHaveBeenCalledWith(VALID_CREDS, 100)
  })

  it('returns 502 when listCampaigns throws', async () => {
    mocks.listCampaigns.mockRejectedValue(new Error('TikTok Ads API error: 503'))
    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toContain('TikTok Marketing API call failed')
  })

  it('returns empty campaigns array when listCampaigns returns []', async () => {
    mocks.listCampaigns.mockResolvedValue([])
    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.campaigns).toEqual([])
  })
})
