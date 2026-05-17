/**
 * SeoContentAdapter unit tests — P12.B.1
 *
 * Mocks supabaseAdmin and getDomainMetrics so no real DB / API calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SEO_ACTION_TYPE, SEO_METRIC_KEY } from '../../vocabulary'
import { clearRegistry } from '../registry'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

const mockInsertMetricsResult = vi.fn().mockResolvedValue({ error: null })
const mockMetricsFrom = vi.fn(() => ({ insert: mockInsertMetricsResult }))

const mockSingle = vi.fn()
const mockActionSelect = vi.fn(() => ({ single: mockSingle }))
const mockActionInsert = vi.fn(() => ({ select: mockActionSelect }))

// blog_posts count mock — the last .eq() must return a thenable that resolves {count, error}
const mockCountResolve = vi.fn().mockResolvedValue({ count: 5, error: null })
// without `since`: chain is .select().eq().eq() → mockCountResolve()
// with `since`:    chain is .select().eq().eq().gte() → also mockCountResolve()
const mockCountGte    = vi.fn(() => mockCountResolve())
const mockCountEq2    = vi.fn(() => Object.assign(mockCountResolve(), { gte: mockCountGte }))
const mockCountEq1    = vi.fn(() => ({ eq: mockCountEq2 }))
const mockCountSelect = vi.fn(() => ({ eq: mockCountEq1 }))

// clients single mock
const mockClientSingle = vi.fn().mockResolvedValue({ data: { domain: 'example.com.au' }, error: null })
const mockClientEq = vi.fn(() => ({ single: mockClientSingle }))
const mockClientSelect = vi.fn(() => ({ eq: mockClientEq }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'flywheel_actions') return { insert: mockActionInsert }
      if (table === 'flywheel_metrics') return { insert: mockInsertMetricsResult }
      if (table === 'clients') return { select: mockClientSelect }
      if (table === 'blog_posts') return { select: mockCountSelect }
      return {}
    }),
  },
}))

// ── Mock getDomainMetrics ─────────────────────────────────────────────────────

vi.mock('@/lib/semrush/client', () => ({
  getDomainMetrics: vi.fn().mockResolvedValue({
    organic_keywords: 1200,
    organic_traffic: 8500,
    authority_score: 32,
  }),
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SeoContentAdapter', () => {
  beforeEach(async () => {
    clearRegistry()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('has flywheel = "seo"', async () => {
    const { SeoContentAdapter } = await import('../SeoContentAdapter')
    const adapter = new SeoContentAdapter()
    expect(adapter.flywheel).toBe('seo')
  })

  it('auto-registers itself to the registry on import', async () => {
    clearRegistry()
    await import('../SeoContentAdapter')
    const { hasAdapter } = await import('../registry')
    expect(hasAdapter('seo')).toBe(true)
  })

  it('throws when actionType is not a valid SEO action', async () => {
    const { SeoContentAdapter } = await import('../SeoContentAdapter')
    const adapter = new SeoContentAdapter()
    await expect(
      adapter.execute({
        clientId: 'client-1',
        actionType: 'geo.deploy_directive',
        executionMode: 'in_house',
      })
    ).rejects.toThrow('Unknown SEO action_type')
  })

  it('inserts a flywheel_actions row and returns FlywheelActionRow', async () => {
    const now = new Date().toISOString()
    const dbRow = {
      id: 'action-uuid',
      client_id: 'client-1',
      execution_item_id: 'item-1',
      flywheel: 'seo',
      action_type: SEO_ACTION_TYPE.PUBLISH_BLOG,
      execution_mode: 'in_house',
      vendor: null,
      payload: { postId: 'post-42', keyword: 'tour packages nz' },
      expected_metric: SEO_METRIC_KEY.ORGANIC_KEYWORDS,
      expected_delta: 10,
      executed_at: now,
    }
    mockSingle.mockResolvedValueOnce({ data: dbRow, error: null })

    const { SeoContentAdapter } = await import('../SeoContentAdapter')
    const adapter = new SeoContentAdapter()
    const result = await adapter.execute({
      clientId: 'client-1',
      executionItemId: 'item-1',
      actionType: SEO_ACTION_TYPE.PUBLISH_BLOG,
      executionMode: 'in_house',
      payload: { postId: 'post-42', keyword: 'tour packages nz' },
      expectedMetric: SEO_METRIC_KEY.ORGANIC_KEYWORDS,
      expectedDelta: 10,
    })

    expect(result).toEqual({
      id: 'action-uuid',
      clientId: 'client-1',
      executionItemId: 'item-1',
      flywheel: 'seo',
      actionType: SEO_ACTION_TYPE.PUBLISH_BLOG,
      executionMode: 'in_house',
      vendor: undefined,
      payload: { postId: 'post-42', keyword: 'tour packages nz' },
      expectedMetric: SEO_METRIC_KEY.ORGANIC_KEYWORDS,
      expectedDelta: 10,
      executedAt: now,
    })
  })

  it('throws on DB error during execute', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'FK violation' } })

    const { SeoContentAdapter } = await import('../SeoContentAdapter')
    const adapter = new SeoContentAdapter()
    await expect(
      adapter.execute({
        clientId: 'client-1',
        actionType: SEO_ACTION_TYPE.SEMRUSH_SNAPSHOT,
        executionMode: 'in_house',
      })
    ).rejects.toThrow('FK violation')
  })

  it('pullMetrics returns empty array when client domain is missing', async () => {
    mockClientSingle.mockResolvedValueOnce({ data: null, error: null })

    const { SeoContentAdapter } = await import('../SeoContentAdapter')
    const adapter = new SeoContentAdapter()
    const result = await adapter.pullMetrics('client-no-domain')
    expect(result).toEqual([])
  })

  it('pullMetrics returns 4 metric rows (3 SEMrush + 1 blog count)', async () => {
    mockClientSingle.mockResolvedValueOnce({ data: { domain: 'cts.com.au' }, error: null })
    mockCountResolve.mockResolvedValueOnce({ count: 7, error: null })

    const { SeoContentAdapter } = await import('../SeoContentAdapter')
    const adapter = new SeoContentAdapter()
    const result = await adapter.pullMetrics('client-cts')

    expect(result).toHaveLength(4)

    const keys = result.map(r => r.metricKey)
    expect(keys).toContain(SEO_METRIC_KEY.ORGANIC_KEYWORDS)
    expect(keys).toContain(SEO_METRIC_KEY.ORGANIC_TRAFFIC)
    expect(keys).toContain(SEO_METRIC_KEY.AUTHORITY_SCORE)
    expect(keys).toContain(SEO_METRIC_KEY.PUBLISHED_POSTS)
  })

  it('pullMetrics SEMrush values match getDomainMetrics mock', async () => {
    mockClientSingle.mockResolvedValueOnce({ data: { domain: 'cts.com.au' }, error: null })
    mockCountResolve.mockResolvedValueOnce({ count: 3, error: null })

    const { SeoContentAdapter } = await import('../SeoContentAdapter')
    const adapter = new SeoContentAdapter()
    const result = await adapter.pullMetrics('client-cts')

    const kwRow = result.find(r => r.metricKey === SEO_METRIC_KEY.ORGANIC_KEYWORDS)
    expect(kwRow?.metricValue).toBe(1200)

    const trafficRow = result.find(r => r.metricKey === SEO_METRIC_KEY.ORGANIC_TRAFFIC)
    expect(trafficRow?.metricValue).toBe(8500)

    const asRow = result.find(r => r.metricKey === SEO_METRIC_KEY.AUTHORITY_SCORE)
    expect(asRow?.metricValue).toBe(32)
  })

  it('pullMetrics still returns blog count when SEMrush fails', async () => {
    const { getDomainMetrics } = await import('@/lib/semrush/client')
    vi.mocked(getDomainMetrics).mockRejectedValueOnce(new Error('SEMrush timeout'))

    mockClientSingle.mockResolvedValueOnce({ data: { domain: 'cts.com.au' }, error: null })
    mockCountResolve.mockResolvedValueOnce({ count: 4, error: null })

    const { SeoContentAdapter } = await import('../SeoContentAdapter')
    const adapter = new SeoContentAdapter()
    const result = await adapter.pullMetrics('client-cts')

    expect(result).toHaveLength(1)
    expect(result[0].metricKey).toBe(SEO_METRIC_KEY.PUBLISHED_POSTS)
    expect(result[0].metricValue).toBe(4)
  })
})
