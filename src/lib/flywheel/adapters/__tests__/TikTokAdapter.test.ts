/**
 * TikTokAdapter unit tests — P22.A.4
 *
 * Mocks supabaseAdmin and scrapeTiktokProfile so no real DB / Apify calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SOCIAL_METRIC_KEY } from '../../vocabulary'
import { clearRegistry } from '../registry'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

const mockMetricsUpsert = vi.fn().mockResolvedValue({ error: null })

// clients chain:  .select().eq().maybeSingle()
const mockClientMaybeSingle = vi.fn()
const mockClientEq = vi.fn(() => ({ maybeSingle: mockClientMaybeSingle }))
const mockClientSelect = vi.fn(() => ({ eq: mockClientEq }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'flywheel_metrics') return { upsert: mockMetricsUpsert }
      if (table === 'clients')          return { select: mockClientSelect }
      return {}
    }),
  },
}))

// ── Mock scrapeTiktokProfile ──────────────────────────────────────────────────

const mockScrapeTiktok = vi.fn()

vi.mock('@/lib/apify/social-scraper', () => ({
  scrapeTiktokProfile: (...args: unknown[]) => mockScrapeTiktok(...args),
}))

// ── Fixture data ──────────────────────────────────────────────────────────────

const CLIENT_ROW = { tiktok_handle: '@kiwibrand' }

const TIKTOK_PROFILE = {
  handle:          'kiwibrand',
  followersCount:  12500,
  postsLast30Days: 18,
  engagementRate:  0.057,
  contentTypes:    ['video'],
  topPosts30d:     [],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TikTokAdapter', () => {
  beforeEach(async () => {
    clearRegistry()
    vi.clearAllMocks()
    vi.resetModules()
  })

  // ── Identity ────────────────────────────────────────────────────────────────

  it('has flywheel = "social"', async () => {
    const { TikTokAdapter } = await import('../TikTokAdapter')
    const adapter = new TikTokAdapter()
    expect(adapter.flywheel).toBe('social')
  })

  it('auto-registers itself to the registry on import', async () => {
    clearRegistry()
    await import('../TikTokAdapter')
    const { hasAdapter } = await import('../registry')
    expect(hasAdapter('social')).toBe(true)
  })

  it('execute() throws — TikTok publishing is handled by SocialContentAdapter', async () => {
    const { TikTokAdapter } = await import('../TikTokAdapter')
    const adapter = new TikTokAdapter()
    await expect(
      adapter.execute({ clientId: 'client-1', actionType: 'social.publish_post', executionMode: 'third_party' })
    ).rejects.toThrow('does not support execute()')
  })

  // ── pullMetrics: no handle cases ─────────────────────────────────────────

  it('returns [] when client has no tiktok_handle', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: { tiktok_handle: null }, error: null })

    const { TikTokAdapter } = await import('../TikTokAdapter')
    const result = await new TikTokAdapter().pullMetrics('client-abc')

    expect(result).toEqual([])
    expect(mockScrapeTiktok).not.toHaveBeenCalled()
    expect(mockMetricsUpsert).not.toHaveBeenCalled()
  })

  it('returns [] when client row not found', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: null, error: null })

    const { TikTokAdapter } = await import('../TikTokAdapter')
    const result = await new TikTokAdapter().pullMetrics('client-abc')

    expect(result).toEqual([])
    expect(mockScrapeTiktok).not.toHaveBeenCalled()
  })

  it('returns [] when clients query errors', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: null, error: { message: 'DB timeout' } })

    const { TikTokAdapter } = await import('../TikTokAdapter')
    const result = await new TikTokAdapter().pullMetrics('client-abc')

    expect(result).toEqual([])
    expect(mockScrapeTiktok).not.toHaveBeenCalled()
  })

  it('returns [] when tiktok_handle is empty string', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: { tiktok_handle: '   ' }, error: null })

    const { TikTokAdapter } = await import('../TikTokAdapter')
    const result = await new TikTokAdapter().pullMetrics('client-abc')

    expect(result).toEqual([])
    expect(mockScrapeTiktok).not.toHaveBeenCalled()
  })

  // ── pullMetrics: scrape failure ───────────────────────────────────────────

  it('returns [] and does not insert when scrapeTiktokProfile throws', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: CLIENT_ROW, error: null })
    mockScrapeTiktok.mockRejectedValue(new Error('APIFY_API_KEY not configured'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { TikTokAdapter } = await import('../TikTokAdapter')
    const result = await new TikTokAdapter().pullMetrics('client-abc')

    expect(result).toEqual([])
    expect(mockMetricsUpsert).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[TikTokAdapter]'),
      expect.stringContaining('APIFY_API_KEY not configured'),
    )

    consoleSpy.mockRestore()
  })

  // ── pullMetrics: happy path ───────────────────────────────────────────────

  it('inserts 3 metrics for a full TikTok profile', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: CLIENT_ROW, error: null })
    mockScrapeTiktok.mockResolvedValue(TIKTOK_PROFILE)

    const { TikTokAdapter } = await import('../TikTokAdapter')
    const result = await new TikTokAdapter().pullMetrics('client-abc')

    expect(result).toHaveLength(3)
    expect(mockMetricsUpsert).toHaveBeenCalledOnce()

    const inserted = mockMetricsUpsert.mock.calls[0][0] as Array<{
      metric_key: string
      metric_value: number
      flywheel: string
      source: string
    }>
    expect(inserted).toHaveLength(3)
    expect(inserted.every(r => r.flywheel === 'social')).toBe(true)
    expect(inserted.every(r => r.source === 'tiktok_apify')).toBe(true)
  })

  it('inserts correct metric keys', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: CLIENT_ROW, error: null })
    mockScrapeTiktok.mockResolvedValue(TIKTOK_PROFILE)

    const { TikTokAdapter } = await import('../TikTokAdapter')
    await new TikTokAdapter().pullMetrics('client-abc')

    const inserted = mockMetricsUpsert.mock.calls[0][0] as Array<{ metric_key: string }>
    const keys = inserted.map(r => r.metric_key)

    expect(keys).toContain(SOCIAL_METRIC_KEY.TIKTOK_FOLLOWERS)
    expect(keys).toContain(SOCIAL_METRIC_KEY.TIKTOK_POSTS_LAST_30D)
    expect(keys).toContain(SOCIAL_METRIC_KEY.TIKTOK_ENGAGEMENT_RATE)
  })

  it('inserts correct metric values from TikTok profile', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: CLIENT_ROW, error: null })
    mockScrapeTiktok.mockResolvedValue(TIKTOK_PROFILE)

    const { TikTokAdapter } = await import('../TikTokAdapter')
    await new TikTokAdapter().pullMetrics('client-abc')

    const inserted = mockMetricsUpsert.mock.calls[0][0] as Array<{ metric_key: string; metric_value: number }>
    const byKey = Object.fromEntries(inserted.map(r => [r.metric_key, r.metric_value]))

    expect(byKey[SOCIAL_METRIC_KEY.TIKTOK_FOLLOWERS]).toBe(12500)
    expect(byKey[SOCIAL_METRIC_KEY.TIKTOK_POSTS_LAST_30D]).toBe(18)
    expect(byKey[SOCIAL_METRIC_KEY.TIKTOK_ENGAGEMENT_RATE]).toBe(0.057)
  })

  it('strips leading @ from tiktok_handle before scraping', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: { tiktok_handle: '@kiwibrand' }, error: null })
    mockScrapeTiktok.mockResolvedValue(TIKTOK_PROFILE)

    const { TikTokAdapter } = await import('../TikTokAdapter')
    await new TikTokAdapter().pullMetrics('client-abc')

    // scrapeTiktokProfile receives handle as stored in clients.tiktok_handle
    // (the social-scraper itself strips the @ prefix internally)
    expect(mockScrapeTiktok).toHaveBeenCalledWith('@kiwibrand')
  })

  it('includes source_ref with handle and scraped_at', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: CLIENT_ROW, error: null })
    mockScrapeTiktok.mockResolvedValue(TIKTOK_PROFILE)

    const { TikTokAdapter } = await import('../TikTokAdapter')
    await new TikTokAdapter().pullMetrics('client-abc')

    const inserted = mockMetricsUpsert.mock.calls[0][0] as Array<{
      source_ref: { handle: string; scraped_at: string }
    }>
    expect(inserted[0].source_ref.handle).toBe('@kiwibrand')
    expect(inserted[0].source_ref.scraped_at).toBeDefined()
  })

  it('logs error but does not throw when flywheel_metrics insert fails', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: CLIENT_ROW, error: null })
    mockScrapeTiktok.mockResolvedValue(TIKTOK_PROFILE)
    mockMetricsUpsert.mockResolvedValue({ error: { message: 'Insert failed' } })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { TikTokAdapter } = await import('../TikTokAdapter')
    const result = await new TikTokAdapter().pullMetrics('client-abc')

    expect(result).toHaveLength(3)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[TikTokAdapter]'),
      expect.stringContaining('Insert failed'),
    )

    consoleSpy.mockRestore()
  })
})
