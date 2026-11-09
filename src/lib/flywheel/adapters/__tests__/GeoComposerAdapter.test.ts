/**
 * GeoComposerAdapter unit tests — P12.A.4 / P12.A.7
 *
 * Mocks supabaseAdmin and the flywheel_metrics writer so no real DB
 * connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GEO_ACTION_TYPE } from '../../vocabulary'
import { clearRegistry, hasAdapter } from '../registry'
import { writeTrackerFlywheelMetrics } from '../../metrics/writeTrackerMetrics'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

// flywheel_actions: .insert().select().single()
const mockSingle = vi.fn()
const mockSelect = vi.fn(() => ({ single: mockSingle }))
const mockInsert = vi.fn(() => ({ select: mockSelect }))

// ai_visibility_snapshots: .select().eq().order().limit()[.gte()].maybeSingle()
const mockMaybeSingle = vi.fn()
const mockGte = vi.fn()
const snapshotQuery = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  gte: mockGte,
  maybeSingle: mockMaybeSingle,
}
for (const method of [snapshotQuery.select, snapshotQuery.eq, snapshotQuery.order, snapshotQuery.limit, mockGte]) {
  method.mockReturnValue(snapshotQuery)
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) =>
      table === 'ai_visibility_snapshots' ? snapshotQuery : { insert: mockInsert }
    ),
  },
}))

vi.mock('../../metrics/writeTrackerMetrics', () => ({
  writeTrackerFlywheelMetrics: vi.fn().mockResolvedValue(undefined),
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GeoComposerAdapter', () => {
  beforeEach(async () => {
    clearRegistry()
    vi.clearAllMocks()
    vi.resetModules()
    // clearAllMocks wipes mockReturnValue on the chain — restore it
    for (const method of [snapshotQuery.select, snapshotQuery.eq, snapshotQuery.order, snapshotQuery.limit, mockGte]) {
      method.mockReturnValue(snapshotQuery)
    }
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
  })

  it('has flywheel = "geo"', async () => {
    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    expect(adapter.flywheel).toBe('geo')
  })

  it('auto-registers itself to the registry on import', async () => {
    clearRegistry()
    await import('../GeoComposerAdapter')
    // Use the same registry module instance (static import) to verify registration.
    // vi.resetModules() clears dynamic import cache only — static hasAdapter is stable.
    const { hasAdapter: check } = await import('../registry')
    expect(check('geo')).toBe(true)
  })

  it('throws when executionMode is not in_house', async () => {
    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    await expect(
      adapter.execute({
        clientId: 'client-1',
        actionType: GEO_ACTION_TYPE.DEPLOY_DIRECTIVE,
        executionMode: 'third_party',
      })
    ).rejects.toThrow('in_house')
  })

  it('throws when actionType is not a valid GEO action', async () => {
    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    await expect(
      adapter.execute({
        clientId: 'client-1',
        actionType: 'bad.action',
        executionMode: 'in_house',
      })
    ).rejects.toThrow('Unknown GEO action_type')
  })

  it('inserts a flywheel_actions row and returns FlywheelActionRow', async () => {
    const now = new Date().toISOString()
    const dbRow = {
      id: 'action-uuid',
      client_id: 'client-1',
      execution_item_id: 'item-1',
      flywheel: 'geo',
      action_type: GEO_ACTION_TYPE.DEPLOY_DIRECTIVE,
      execution_mode: 'in_house',
      vendor: null,
      payload: { directiveId: 'dir-42' },
      expected_metric: 'geo.query.mention_rate',
      expected_delta: 0.05,
      executed_at: now,
    }
    mockSingle.mockResolvedValueOnce({ data: dbRow, error: null })

    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    const result = await adapter.execute({
      clientId: 'client-1',
      executionItemId: 'item-1',
      actionType: GEO_ACTION_TYPE.DEPLOY_DIRECTIVE,
      executionMode: 'in_house',
      payload: { directiveId: 'dir-42' },
      expectedMetric: 'geo.query.mention_rate',
      expectedDelta: 0.05,
    })

    expect(result).toEqual({
      id: 'action-uuid',
      clientId: 'client-1',
      executionItemId: 'item-1',
      flywheel: 'geo',
      actionType: GEO_ACTION_TYPE.DEPLOY_DIRECTIVE,
      executionMode: 'in_house',
      vendor: undefined,
      payload: { directiveId: 'dir-42' },
      expectedMetric: 'geo.query.mention_rate',
      expectedDelta: 0.05,
      executedAt: now,
    })
  })

  it('throws on DB error', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'FK violation' } })

    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    await expect(
      adapter.execute({
        clientId: 'client-1',
        actionType: GEO_ACTION_TYPE.COMPOSE_DIRECTIVE,
        executionMode: 'in_house',
      })
    ).rejects.toThrow('FK violation')
  })

  it('pullMetrics returns empty array when no snapshot exists and writes nothing', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    const result = await adapter.pullMetrics('client-1')

    expect(result).toEqual([])
    expect(snapshotQuery.eq).toHaveBeenCalledWith('client_id', 'client-1')
    expect(mockGte).not.toHaveBeenCalled()
    expect(writeTrackerFlywheelMetrics).not.toHaveBeenCalled()
  })

  it('pullMetrics returns empty array on DB error', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    await expect(adapter.pullMetrics('client-1')).resolves.toEqual([])
    expect(writeTrackerFlywheelMetrics).not.toHaveBeenCalled()
  })

  it('pullMetrics applies since as a created_at lower bound', async () => {
    const since = new Date('2026-08-01T00:00:00.000Z')
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    const result = await adapter.pullMetrics('client-1', since)

    expect(result).toEqual([])
    expect(mockGte).toHaveBeenCalledWith('created_at', since.toISOString())
  })

  it('pullMetrics writes tracker metrics and returns the metric rows for the latest snapshot', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'snap-1',
        week_of: '2026-08-31',
        avg_rank: 2.5,
        mentions_count: 4,
        total_runs: 10,
        models_covered: ['chatgpt', 'perplexity'],
        created_at: '2026-08-31T00:00:00.000Z',
      },
      error: null,
    })

    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    const result = await adapter.pullMetrics('client-1')

    expect(writeTrackerFlywheelMetrics).toHaveBeenCalledWith('client-1', {
      snapshotId: 'snap-1',
      mentionsCount: 4,
      totalRuns: 10,
      avgRank: 2.5,
      engineCoverage: 2,
    })
    expect(result.map(r => [r.metricKey, r.metricValue])).toEqual([
      ['geo.query.mention_rate', 0.4],
      ['geo.engine.coverage', 2],
      ['geo.query.avg_rank', 2.5],
    ])
    for (const row of result) {
      expect(row).toMatchObject({
        clientId: 'client-1',
        flywheel: 'geo',
        source: 'ai_tracker',
        sourceRef: { snapshot_id: 'snap-1' },
      })
    }
  })

  it('pullMetrics omits avg_rank row when brand was never ranked', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'snap-2',
        week_of: '2026-08-31',
        avg_rank: null,
        mentions_count: 0,
        total_runs: 5,
        models_covered: [],
        created_at: '2026-08-31T00:00:00.000Z',
      },
      error: null,
    })

    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    const result = await adapter.pullMetrics('client-1')

    expect(result.map(r => r.metricKey)).toEqual(['geo.query.mention_rate', 'geo.engine.coverage'])
    expect(result[0].metricValue).toBe(0)
  })
})
