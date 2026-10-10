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

// AD-SEC-1 归属校验(target_adset_id 那一半)要实拉 ad set——account_id 跟
// CONFIG_ROW.ad_account_id 一致，代表"配置的 ad set 确实是这个账户下的"。
vi.mock('@/lib/meta/adsets', () => ({
  getAdSetStatus: async () => ({ id: 'adset1', name: 'x', status: 'ACTIVE', account_id: 'act_1' }),
}))

// 建广告后会去记「投的是哪条片」(lib/ads/creative-link)，它走 @/lib/supabase 而不是
// 下面那个 createClient 替身。这里把库打成空的：链接一条都认不出来 —— 正好用来证明
// 「认不出片子绝不能拖累建广告本身」，本文件的 adsAdded 断言仍然成立。
// 归属校验按多账户登记表 client_meta_ad_accounts 核对账户（也走 @/lib/supabase），
// 这里登记 act_1，与 CONFIG_ROW 一致。
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          not: async () => ({ data: [], error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            resolve(table === 'client_meta_ad_accounts'
              ? { data: [{ ad_account_id: 'act_1' }], error: null }
              : { data: [], error: null }),
        }),
      }),
      upsert: async () => ({ error: null }),
    }),
  },
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

// AD-SEC-1 归属校验用到的 clients 行——账户/主页跟 CONFIG_ROW 一致，
// 代表「配置行确实是这个客户的」这条happy path。
const CLIENT_ROW = { meta_ad_account_id: 'act_1', facebook_page_id: 'page1' }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === 'winner_reel_sync_config'
            ? { data: CONFIG_ROW, error: null }
            : table === 'clients'
              ? { data: CLIENT_ROW, error: null }
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
  // 认不出片子会大声 warn（设计如此），这里不让它污染测试输出。
  vi.spyOn(console, 'warn').mockImplementation(() => {})
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
