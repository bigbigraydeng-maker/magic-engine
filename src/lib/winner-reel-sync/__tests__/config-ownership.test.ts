/**
 * AD-SEC-1：`winner_reel_sync_config` 这张表自己没有归属校验。如果一行配错/
 * 串成了别的客户的 ad_account_id / fb_page_id，engine 会往错的客户账户里
 * 建广告、暂停错客户的广告。这里守的是「读到配置之后、碰 Meta 之前」这道闸。
 *
 * 2026-09-14 ADS-IMPACT-P0-1：账户改按多账户登记表 `client_meta_ad_accounts` 核对
 * （CTS 个人号 act_2775766642787274 + 官方账户 act_2202695063810470 两行，生产实查）。
 * 假 supabase 按表建模：engine 自己的客户端与 `@/lib/supabase`（campaign-ownership 用）
 * 读同一份表数据。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAdFromPost = vi.fn()
const pauseAd = vi.fn()

vi.mock('@/lib/meta/ads-manager', () => ({
  pauseAd: (...a: unknown[]) => pauseAd(...a),
  createAdFromPost: (...a: unknown[]) => createAdFromPost(...a),
  listAdsInAdSet: async () => [],
  fetchCTRForAds: async () => ({}),
}))

vi.mock('@/lib/meta/page-posts', () => ({
  getPageAccessToken: async () => 'page-token',
  fetchPagePosts: async () => [{ id: 'p' }],
  rankVideoWinners: () => [],
}))

vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: async () => 'user-token' }))
vi.mock('@/lib/meta/client', () => ({ getCampaignDetails: async () => null }))
vi.mock('@/lib/ads/creative-link', () => ({ linkAdToCreative: async () => ({ creativeRef: null, creativeSource: null, linkMethod: 'unresolved', unresolvedReason: null }) }))

let adSetAccountId: string | null = 'act_111'
vi.mock('@/lib/meta/adsets', () => ({
  getAdSetStatus: async () => (adSetAccountId ? { id: 'adset1', name: 'x', status: 'ACTIVE', account_id: adSetAccountId } : null),
}))

let configRow: Record<string, unknown> = {}
const baseConfig = {
  client_id: 'client-a',
  fb_page_id: 'page-of-client-a',
  ad_account_id: 'act_111',
  target_adset_id: 'adset1',
  min_active_ads: 1,
  ad_min_age_days: 0,
  max_new_ads_per_run: 3,
  winner_min_score: 0,
  new_ad_default_status: 'PAUSED',
  blacklist_keywords: [],
  slack_webhook_url: null,
}

let clientRow: Record<string, unknown> | null = null
let accountRows: Array<{ ad_account_id: string }> = []
let accountRegistryError: { message: string } | null = null
let syncLogInserts: Record<string, unknown>[] = []

function fakeDb() {
  return {
    from: (table: string) => {
      const listResult = () =>
        table === 'client_meta_ad_accounts'
          ? { data: accountRegistryError ? null : accountRows, error: accountRegistryError }
          : { data: [], error: null }
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === 'winner_reel_sync_config'
            ? { data: configRow, error: null }
            : table === 'clients'
              ? { data: clientRow, error: null }
              : { data: null, error: null },
        then: (resolve: (v: unknown) => unknown) => resolve(listResult()),
        insert: async (row: Record<string, unknown>) => {
          if (table === 'winner_reel_sync_log') syncLogInserts.push(row)
          return { error: null }
        },
      }
      return builder
    },
  }
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: fakeDb() }))

import { syncWinnerReels } from '../engine'

beforeEach(() => {
  vi.clearAllMocks()
  syncLogInserts = []
  configRow = { ...baseConfig }
  clientRow = { meta_ad_account_id: 'act_111', facebook_page_id: 'page-of-client-a' }
  accountRows = [{ ad_account_id: 'act_111' }]
  accountRegistryError = null
  adSetAccountId = 'act_111'
})

describe('syncWinnerReels — 配置归属校验', () => {
  it('账户/主页都对得上 → 正常往下走，不被拦', async () => {
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('ok')
  })

  it('配置行的广告账户不在客户登记的任何账户里 → 拒绝，不碰 Meta', async () => {
    accountRows = [{ ad_account_id: 'act_999_别家客户' }]
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('error')
    expect(r.errorMessage).toContain('广告账户')
    expect(createAdFromPost).not.toHaveBeenCalled()
    expect(pauseAd).not.toHaveBeenCalled()
    expect(syncLogInserts[0]).toMatchObject({ status: 'error' })
  })

  it('配置行的主页跟 clients 表登记的不一致 → 拒绝，不碰 Meta', async () => {
    clientRow = { meta_ad_account_id: 'act_111', facebook_page_id: 'page-of-someone-else' }
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('error')
    expect(r.errorMessage).toContain('主页')
    expect(createAdFromPost).not.toHaveBeenCalled()
  })

  it('clients 表查不到这个客户 → fail closed，不是默认放行', async () => {
    clientRow = null
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('error')
    expect(createAdFromPost).not.toHaveBeenCalled()
  })

  it('act_ 前缀不一致但数字一样 → 算匹配（归一化比较，不是字符串死板相等）', async () => {
    accountRows = [{ ad_account_id: '111' }] // 无 act_ 前缀
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('ok')
  })

  it('🔴 Codex 复审 P1 必改：账户/主页都对得上，但 target_adset_id 实查出来挂在别的账户下 → 拒绝', async () => {
    adSetAccountId = 'act_999_别的账户'
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('error')
    expect(r.errorMessage).toContain('target_adset_id')
    expect(createAdFromPost).not.toHaveBeenCalled()
    expect(pauseAd).not.toHaveBeenCalled()
  })

  it('target_adset_id 在 Meta 那边读不出来 → fail closed，不是当成"没关系继续跑"', async () => {
    adSetAccountId = null
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('error')
    expect(createAdFromPost).not.toHaveBeenCalled()
  })

  // ── 多账户（ADS-IMPACT-P0-1）──────────────────────────────────────────
  describe('多账户客户（按 CTS 生产登记形状：主账户 + 官方账户）', () => {
    beforeEach(() => {
      clientRow = { meta_ad_account_id: 'act_2775766642787274', facebook_page_id: 'page-of-client-a' }
      accountRows = [{ ad_account_id: 'act_2775766642787274' }, { ad_account_id: 'act_2202695063810470' }]
    })

    it('配置与广告组都在官方账户（非 clients.meta_ad_account_id）→ 放行，不再误拦', async () => {
      configRow = { ...baseConfig, ad_account_id: 'act_2202695063810470' }
      adSetAccountId = 'act_2202695063810470'
      const r = await syncWinnerReels('client-a')
      expect(r.status).toBe('ok')
    })

    it('配置写官方账户，广告组却在个人号 → 拒绝（广告组必须在配置的那个账户里）', async () => {
      configRow = { ...baseConfig, ad_account_id: 'act_2202695063810470' }
      adSetAccountId = 'act_2775766642787274'
      const r = await syncWinnerReels('client-a')
      expect(r.status).toBe('error')
      expect(r.errorMessage).toContain('target_adset_id')
      expect(createAdFromPost).not.toHaveBeenCalled()
    })

    it('账户登记表查询出错 → fail closed，不退回单账户老字段放行', async () => {
      configRow = { ...baseConfig, ad_account_id: 'act_2775766642787274' }
      adSetAccountId = 'act_2775766642787274'
      accountRegistryError = { message: 'boom' }
      const r = await syncWinnerReels('client-a')
      expect(r.status).toBe('error')
      expect(r.errorMessage).toContain('广告账户登记')
      expect(createAdFromPost).not.toHaveBeenCalled()
    })
  })

  describe('共用广告账户（G15：同一账户登记给两个客户）', () => {
    it('账户核对放行，但主页属于另一个客户 → 仍被主页闸拒绝', async () => {
      accountRows = [{ ad_account_id: 'act_1260456876069575' }]
      configRow = { ...baseConfig, ad_account_id: 'act_1260456876069575', fb_page_id: 'page-of-roman' }
      clientRow = { meta_ad_account_id: 'act_1260456876069575', facebook_page_id: 'page-of-kiteroa' }
      adSetAccountId = 'act_1260456876069575'
      const r = await syncWinnerReels('client-a')
      expect(r.status).toBe('error')
      expect(r.errorMessage).toContain('主页')
      expect(createAdFromPost).not.toHaveBeenCalled()
    })

    it('主页为空的客户 → 拒绝', async () => {
      accountRows = [{ ad_account_id: 'act_1260456876069575' }]
      configRow = { ...baseConfig, ad_account_id: 'act_1260456876069575' }
      clientRow = { meta_ad_account_id: 'act_1260456876069575', facebook_page_id: null }
      adSetAccountId = 'act_1260456876069575'
      const r = await syncWinnerReels('client-a')
      expect(r.status).toBe('error')
      expect(createAdFromPost).not.toHaveBeenCalled()
    })
  })
})
