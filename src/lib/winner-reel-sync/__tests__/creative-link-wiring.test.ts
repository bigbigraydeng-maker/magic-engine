/**
 * 扫描只出卡，不在这一步记「投的是哪条片」。
 * 对应关系改在确认之后、暂停广告建成之后才记。见 action-submission 的确认测试。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const linkAdToCreative = vi.fn()
const proposeWinnerBatch = vi.fn()

vi.mock('@/lib/meta/ads-manager', () => ({
  listAdsInAdSet: async () => [],
  fetchCTRForAds: async () => ({}),
}))

vi.mock('@/lib/meta/page-posts', () => ({
  getPageAccessToken: async () => 'page-token',
  fetchPagePosts: async () => [{ id: 'p' }],
  rankVideoWinners: () => [{ postId: 'post-1', message: 'showroom reel', score: 99 }],
}))

vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: async () => 'user-token',
}))

vi.mock('@/lib/meta/adsets', () => ({
  getAdSetStatus: async () => ({ id: 'adset1', name: 'x', status: 'ACTIVE', account_id: 'act_1' }),
}))

vi.mock('@/lib/ads/creative-link', () => ({
  linkAdToCreative: (...a: unknown[]) => linkAdToCreative(...a),
}))

vi.mock('../propose', () => ({
  proposeWinnerBatch: (...a: unknown[]) => proposeWinnerBatch(...a),
}))

const CONFIG_ROW = {
  client_id: 'client-1',
  fb_page_id: 'page-1',
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

const CLIENT_ROW = { meta_ad_account_id: 'act_1', facebook_page_id: 'page-1' }

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

beforeEach(() => {
  vi.clearAllMocks()
  proposeWinnerBatch.mockImplementation(async (args: { adds: Array<{ name: string; postId: string; score: number }> }) => ({
    added: args.adds.map((item) => ({ ...item, proposalRunId: 'run-1', creativeRef: null, adId: '' })),
    paused: [],
    guards: [],
  }))
})

describe('winner-reel scan does not link a creative', () => {
  it('出卡时还没有广告，也不记片子', async () => {
    const res = await syncWinnerReels('client-1')
    expect(linkAdToCreative).not.toHaveBeenCalled()
    expect(res.adsAdded).toMatchObject([
      { name: expect.any(String), postId: 'post-1', score: 99, proposalRunId: 'run-1', creativeRef: null, adId: '' },
    ])
  })
})
