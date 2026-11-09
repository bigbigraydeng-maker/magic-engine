/**
 * CompetitorSnapshotAdapter unit tests — P22.A.4
 *
 * Mocks supabaseAdmin and getBulkTrafficEstimation so no real DB / API calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { COMPETITOR_METRIC_KEY } from '../../vocabulary'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

const mockInsertResult = vi.fn().mockResolvedValue({ error: null })

const mockClientMaybeSingle = vi.fn()
const mockClientEq           = vi.fn(() => ({ maybeSingle: mockClientMaybeSingle }))
const mockClientSelect       = vi.fn(() => ({ eq: mockClientEq }))

// Brief query chain: select → eq → or → order → limit → maybeSingle (always empty in these tests)
const mockBriefMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
const mockBriefLimit       = vi.fn(() => ({ maybeSingle: mockBriefMaybeSingle }))
const mockBriefOrder       = vi.fn(() => ({ limit: mockBriefLimit }))
const mockBriefOr          = vi.fn(() => ({ order: mockBriefOrder }))
const mockBriefEq          = vi.fn(() => ({ or: mockBriefOr }))
const mockBriefSelect      = vi.fn(() => ({ eq: mockBriefEq }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'clients')          return { select: mockClientSelect }
      if (table === 'master_briefs')    return { select: mockBriefSelect }
      if (table === 'flywheel_metrics') return { insert: mockInsertResult }
      return {}
    }),
  },
}))

// ── Mock getBulkTrafficEstimation ─────────────────────────────────────────────

const mockGetBulkTraffic = vi.fn()

vi.mock('@/lib/dataforseo/labs', () => ({
  getBulkTrafficEstimation: (...args: unknown[]) => mockGetBulkTraffic(...args),
}))

// ── Import adapter after mocks ────────────────────────────────────────────────

import { CompetitorSnapshotAdapter } from '../CompetitorSnapshotAdapter'

// ─────────────────────────────────────────────────────────────────────────────

describe('CompetitorSnapshotAdapter.pullMetrics()', () => {
  const CLIENT_ID = 'client-uuid-001'

  beforeEach(() => {
    vi.clearAllMocks()
    mockInsertResult.mockResolvedValue({ error: null })
  })

  it('returns [] when client has no competitor_domains', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: { competitor_domains: null }, error: null })

    const adapter = new CompetitorSnapshotAdapter()
    const result = await adapter.pullMetrics(CLIENT_ID)

    expect(result).toEqual([])
    expect(mockGetBulkTraffic).not.toHaveBeenCalled()
  })

  it('returns [] when competitor_domains is an empty array', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: { competitor_domains: [] }, error: null })

    const adapter = new CompetitorSnapshotAdapter()
    const result = await adapter.pullMetrics(CLIENT_ID)

    expect(result).toEqual([])
    expect(mockGetBulkTraffic).not.toHaveBeenCalled()
  })

  it('calls getBulkTrafficEstimation with competitor domains', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['rival.com.au', 'competitor.nz'] },
      error: null,
    })
    mockGetBulkTraffic.mockResolvedValue([
      { domain: 'rival.com.au',    monthly_traffic: 12000 },
      { domain: 'competitor.nz',   monthly_traffic: 4500  },
    ])

    const adapter = new CompetitorSnapshotAdapter()
    await adapter.pullMetrics(CLIENT_ID)

    expect(mockGetBulkTraffic).toHaveBeenCalledWith(['rival.com.au', 'competitor.nz'])
  })

  it('writes one flywheel_metrics row per competitor domain', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['rival.com.au', 'competitor.nz'] },
      error: null,
    })
    mockGetBulkTraffic.mockResolvedValue([
      { domain: 'rival.com.au',    monthly_traffic: 12000 },
      { domain: 'competitor.nz',   monthly_traffic: 4500  },
    ])

    const adapter = new CompetitorSnapshotAdapter()
    const rows = await adapter.pullMetrics(CLIENT_ID)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      clientId:   CLIENT_ID,
      flywheel:   'seo',   // 竞品归 seo 轮：flywheel_name 枚举里没有 'competitor'
      metricKey:  COMPETITOR_METRIC_KEY.ORGANIC_TRAFFIC,
      metricValue: 12000,
      source:     'dataforseo',
      sourceRef:  { domain: 'rival.com.au' },
    })
    expect(rows[1]).toMatchObject({
      metricValue: 4500,
      sourceRef:   { domain: 'competitor.nz' },
    })
  })

  it('skips domains where monthly_traffic is null', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['no-data.com', 'has-data.com.au'] },
      error: null,
    })
    mockGetBulkTraffic.mockResolvedValue([
      { domain: 'no-data.com',      monthly_traffic: null  },
      { domain: 'has-data.com.au',  monthly_traffic: 8000  },
    ])

    const adapter = new CompetitorSnapshotAdapter()
    const rows = await adapter.pullMetrics(CLIENT_ID)

    expect(rows).toHaveLength(1)
    expect(rows[0].sourceRef).toEqual({ domain: 'has-data.com.au' })
  })

  it('returns [] and logs error when DataForSEO call throws', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['rival.com.au'] },
      error: null,
    })
    mockGetBulkTraffic.mockRejectedValue(new Error('DataForSEO timeout'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const adapter = new CompetitorSnapshotAdapter()
    const rows = await adapter.pullMetrics(CLIENT_ID)

    expect(rows).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      '[CompetitorSnapshotAdapter] DataForSEO error:',
      'DataForSEO timeout',
    )

    consoleSpy.mockRestore()
  })

  it('logs insert error but still returns rows', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['rival.com.au'] },
      error: null,
    })
    mockGetBulkTraffic.mockResolvedValue([
      { domain: 'rival.com.au', monthly_traffic: 5000 },
    ])
    mockInsertResult.mockResolvedValue({ error: { message: 'DB constraint violation' } })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const adapter = new CompetitorSnapshotAdapter()
    const rows = await adapter.pullMetrics(CLIENT_ID)

    expect(rows).toHaveLength(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[CompetitorSnapshotAdapter] insert error:',
      'DB constraint violation',
    )

    consoleSpy.mockRestore()
  })
})
