/**
 * MetaAdsAdapter unit tests — P12.B.2
 *
 * Mocks supabaseAdmin so no real DB calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ADS_ACTION_TYPE, ADS_METRIC_KEY } from '../../vocabulary'
import { clearRegistry } from '../registry'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

const mockMetricsInsert = vi.fn().mockResolvedValue({ error: null })

const mockSingle = vi.fn()
const mockActionSelect = vi.fn(() => ({ single: mockSingle }))
const mockActionInsert = vi.fn(() => ({ select: mockActionSelect }))

// meta_ads_snapshots chain: .select().eq().order().limit().maybeSingle()
const mockSnapshotMaybeSingle = vi.fn()
const mockSnapshotLimit = vi.fn(() => ({ maybeSingle: mockSnapshotMaybeSingle }))
const mockSnapshotOrder = vi.fn(() => ({ limit: mockSnapshotLimit }))
const mockSnapshotGte = vi.fn(() => ({
  order: mockSnapshotOrder,
  maybeSingle: mockSnapshotMaybeSingle,
}))
const mockSnapshotEq = vi.fn(() => ({
  order: mockSnapshotOrder,
  gte: mockSnapshotGte,
}))
const mockSnapshotSelect = vi.fn(() => ({ eq: mockSnapshotEq }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'flywheel_actions') return { insert: mockActionInsert }
      if (table === 'flywheel_metrics') return { insert: mockMetricsInsert }
      if (table === 'meta_ads_snapshots') return { select: mockSnapshotSelect }
      return {}
    }),
  },
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MetaAdsAdapter', () => {
  beforeEach(async () => {
    clearRegistry()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('has flywheel = "ads"', async () => {
    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()
    expect(adapter.flywheel).toBe('ads')
  })

  it('auto-registers itself to the registry on import', async () => {
    clearRegistry()
    await import('../MetaAdsAdapter')
    const { hasAdapter } = await import('../registry')
    expect(hasAdapter('ads')).toBe(true)
  })

  it('throws when actionType is not a valid Ads action', async () => {
    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()
    await expect(
      adapter.execute({
        clientId: 'client-1',
        actionType: 'geo.deploy_directive',
        executionMode: 'third_party',
      })
    ).rejects.toThrow('Unknown Ads action_type')
  })

  it('REFUSES to write an action whose expected_metric nobody pulls', async () => {
    // The gate must live inside the adapter, not only in the registry module —
    // a validator no writer calls is exactly how 24 ads actions were written
    // against a metric that was never collected.
    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()

    await expect(
      adapter.execute({
        clientId: 'client-1',
        actionType: ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
        executionMode: 'third_party',
        expectedMetric: 'ads.account.cost_per_click_maybe',
      })
    ).rejects.toThrow(/refusing to write flywheel_action/)

    // and the row must not have been inserted
    expect(mockActionInsert).not.toHaveBeenCalled()
  })

  it('accepts an expected_metric that a puller is registered for', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'a1', client_id: 'c1', flywheel: 'ads',
        action_type: ADS_ACTION_TYPE.PAUSE_CAMPAIGN, execution_mode: 'third_party',
        expected_metric: ADS_METRIC_KEY.COST_PER_CONVERSATION, executed_at: new Date().toISOString(),
      },
      error: null,
    })
    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const result = await new MetaAdsAdapter().execute({
      clientId: 'c1',
      actionType: ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
      executionMode: 'third_party',
      expectedMetric: ADS_METRIC_KEY.COST_PER_CONVERSATION,
    })
    expect(result.expectedMetric).toBe(ADS_METRIC_KEY.COST_PER_CONVERSATION)
  })

  it('inserts a flywheel_actions row and returns FlywheelActionRow', async () => {
    const now = new Date().toISOString()
    const dbRow = {
      id: 'action-uuid',
      client_id: 'client-cts',
      execution_item_id: null,
      flywheel: 'ads',
      action_type: ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
      execution_mode: 'third_party',
      vendor: 'meta',
      payload: { campaign_id: '123456' },
      expected_metric: ADS_METRIC_KEY.ROAS,
      expected_delta: 0.5,
      executed_at: now,
    }
    mockSingle.mockResolvedValueOnce({ data: dbRow, error: null })

    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()
    const result = await adapter.execute({
      clientId: 'client-cts',
      actionType: ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
      executionMode: 'third_party',
      vendor: 'meta',
      payload: { campaign_id: '123456' },
      expectedMetric: ADS_METRIC_KEY.ROAS,
      expectedDelta: 0.5,
    })

    expect(result.flywheel).toBe('ads')
    expect(result.actionType).toBe(ADS_ACTION_TYPE.PAUSE_CAMPAIGN)
    expect(result.vendor).toBe('meta')
    expect(result.expectedMetric).toBe(ADS_METRIC_KEY.ROAS)
  })

  it('throws on DB error during execute', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'constraint violation' } })

    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()
    await expect(
      adapter.execute({
        clientId: 'client-1',
        actionType: ADS_ACTION_TYPE.ADJUST_BID,
        executionMode: 'third_party',
      })
    ).rejects.toThrow('constraint violation')
  })

  it('pullMetrics returns empty array when no snapshot exists', async () => {
    mockSnapshotMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()
    const result = await adapter.pullMetrics('client-no-meta')
    expect(result).toEqual([])
  })

  it('pullMetrics writes 7 metric rows when all fields are present', async () => {
    const snapshot = {
      id: 'snap-uuid',
      client_id: 'client-cts',
      ad_account_id: 'act_111222333',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      roas: 3.2,
      spend: 1500.0,
      impressions: 80000,
      clicks: 2400,
      cpc: 0.625,
      ctr: 0.03,
      conversions: 48,
    }
    mockSnapshotMaybeSingle.mockResolvedValueOnce({ data: snapshot, error: null })

    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()
    const result = await adapter.pullMetrics('client-cts')

    expect(result).toHaveLength(7)
    const keys = result.map(r => r.metricKey)
    expect(keys).toContain(ADS_METRIC_KEY.ROAS)
    expect(keys).toContain(ADS_METRIC_KEY.SPEND)
    expect(keys).toContain(ADS_METRIC_KEY.IMPRESSIONS)
    expect(keys).toContain(ADS_METRIC_KEY.CLICKS)
    expect(keys).toContain(ADS_METRIC_KEY.CPC)
    expect(keys).toContain(ADS_METRIC_KEY.CTR)
    expect(keys).toContain(ADS_METRIC_KEY.CONVERSIONS)
  })

  it('pullMetrics skips null metric fields', async () => {
    const snapshot = {
      id: 'snap-uuid',
      client_id: 'client-cts',
      ad_account_id: 'act_111222333',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      roas: null,        // no conversion tracking
      spend: 900.0,
      impressions: 50000,
      clicks: 1500,
      cpc: 0.6,
      ctr: 0.03,
      conversions: null, // no conversion tracking
    }
    mockSnapshotMaybeSingle.mockResolvedValueOnce({ data: snapshot, error: null })

    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()
    const result = await adapter.pullMetrics('client-cts')

    expect(result).toHaveLength(5)
    const keys = result.map(r => r.metricKey)
    expect(keys).not.toContain(ADS_METRIC_KEY.ROAS)
    expect(keys).not.toContain(ADS_METRIC_KEY.CONVERSIONS)
    expect(keys).toContain(ADS_METRIC_KEY.SPEND)
  })

  it('pullMetrics metric values match snapshot data', async () => {
    const snapshot = {
      id: 'snap-uuid',
      client_id: 'client-cts',
      ad_account_id: 'act_111222333',
      period_start: '2026-05-01',
      period_end: '2026-05-15',
      roas: 4.1,
      spend: 750.0,
      impressions: 30000,
      clicks: 900,
      cpc: 0.833,
      ctr: 0.03,
      conversions: 22,
    }
    mockSnapshotMaybeSingle.mockResolvedValueOnce({ data: snapshot, error: null })

    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()
    const result = await adapter.pullMetrics('client-cts')

    const roasRow = result.find(r => r.metricKey === ADS_METRIC_KEY.ROAS)
    expect(roasRow?.metricValue).toBe(4.1)

    const spendRow = result.find(r => r.metricKey === ADS_METRIC_KEY.SPEND)
    expect(spendRow?.metricValue).toBe(750.0)

    expect(result.every(r => r.flywheel === 'ads')).toBe(true)
    expect(result.every(r => r.source === 'meta_ads')).toBe(true)
  })

  it('pullMetrics returns empty array when DB error occurs', async () => {
    mockSnapshotMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused' },
    })

    const { MetaAdsAdapter } = await import('../MetaAdsAdapter')
    const adapter = new MetaAdsAdapter()
    const result = await adapter.pullMetrics('client-cts')
    expect(result).toEqual([])
  })
})
