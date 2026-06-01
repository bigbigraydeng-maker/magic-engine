/**
 * Ga4Adapter unit tests — P22.A.2
 *
 * Mocks supabaseAdmin so no real DB calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SEO_METRIC_KEY } from '../../vocabulary'
import { clearRegistry } from '../registry'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

const mockMetricsUpsert = vi.fn().mockResolvedValue({ error: null })

// ga4_traffic_snapshots chain:
//   no since:   .select().eq().order().limit(1).maybeSingle()
//   with since: .select().eq().order().gte().limit(1).maybeSingle()
const mockSnapshotMaybeSingle = vi.fn()
const mockSnapshotLimit = vi.fn(() => ({ maybeSingle: mockSnapshotMaybeSingle }))
const mockSnapshotGte   = vi.fn(() => ({ limit: mockSnapshotLimit }))
const mockSnapshotOrder = vi.fn(() => ({
  limit: mockSnapshotLimit,
  gte:   mockSnapshotGte,
}))
const mockSnapshotEq = vi.fn(() => ({ order: mockSnapshotOrder }))
const mockSnapshotSelect = vi.fn(() => ({ eq: mockSnapshotEq }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'flywheel_metrics')       return { upsert: mockMetricsUpsert }
      if (table === 'ga4_traffic_snapshots')  return { select: mockSnapshotSelect }
      return {}
    }),
  },
}))

// ── Fixture data ──────────────────────────────────────────────────────────────

const SNAPSHOT_ROW = {
  id:                   'snap-uuid-1',
  client_id:            'client-abc',
  property_id:          '123456789',
  period_start:         '2026-05-01',
  period_end:           '2026-05-28',
  total_sessions:       4200,
  total_users:          3100,
  total_new_users:      1800,
  total_pageviews:      9800,
  avg_session_duration: 185.5,
  bounce_rate:          0.42,
  top_pages:            [],
  top_sources:          [],
  synced_at:            '2026-06-01T03:00:00Z',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Ga4Adapter', () => {
  beforeEach(async () => {
    clearRegistry()
    vi.clearAllMocks()
    vi.resetModules()
  })

  // ── Identity ────────────────────────────────────────────────────────────────

  it('has flywheel = "seo"', async () => {
    const { Ga4Adapter } = await import('../Ga4Adapter')
    const adapter = new Ga4Adapter()
    expect(adapter.flywheel).toBe('seo')
  })

  it('auto-registers itself to the registry on import', async () => {
    clearRegistry()
    await import('../Ga4Adapter')
    const { hasAdapter } = await import('../registry')
    expect(hasAdapter('seo')).toBe(true)
  })

  it('execute() throws — GA4 is read-only analytics data', async () => {
    const { Ga4Adapter } = await import('../Ga4Adapter')
    const adapter = new Ga4Adapter()
    await expect(
      adapter.execute({ clientId: 'client-1', actionType: 'seo.publish_blog', executionMode: 'in_house' })
    ).rejects.toThrow('does not support execute()')
  })

  // ── pullMetrics happy path ────────────────────────────────────────────────

  it('returns [] when no snapshot exists for client', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: null, error: null })

    const { Ga4Adapter } = await import('../Ga4Adapter')
    const result = await new Ga4Adapter().pullMetrics('client-abc')

    expect(result).toEqual([])
    expect(mockMetricsUpsert).not.toHaveBeenCalled()
  })

  it('returns [] when snapshot query errors', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })

    const { Ga4Adapter } = await import('../Ga4Adapter')
    const result = await new Ga4Adapter().pullMetrics('client-abc')

    expect(result).toEqual([])
    expect(mockMetricsUpsert).not.toHaveBeenCalled()
  })

  it('inserts 5 metrics for a full snapshot row', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: SNAPSHOT_ROW, error: null })

    const { Ga4Adapter } = await import('../Ga4Adapter')
    const result = await new Ga4Adapter().pullMetrics('client-abc')

    expect(result).toHaveLength(5)
    expect(mockMetricsUpsert).toHaveBeenCalledOnce()

    const inserted = mockMetricsUpsert.mock.calls[0][0] as Array<{
      metric_key: string
      metric_value: number
      flywheel: string
      source: string
    }>
    expect(inserted).toHaveLength(5)
    expect(inserted.every(r => r.flywheel === 'seo')).toBe(true)
    expect(inserted.every(r => r.source === 'ga4')).toBe(true)
  })

  it('inserts correct metric keys', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: SNAPSHOT_ROW, error: null })

    const { Ga4Adapter } = await import('../Ga4Adapter')
    await new Ga4Adapter().pullMetrics('client-abc')

    const inserted = mockMetricsUpsert.mock.calls[0][0] as Array<{ metric_key: string; metric_value: number }>
    const keys = inserted.map(r => r.metric_key)

    expect(keys).toContain(SEO_METRIC_KEY.GA4_SESSIONS)
    expect(keys).toContain(SEO_METRIC_KEY.GA4_USERS)
    expect(keys).toContain(SEO_METRIC_KEY.GA4_PAGEVIEWS)
    expect(keys).toContain(SEO_METRIC_KEY.GA4_AVG_SESSION_DURATION)
    expect(keys).toContain(SEO_METRIC_KEY.GA4_BOUNCE_RATE)
  })

  it('inserts correct metric values from snapshot', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: SNAPSHOT_ROW, error: null })

    const { Ga4Adapter } = await import('../Ga4Adapter')
    await new Ga4Adapter().pullMetrics('client-abc')

    const inserted = mockMetricsUpsert.mock.calls[0][0] as Array<{ metric_key: string; metric_value: number }>
    const byKey = Object.fromEntries(inserted.map(r => [r.metric_key, r.metric_value]))

    expect(byKey[SEO_METRIC_KEY.GA4_SESSIONS]).toBe(4200)
    expect(byKey[SEO_METRIC_KEY.GA4_USERS]).toBe(3100)
    expect(byKey[SEO_METRIC_KEY.GA4_PAGEVIEWS]).toBe(9800)
    expect(byKey[SEO_METRIC_KEY.GA4_AVG_SESSION_DURATION]).toBe(185.5)
    expect(byKey[SEO_METRIC_KEY.GA4_BOUNCE_RATE]).toBe(0.42)
  })

  it('includes source_ref with snapshot_id, property_id, period_start, period_end', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: SNAPSHOT_ROW, error: null })

    const { Ga4Adapter } = await import('../Ga4Adapter')
    await new Ga4Adapter().pullMetrics('client-abc')

    const inserted = mockMetricsUpsert.mock.calls[0][0] as Array<{
      source_ref: { snapshot_id: string; property_id: string; period_start: string; period_end: string }
    }>
    expect(inserted[0].source_ref.snapshot_id).toBe('snap-uuid-1')
    expect(inserted[0].source_ref.property_id).toBe('123456789')
    expect(inserted[0].source_ref.period_start).toBe('2026-05-01')
    expect(inserted[0].source_ref.period_end).toBe('2026-05-28')
  })

  it('skips null metric values (partial snapshot)', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({
      data: { ...SNAPSHOT_ROW, bounce_rate: null, avg_session_duration: null },
      error: null,
    })

    const { Ga4Adapter } = await import('../Ga4Adapter')
    const result = await new Ga4Adapter().pullMetrics('client-abc')

    expect(result).toHaveLength(3)  // sessions + users + pageviews only
    const inserted = mockMetricsUpsert.mock.calls[0][0] as Array<{ metric_key: string }>
    expect(inserted.map(r => r.metric_key)).not.toContain(SEO_METRIC_KEY.GA4_BOUNCE_RATE)
    expect(inserted.map(r => r.metric_key)).not.toContain(SEO_METRIC_KEY.GA4_AVG_SESSION_DURATION)
  })

  it('returns [] and does not insert when all metric values are null', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({
      data: {
        ...SNAPSHOT_ROW,
        total_sessions:       null,
        total_users:          null,
        total_pageviews:      null,
        avg_session_duration: null,
        bounce_rate:          null,
      },
      error: null,
    })

    const { Ga4Adapter } = await import('../Ga4Adapter')
    const result = await new Ga4Adapter().pullMetrics('client-abc')

    expect(result).toEqual([])
    expect(mockMetricsUpsert).not.toHaveBeenCalled()
  })

  it('logs error but does not throw when flywheel_metrics insert fails', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: SNAPSHOT_ROW, error: null })
    mockMetricsUpsert.mockResolvedValue({ error: { message: 'DB timeout' } })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Ga4Adapter } = await import('../Ga4Adapter')
    const result = await new Ga4Adapter().pullMetrics('client-abc')

    // Returns the prepared rows even if DB insert fails
    expect(result).toHaveLength(5)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Ga4Adapter]'),
      expect.stringContaining('DB timeout'),
    )

    consoleSpy.mockRestore()
  })

  // ── since filter ─────────────────────────────────────────────────────────

  it('applies since filter via .gte() when provided', async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: SNAPSHOT_ROW, error: null })

    const since = new Date('2026-05-01T00:00:00Z')
    const { Ga4Adapter } = await import('../Ga4Adapter')
    await new Ga4Adapter().pullMetrics('client-abc', since)

    expect(mockSnapshotGte).toHaveBeenCalledWith('synced_at', since.toISOString())
  })
})
