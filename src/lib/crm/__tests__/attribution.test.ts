/**
 * 来源归因的纯函数 —— 「拿不到就 NULL，绝不编」这条红线的测试。
 *
 * 为什么值得单独测：归因字段是「哪条广告有效」的分母。一个拼错的 platform、
 * 一个把字面量 'null' 当成真值存进去的 ad_id，都会让后续聚合永远漏掉这批人，
 * 而且错得很安静（没有报错、数字看起来还挺像）。
 */

import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTION_PLATFORMS,
  EMPTY_ATTRIBUTION,
  attributionColumns,
  attributionFromMetaLeadRow,
  attributionFromUtm,
  firstTouchColumns,
  isAttributed,
  normalisePlatform,
} from '../attribution'

describe('normalisePlatform：白名单外的一律当不知道', () => {
  it('认识的渠道原样返回', () => {
    for (const p of ATTRIBUTION_PLATFORMS) {
      expect(normalisePlatform(p)).toBe(p)
    }
  })

  it('大小写和空格不影响', () => {
    expect(normalisePlatform('  META ')).toBe('meta')
  })

  it('不认识的渠道返回 null，而不是原样存进去', () => {
    // 存一个 'tiktok' 进去，后续按 platform 聚合时它既不在 meta 也不在任何已知
    // 分组里 —— 这批人就永久地从分母里消失了。宁可 NULL，让人一眼看见缺口。
    expect(normalisePlatform('tiktok')).toBeNull()
    expect(normalisePlatform('facebook')).toBeNull()
  })

  it('空值 / 字面量 null 都当没有', () => {
    expect(normalisePlatform('')).toBeNull()
    expect(normalisePlatform('   ')).toBeNull()
    expect(normalisePlatform('null')).toBeNull()
    expect(normalisePlatform(undefined)).toBeNull()
    expect(normalisePlatform(null)).toBeNull()
  })
})

describe('isAttributed：全空的归因不该占掉 first-touch 的位置', () => {
  it('什么都没有 = 没归因', () => {
    expect(isAttributed(EMPTY_ATTRIBUTION)).toBe(false)
  })

  it('只有一个 ad_name 也算有归因（存量 CSV 就只有这一列）', () => {
    expect(isAttributed({ ...EMPTY_ATTRIBUTION, adName: 'CTS-FOOD-01' })).toBe(true)
  })

  it('只有 platform 也算 —— manual 录入就是这种', () => {
    expect(isAttributed({ ...EMPTY_ATTRIBUTION, platform: 'manual' })).toBe(true)
  })
})

describe('attributionColumns：contacts 和触点共用同一套列名', () => {
  it('六个字段一一对上 attr_ 列', () => {
    expect(
      attributionColumns({
        platform: 'meta',
        campaignId: 'c1',
        adsetId: 'as1',
        adId: 'ad1',
        adName: 'Reel A',
        creativeRef: 'draft-9',
      }),
    ).toEqual({
      attr_platform: 'meta',
      attr_campaign_id: 'c1',
      attr_adset_id: 'as1',
      attr_ad_id: 'ad1',
      attr_ad_name: 'Reel A',
      attr_creative_ref: 'draft-9',
    })
  })

  it('没有的字段是 null，不是 undefined（undefined 会被 supabase 丢掉，列就不会被显式清空）', () => {
    expect(attributionColumns(EMPTY_ATTRIBUTION).attr_ad_id).toBeNull()
  })
})

describe('firstTouchColumns：空归因不产生任何补丁', () => {
  it('全空 → {}，展开进 update 不会把已有归因清成 null', () => {
    expect(firstTouchColumns(EMPTY_ATTRIBUTION, '2026-07-30T00:00:00Z')).toEqual({})
  })

  it('有归因时带上首次归因时间', () => {
    const cols = firstTouchColumns(
      { ...EMPTY_ATTRIBUTION, platform: 'meta', adId: 'ad1' },
      '2026-07-30T00:00:00Z',
    )
    expect(cols.attr_ad_id).toBe('ad1')
    expect(cols.first_attributed_at).toBe('2026-07-30T00:00:00Z')
  })
})

describe('attributionFromMetaLeadRow：Meta lead 导出的一行', () => {
  it('platform 一定是 meta —— 这是调用方给的事实，不是从数据里猜的', () => {
    expect(attributionFromMetaLeadRow({}).platform).toBe('meta')
  })

  it('导出里没有的列 → null（CTS 存量导出只有 ad_name，没有 ad_id）', () => {
    const a = attributionFromMetaLeadRow({ ad_name: 'CTS-FOOD-01' })
    expect(a.adName).toBe('CTS-FOOD-01')
    expect(a.adId).toBeNull()
    expect(a.adsetId).toBeNull()
    expect(a.campaignId).toBeNull()
  })

  it('CSV 里的空串 / 字面量 null 不当成真值', () => {
    const a = attributionFromMetaLeadRow({ ad_id: '   ', adset_id: 'null', campaign_id: '' })
    expect(a.adId).toBeNull()
    expect(a.adsetId).toBeNull()
    expect(a.campaignId).toBeNull()
  })

  it('creative id：Meta 不给，只能由调用方传，不传就是 null', () => {
    expect(attributionFromMetaLeadRow({ ad_id: 'ad1' }).creativeRef).toBeNull()
    expect(attributionFromMetaLeadRow({ creative_ref: 'draft-9' }).creativeRef).toBe('draft-9')
  })

  it('全部 id 都齐时逐个落位', () => {
    const a = attributionFromMetaLeadRow({
      ad_id: 'ad1',
      adset_id: 'as1',
      campaign_id: 'c1',
      ad_name: 'Reel A',
    })
    expect([a.adId, a.adsetId, a.campaignId, a.adName]).toEqual(['ad1', 'as1', 'c1', 'Reel A'])
  })
})

describe('attributionFromUtm：官网表单只到 campaign 级', () => {
  it('FB / IG 的各种写法都收敛成 meta', () => {
    for (const s of ['facebook', 'fb', 'ig', 'instagram', 'meta', 'FaceBook']) {
      expect(attributionFromUtm({ utm_source: s }).platform).toBe('meta')
    }
  })

  it('Google Ads 收敛成 google', () => {
    expect(attributionFromUtm({ utm_source: 'googleads' }).platform).toBe('google')
  })

  it('邮件和转介绍按 medium 判', () => {
    expect(attributionFromUtm({ utm_medium: 'email' }).platform).toBe('email')
    expect(attributionFromUtm({ utm_medium: 'referral' }).platform).toBe('referral')
  })

  it('没有 utm = 自然进站，算 web，不算任何广告', () => {
    expect(attributionFromUtm({}).platform).toBe('web')
  })

  it('utm 只到 campaign —— ad / adset 一律 null，不假装有广告级归因', () => {
    const a = attributionFromUtm({ utm_source: 'facebook', utm_campaign: 'walnut-clearance' })
    expect(a.campaignId).toBe('walnut-clearance')
    expect(a.adId).toBeNull()
    expect(a.adsetId).toBeNull()
    expect(a.adName).toBeNull()
  })

  it('utm_content 当素材指纹用（落地页上是我们自己填的）', () => {
    expect(attributionFromUtm({ utm_content: 'reel-food-01' }).creativeRef).toBe('reel-food-01')
  })
})
