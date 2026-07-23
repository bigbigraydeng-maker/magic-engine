// clients.factory_config 投影/合并测试。
//
// 重点防两件事:
// ① 合并把 UI 不认识的 key 抹掉(factory_goal_note 这类),这种丢失静默无声、事后极难查。
// ② 把「只填一半」「填错类型」的发布目标存进去 —— publish-worker 会 markFailed,
//    但那是几天后跑 cron 时才发现,配的时候就该拦住。

import { describe, expect, it } from 'vitest'
import { mergeFactoryConfig, projectFactoryConfig } from './client-config'

const CTS_LIKE = {
  factory_goal_id: 'ef92d878-c283-4a1c-be7d-1462c8c4a83c',
  factory_goal_note: 'CTS social 片服务品牌搜索量提升(诸葛亮圈定 B0)',
  allow_b_track_landmark_ads: true,
}

describe('projectFactoryConfig — 投影', () => {
  it('空配置 → 全 null / false,不抛', () => {
    expect(projectFactoryConfig({})).toEqual({
      publish_target: null, factory_goal_id: null, verified_offer: null,
      allow_b_track_landmark_ads: false, auto_order_enabled: false,
    })
    expect(projectFactoryConfig(null).publish_target).toBeNull()
  })

  it('🔴 只填一半的发布目标 → 投影成 null(等于没配,UI 才会提示「缺发布目标」)', () => {
    expect(projectFactoryConfig({ publish_target: { platform: 'facebook' } }).publish_target).toBeNull()
    expect(projectFactoryConfig({ publish_target: { page_id: '123456' } }).publish_target).toBeNull()
  })

  it('豁免开关严格取 true,truthy 值不算', () => {
    expect(projectFactoryConfig({ allow_b_track_landmark_ads: 'yes' }).allow_b_track_landmark_ads).toBe(false)
    expect(projectFactoryConfig({ allow_b_track_landmark_ads: 1 }).allow_b_track_landmark_ads).toBe(false)
    expect(projectFactoryConfig({ allow_b_track_landmark_ads: true }).allow_b_track_landmark_ads).toBe(true)
  })

  it('促销只有截止日没有价格 → null(没价格的促销钩子没意义)', () => {
    expect(projectFactoryConfig({ verified_offer: { offer_expiry: '31 July' } }).verified_offer).toBeNull()
  })
})

