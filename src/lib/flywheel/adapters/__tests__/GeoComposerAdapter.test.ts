/**
 * GeoComposerAdapter unit tests — P12.A.4
 *
 * Mocks supabaseAdmin so no real DB connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GEO_ACTION_TYPE } from '../../vocabulary'
import { clearRegistry, hasAdapter } from '../registry'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

const mockSingle = vi.fn()
const mockSelect = vi.fn(() => ({ single: mockSingle }))
const mockInsert = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ insert: mockInsert })),
  },
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GeoComposerAdapter', () => {
  beforeEach(async () => {
    clearRegistry()
    vi.clearAllMocks()
    vi.resetModules()
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

  it('pullMetrics returns empty array (stub for P12.A.7)', async () => {
    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    const result = await adapter.pullMetrics('client-1')
    expect(result).toEqual([])
  })

  it('pullMetrics accepts optional since parameter without error', async () => {
    const { GeoComposerAdapter } = await import('../GeoComposerAdapter')
    const adapter = new GeoComposerAdapter()
    const result = await adapter.pullMetrics('client-1', new Date())
    expect(result).toEqual([])
  })
})
