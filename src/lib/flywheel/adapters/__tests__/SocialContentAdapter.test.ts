/**
 * SocialContentAdapter unit tests — P12.B.3
 *
 * Mocks supabaseAdmin so no real DB calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SOCIAL_ACTION_TYPE, SOCIAL_METRIC_KEY } from '../../vocabulary'
import { clearRegistry } from '../registry'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

const mockInsertMetricsResult = vi.fn().mockResolvedValue({ error: null })

const mockSingle = vi.fn()
const mockActionSelect = vi.fn(() => ({ single: mockSingle }))
const mockActionInsert = vi.fn(() => ({ select: mockActionSelect }))

// content_posts count mock — resolves { count, error }
const mockCountResolve = vi.fn().mockResolvedValue({ count: 3, error: null })
const mockCountGte     = vi.fn(() => mockCountResolve())
const mockCountEq2     = vi.fn(() => Object.assign(mockCountResolve(), { gte: mockCountGte }))
const mockCountEq1     = vi.fn(() => ({ eq: mockCountEq2 }))
const mockCountSelect  = vi.fn(() => ({ eq: mockCountEq1 }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'flywheel_actions') return { insert: mockActionInsert }
      if (table === 'flywheel_metrics') return { insert: mockInsertMetricsResult }
      if (table === 'content_posts')    return { select: mockCountSelect }
      return {}
    }),
  },
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SocialContentAdapter', () => {
  beforeEach(async () => {
    clearRegistry()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('has flywheel = "social"', async () => {
    const { SocialContentAdapter } = await import('../SocialContentAdapter')
    const adapter = new SocialContentAdapter()
    expect(adapter.flywheel).toBe('social')
  })

  it('auto-registers itself to the registry on import', async () => {
    clearRegistry()
    await import('../SocialContentAdapter')
    const { hasAdapter } = await import('../registry')
    expect(hasAdapter('social')).toBe(true)
  })

  it('throws when actionType is not a valid Social action', async () => {
    const { SocialContentAdapter } = await import('../SocialContentAdapter')
    const adapter = new SocialContentAdapter()
    await expect(
      adapter.execute({
        clientId:      'client-1',
        actionType:    'seo.publish_blog',
        executionMode: 'in_house',
      })
    ).rejects.toThrow('Unknown Social action_type')
  })

  it('inserts a flywheel_actions row and returns FlywheelActionRow', async () => {
    const now = new Date().toISOString()
    const dbRow = {
      id:                'action-uuid',
      client_id:         'client-cts',
      execution_item_id: null,
      flywheel:          'social',
      action_type:       SOCIAL_ACTION_TYPE.SCHEDULE_POST,
      execution_mode:    'third_party',
      vendor:            'publer',
      payload:           { post_id: 'post-42', platform: 'instagram' },
      expected_metric:   null,
      expected_delta:    null,
      executed_at:       now,
    }
    mockSingle.mockResolvedValueOnce({ data: dbRow, error: null })

    const { SocialContentAdapter } = await import('../SocialContentAdapter')
    const adapter = new SocialContentAdapter()
    const result = await adapter.execute({
      clientId:      'client-cts',
      actionType:    SOCIAL_ACTION_TYPE.SCHEDULE_POST,
      executionMode: 'third_party',
      vendor:        'publer',
      payload:       { post_id: 'post-42', platform: 'instagram' },
    })

    expect(result).toEqual({
      id:              'action-uuid',
      clientId:        'client-cts',
      executionItemId: undefined,
      flywheel:        'social',
      actionType:      SOCIAL_ACTION_TYPE.SCHEDULE_POST,
      executionMode:   'third_party',
      vendor:          'publer',
      payload:         { post_id: 'post-42', platform: 'instagram' },
      expectedMetric:  undefined,
      expectedDelta:   undefined,
      executedAt:      now,
    })
  })

  it('throws on DB error during execute', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'FK violation' } })

    const { SocialContentAdapter } = await import('../SocialContentAdapter')
    const adapter = new SocialContentAdapter()
    await expect(
      adapter.execute({
        clientId:      'client-1',
        actionType:    SOCIAL_ACTION_TYPE.PUBLISH_POST,
        executionMode: 'third_party',
        vendor:        'publer',
      })
    ).rejects.toThrow('FK violation')
  })

  it('pullMetrics returns 2 metric rows (published + scheduled counts)', async () => {
    // published = 5, scheduled = 2
    mockCountResolve
      .mockResolvedValueOnce({ count: 5, error: null })
      .mockResolvedValueOnce({ count: 2, error: null })

    const { SocialContentAdapter } = await import('../SocialContentAdapter')
    const adapter = new SocialContentAdapter()
    const result = await adapter.pullMetrics('client-cts')

    expect(result).toHaveLength(2)
    const keys = result.map(r => r.metricKey)
    expect(keys).toContain(SOCIAL_METRIC_KEY.PUBLISHED_COUNT)
    expect(keys).toContain(SOCIAL_METRIC_KEY.SCHEDULED_COUNT)
  })

  it('pullMetrics values match the mocked counts', async () => {
    mockCountResolve
      .mockResolvedValueOnce({ count: 10, error: null })
      .mockResolvedValueOnce({ count: 3,  error: null })

    const { SocialContentAdapter } = await import('../SocialContentAdapter')
    const adapter = new SocialContentAdapter()
    const result = await adapter.pullMetrics('client-cts')

    const published = result.find(r => r.metricKey === SOCIAL_METRIC_KEY.PUBLISHED_COUNT)
    const scheduled = result.find(r => r.metricKey === SOCIAL_METRIC_KEY.SCHEDULED_COUNT)
    expect(published?.metricValue).toBe(10)
    expect(scheduled?.metricValue).toBe(3)
  })

  it('pullMetrics returns partial results when one count query fails', async () => {
    mockCountResolve
      .mockResolvedValueOnce({ count: 7, error: null })
      .mockRejectedValueOnce(new Error('DB timeout'))

    const { SocialContentAdapter } = await import('../SocialContentAdapter')
    const adapter = new SocialContentAdapter()
    const result = await adapter.pullMetrics('client-cts')

    expect(result).toHaveLength(1)
    expect(result[0].metricKey).toBe(SOCIAL_METRIC_KEY.PUBLISHED_COUNT)
    expect(result[0].metricValue).toBe(7)
  })

  it('pullMetrics returns empty array when both count queries fail', async () => {
    mockCountResolve
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))

    const { SocialContentAdapter } = await import('../SocialContentAdapter')
    const adapter = new SocialContentAdapter()
    const result = await adapter.pullMetrics('client-cts')

    expect(result).toEqual([])
  })

  it('all three SOCIAL_ACTION_TYPE values pass isValidSocialActionType', async () => {
    const { isValidSocialActionType } = await import('../../vocabulary')
    expect(isValidSocialActionType(SOCIAL_ACTION_TYPE.GENERATE_CONTENT)).toBe(true)
    expect(isValidSocialActionType(SOCIAL_ACTION_TYPE.SCHEDULE_POST)).toBe(true)
    expect(isValidSocialActionType(SOCIAL_ACTION_TYPE.PUBLISH_POST)).toBe(true)
    expect(isValidSocialActionType('social.unknown')).toBe(false)
  })

  it('both SOCIAL_METRIC_KEY values pass isValidSocialMetricKey', async () => {
    const { isValidSocialMetricKey } = await import('../../vocabulary')
    expect(isValidSocialMetricKey(SOCIAL_METRIC_KEY.PUBLISHED_COUNT)).toBe(true)
    expect(isValidSocialMetricKey(SOCIAL_METRIC_KEY.SCHEDULED_COUNT)).toBe(true)
    expect(isValidSocialMetricKey('social.unknown')).toBe(false)
  })
})
