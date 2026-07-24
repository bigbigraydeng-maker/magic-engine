/**
 * Regression tests for SyncOptions — P21.K.6 (魏征 required before merge)
 *
 * The prescription button calls syncWinnerReels with two safety options. Both
 * guard promises made to the PM in the confirm dialog, on a path that ALREADY
 * had one consent-scope incident (the button would have paused ads). If a
 * refactor ever drops these flags, these tests go red.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const pauseAd = vi.fn()
const createAdFromPost = vi.fn()
const listAdsInAdSet = vi.fn()
const fetchCTRForAds = vi.fn()

vi.mock('@/lib/meta/ads-manager', () => ({
  pauseAd: (...a: unknown[]) => pauseAd(...a),
  createAdFromPost: (...a: unknown[]) => createAdFromPost(...a),
  listAdsInAdSet: (...a: unknown[]) => listAdsInAdSet(...a),
  fetchCTRForAds: (...a: unknown[]) => fetchCTRForAds(...a),
}))

vi.mock('@/lib/meta/page-posts', () => ({
  getPageAccessToken: async () => 'page-token',
  fetchPagePosts: async () => [{ id: 'p' }],
  rankVideoWinners: () => [{ postId: '12345678', message: 'hello world reel', score: 99 }],
}))

vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: async () => 'user-token',
}))

// Config: new ads default ACTIVE (the Level-2 rollout case) — the override test
// must win against exactly this. Fatigue pass conditions are all satisfied so
// the pause WOULD fire unless skipped.
const CONFIG_ROW = {
  client_id: 'c1',
  fb_page_id: 'page1',
  ad_account_id: 'act_1',
  target_adset_id: 'adset1',
  min_active_ads: 1,
  ad_min_age_days: 0,
  max_new_ads_per_run: 3,
  winner_min_score: 0,
  new_ad_default_status: 'ACTIVE',
  blacklist_keywords: [],
  slack_webhook_url: null,
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === 'winner_reel_sync_config'
            ? { data: CONFIG_ROW, error: null }
            : { data: null, error: null },
        insert: async () => ({ error: null }),
      }
      return builder
    },
  }),
}))

import { syncWinnerReels } from '../engine'

const OLD_TIME = new Date(Date.now() - 30 * 86_400_000).toISOString()

beforeEach(() => {
  pauseAd.mockReset().mockResolvedValue(undefined)
  createAdFromPost.mockReset().mockResolvedValue({ adId: 'new-ad-1' })
  // 3 ACTIVE ads, old enough to be pause-eligible; none carries the winner post.
  listAdsInAdSet.mockReset().mockResolvedValue([
    { adId: 'a1', name: 'A1', status: 'ACTIVE', createdTime: OLD_TIME, effectiveObjectStoryId: 'page1_901' },
    { adId: 'a2', name: 'A2', status: 'ACTIVE', createdTime: OLD_TIME, effectiveObjectStoryId: 'page1_902' },
    { adId: 'a3', name: 'A3', status: 'ACTIVE', createdTime: OLD_TIME, effectiveObjectStoryId: 'page1_903' },
  ])
  // a1's CTR is far below median×0.5 → the fatigue pass WOULD pause it.
  fetchCTRForAds.mockReset().mockResolvedValue({ a1: 0.001, a2: 0.02, a3: 0.03 })
})

describe('syncWinnerReels options — the prescription button contract', () => {
  it('skipFatiguePause: adds creatives but NEVER pauses ads', async () => {
    const r = await syncWinnerReels('c1', { skipFatiguePause: true, newAdStatusOverride: 'PAUSED' })
    expect(r.status).toBe('ok')
    expect(r.adsAdded).toHaveLength(1)
    expect(pauseAd).not.toHaveBeenCalled()
    expect(r.adsPaused).toHaveLength(0)
    expect(r.guardsHit).toContain('fatigue_pause_skipped')
  })

  it('newAdStatusOverride wins over a config that defaults new ads to ACTIVE', async () => {
    await syncWinnerReels('c1', { skipFatiguePause: true, newAdStatusOverride: 'PAUSED' })
    expect(createAdFromPost).toHaveBeenCalledTimes(1)
    expect(createAdFromPost.mock.calls[0][0]).toMatchObject({ status: 'PAUSED' })
  })

  it('the cron path (no options) keeps the FULL pipeline: config status + fatigue pause', async () => {
    const r = await syncWinnerReels('c1')
    // New ad follows client config (ACTIVE here) …
    expect(createAdFromPost.mock.calls[0][0]).toMatchObject({ status: 'ACTIVE' })
    // …and the fatigue pass still fires on the weak ad.
    expect(pauseAd).toHaveBeenCalledWith('a1', 'user-token')
    expect(r.adsPaused).toHaveLength(1)
    expect(r.guardsHit).not.toContain('fatigue_pause_skipped')
  })
})