describe('mergeFactoryConfig — 合并语义', () => {
  it('🔴 只动 body 里出现过的 key,不认识的 key 原样保留', () => {
    const r = mergeFactoryConfig(CTS_LIKE, { allow_b_track_landmark_ads: false })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 整体替换的话这两个会被抹掉,而且不会有任何报错
    expect(r.config.factory_goal_note).toBe(CTS_LIKE.factory_goal_note)
    expect(r.config.factory_goal_id).toBe(CTS_LIKE.factory_goal_id)
    expect(r.config.allow_b_track_landmark_ads).toBe(false)
  })

  it('body 里没出现的字段一律不碰(空 body = 原样返回)', () => {
    const r = mergeFactoryConfig(CTS_LIKE, {})
    expect(r.ok && r.config).toEqual(CTS_LIKE)
  })

  it('显式传 null → 删掉该 key(不是留个 null 值)', () => {
    const r = mergeFactoryConfig({ ...CTS_LIKE, verified_offer: { price_from: '$35.50/m²' } }, { verified_offer: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect('verified_offer' in r.config).toBe(false)
    expect(r.config.factory_goal_note).toBe(CTS_LIKE.factory_goal_note)
  })

  it('促销价清空 → 视同下架删掉(留着会继续被写进文案钩子)', () => {
    const r = mergeFactoryConfig(
      { verified_offer: { price_from: '$35.50/m²', offer_expiry: '31 July' } },
      { verified_offer: { price_from: '   ', offer_expiry: '31 July' } },
    )
    expect(r.ok && 'verified_offer' in r.config).toBe(false)
  })
})

describe('mergeFactoryConfig — 发布目标校验', () => {
  const ok = (page_id: string) => mergeFactoryConfig({}, { publish_target: { platform: 'facebook', page_id } })

  it('合法主页 ID → 存下', () => {
    const r = ok('1616575215312482')
    expect(r.ok && r.config.publish_target).toEqual({ platform: 'facebook', page_id: '1616575215312482' })
  })

  it('🔴 主页 ID 带 act_ 前缀 → 拒(广告账户 ID 填成主页 ID,真踩过)', () => {
    const r = ok('act_1616575215312482')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('纯数字')
  })

  it('🔴 填成主页网址 → 拒', () => {
    const r = ok('https://www.facebook.com/CTSTOURS/')
    expect(r.ok).toBe(false)
  })

  it('只填平台不填主页 ID → 拒(存进去发布必失败)', () => {
    const r = mergeFactoryConfig({}, { publish_target: { platform: 'facebook' } })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('只填一半')
  })

  it('🔴 publer 等无 adapter 的平台 → 拒(配了也只会 no_adapter 失败)', () => {
    const r = mergeFactoryConfig({}, { publish_target: { platform: 'publer', page_id: '123456' } })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('facebook')
  })
})

describe('mergeFactoryConfig — Goal 与开关', () => {
  it('合法 uuid → 存下并回传待查 id(归属由路由层查库确认)', () => {
    const id = 'ef92d878-c283-4a1c-be7d-1462c8c4a83c'
    const r = mergeFactoryConfig({}, { factory_goal_id: id })
    expect(r.ok && r.config.factory_goal_id).toBe(id)
    expect(r.ok && r.goalIdToVerify).toBe(id)
  })

  it('非 uuid → 拒,且不回传待查 id', () => {
    const r = mergeFactoryConfig({}, { factory_goal_id: 'latest' })
    expect(r.ok).toBe(false)
  })

  it('清空 Goal → 删 key,且不触发归属查库', () => {
    const r = mergeFactoryConfig(CTS_LIKE, { factory_goal_id: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect('factory_goal_id' in r.config).toBe(false)
    expect(r.goalIdToVerify).toBeNull()
  })

  it('🔴 豁免开关传非布尔 → 拒(护栏 6 的开关,不能被字符串 "false" 误开)', () => {
    expect(mergeFactoryConfig({}, { allow_b_track_landmark_ads: 'false' }).ok).toBe(false)
    expect(mergeFactoryConfig({}, { allow_b_track_landmark_ads: 1 }).ok).toBe(false)
  })
})

describe('mergeFactoryConfig — 自动排产开关(花钱闸)', () => {
  const WITH_TARGET = { publish_target: { platform: 'facebook', page_id: '1616575215312482' } }

  it('🔴 没配发布主页就想开自动排产 → 拒(片子照做照花钱,做完无处可发)', () => {
    const r = mergeFactoryConfig({}, { auto_order_enabled: true })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('发布主页')
  })

  it('已配发布主页 → 允许开', () => {
    const r = mergeFactoryConfig(WITH_TARGET, { auto_order_enabled: true })
    expect(r.ok && r.config.auto_order_enabled).toBe(true)
  })

  it('同一次请求里先配主页再开开关 → 允许(读的是合并后的状态,不是旧状态)', () => {
    const r = mergeFactoryConfig({}, { ...WITH_TARGET, auto_order_enabled: true })
    expect(r.ok && r.config.auto_order_enabled).toBe(true)
  })

  it('关掉开关不需要发布主页(随时能踩刹车)', () => {
    const r = mergeFactoryConfig({ auto_order_enabled: true }, { auto_order_enabled: false })
    expect(r.ok && r.config.auto_order_enabled).toBe(false)
  })

  it('🔴 传非布尔 → 拒(字符串 "true" 不能开这个花钱开关)', () => {
    expect(mergeFactoryConfig(WITH_TARGET, { auto_order_enabled: 'true' }).ok).toBe(false)
  })

  it('默认关:投影里没这个 key 时是 false', () => {
    expect(projectFactoryConfig({}).auto_order_enabled).toBe(false)
    expect(projectFactoryConfig({ auto_order_enabled: 'true' }).auto_order_enabled).toBe(false)
  })
})
