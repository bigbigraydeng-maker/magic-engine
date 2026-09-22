/**
 * 建广告那一刻必须记下「投的是哪条片」。
 *
 * 这是自动建广告的两条路径之一(另一条是 /meta-ads/boost-post)。如果哪次重构把
 * linkAdToCreative 那一步拿掉,这里立刻红 —— 而生产上的症状会是「一切正常,只是
 * 三个月后发现 attr_creative_ref 还是空的」,没有任何报错。整条断链就是这么来的。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAdFromPost = vi.fn()
const linkAdToCreative = vi.fn()

vi.mock('@/lib/meta/ads-manager', () => ({
  pauseAd: vi.fn(),
  createAdFromPost: (...a: unknown[]) => createAdFromPost(...a),
  listAdsInAdSet: async () => [],
  fetchCTRForAds: async () => ({}),
}))

vi.mock('@/lib/meta/page-posts', () => ({
  getPageAccessToken: async () => 'page-token',
  fetchPagePosts: async () => [{ id: 'p' }],
  rankVideoWinners: () => [{ postId: '1004101655665734', message: 'showroom reel', score: 99 }],
}))

vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: async () => 'user-token',
}))

// AD-SEC-1 归属校验(target_adset_id 那一半)要实拉 ad set——account_id 跟
// CONFIG_ROW.ad_account_id 一致，代表"配置的 ad set 确实是这个账户下的"。
vi.mock('@/lib/meta/adsets', () => ({
  getAdSetStatus: async () => ({ id: 'adset1', name: 'x', status: 'ACTIVE', account_id: 'act_1' }),
}))

vi.mock('@/lib/ads/creative-link', () => ({
  linkAdToCreative: (...a: unknown[]) => linkAdToCreative(...a),
}))

const CONFIG_ROW = {
  client_id: 'client-oztop',
  fb_page_id: '748077268383005',
  ad_account_id: 'act_1',
  target_adset_id: 'adset1',
  min_active_ads: 1,
  ad_min_age_days: 0,
  max_new_ads_per_run: 3,
  winner_min_score: 0,
  new_ad_default_status: 'PAUSED',
  blacklist_keywords: [],
  slack_webhook_url: null,
}

let syncLogInserts: Record<string, unknown>[] = []

// AD-SEC-1 归属校验用到的 clients 行——账户/主页跟 CONFIG_ROW 一致。
const CLIENT_ROW = { meta_ad_account_id: 'act_1', facebook_page_id: '748077268383005' }

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
        insert: async (row: Record<string, unknown>) => {
          if (table === 'winner_reel_sync_log') syncLogInserts.push(row)
          return { error: null }
        },
      }
      return builder
    },
  }),
}))

import { syncWinnerReels } from '../engine'

beforeEach(() => {
  vi.clearAllMocks()
  syncLogInserts = []
  createAdFromPost.mockResolvedValue({ adId: 'new-ad-1' })
  linkAdToCreative.mockResolvedValue({
    creativeRef: 'wo-1',
    creativeSource: 'content_work_order',
    linkMethod: 'published_post_id',
    unresolvedReason: null,
  })
})

describe('winner-reel-sync 建广告后记素材对应关系', () => {
  it('每建一条广告,就用刚拿到的 ad_id + 帖子 id 记一次', async () => {
    await syncWinnerReels('client-oztop')

    expect(createAdFromPost).toHaveBeenCalledTimes(1)
    expect(linkAdToCreative).toHaveBeenCalledTimes(1)
    expect(linkAdToCreative.mock.calls[0][0]).toMatchObject({
      clientId: 'client-oztop',
      adId: 'new-ad-1',
      postId: '1004101655665734',
      pageId: '748077268383005',
      createdBy: 'winner_reel_sync',
    })
  })

  it('认出来的片子进 SyncResult,跟着进审计日志 —— 不只是写进另一张表就算了', async () => {
    const res = await syncWinnerReels('client-oztop')

    expect(res.adsAdded).toEqual([
      { adId: 'new-ad-1', name: expect.any(String), postId: '1004101655665734', score: 99, creativeRef: 'wo-1' },
    ])
    expect(syncLogInserts[0].ads_added).toMatchObject([{ creativeRef: 'wo-1' }])
  })

  it('认不出是哪条片 → creativeRef 留空,广告照建(留白不阻断投放)', async () => {
    linkAdToCreative.mockResolvedValue({
      creativeRef: null,
      creativeSource: null,
      linkMethod: 'unresolved',
      unresolvedReason: '帖子 1004101655665734 不对应任何已发布的 ME 工单',
    })

    const res = await syncWinnerReels('client-oztop')

    expect(res.adsAdded).toHaveLength(1)
    expect(res.adsAdded[0].creativeRef).toBeNull()
  })
})
