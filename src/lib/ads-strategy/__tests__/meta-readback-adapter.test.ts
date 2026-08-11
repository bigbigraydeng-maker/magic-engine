import { describe, it, expect } from 'vitest'
import { adaptMetaAdSet, nameClaimsRetargeting, type RawMetaAdSet } from '../meta-readback-adapter'
import { checkLaunch } from '../launch-readback'

describe('adaptMetaAdSet —— 按真实 Meta 形状，不按猜的', () => {
  it('🔴 advantage_audience 是 0/1 数字，不是布尔', () => {
    const on = adaptMetaAdSet(
      { id: 'A', targeting: { targeting_automation: { advantage_audience: 1 } } }, [])
    const off = adaptMetaAdSet(
      { id: 'A', targeting: { targeting_automation: { advantage_audience: 0 } } }, [])
    expect(on.adSet.targeting.advantageAudience).toBe(true)
    expect(off.adSet.targeting.advantageAudience).toBe(false)
  })

  it('🔴 字段缺失 → undefined，**不是 false**（缺失不等于关闭）', () => {
    const r = adaptMetaAdSet({ id: 'A', targeting: {} }, [])
    expect(r.adSet.targeting.advantageAudience).toBeUndefined()
    expect(r.adSet.targeting.customAudienceRelaxed).toBeUndefined()
  })

  it('🔴 没有受众时 custom_audiences 整个字段不存在 → 归一成空数组', () => {
    const r = adaptMetaAdSet({ id: 'A', targeting: {} }, [])
    expect(r.adSet.targeting.customAudienceIds).toEqual([])
  })

  it('有受众时取 id', () => {
    const r = adaptMetaAdSet(
      { id: 'A', targeting: { custom_audiences: [{ id: 'X1', name: '暖池' }, { id: 'X2' }] } }, [])
    expect(r.adSet.targeting.customAudienceIds).toEqual(['X1', 'X2'])
  })

  it('Meta 自动补挂的相似人群会被摘出来', () => {
    const r = adaptMetaAdSet(
      { id: 'A', targeting: { expanded_implicit_custom_audiences: [{ id: 'LAL1' }] } }, [])
    expect(r.adSet.targeting.implicitLookalikeIds).toEqual(['LAL1'])
  })

  it('地区名从 regions / cities / countries 三处一起取', () => {
    const r = adaptMetaAdSet({
      id: 'A',
      targeting: {
        geo_locations: {
          regions: [{ name: 'Auckland Region' }],
          cities: [{ name: 'Wellington' }],
          countries: ['NZ'],
        },
      },
    }, [])
    expect(r.adSet.targeting.geoNames).toEqual(['Auckland Region', 'Wellington', 'NZ'])
  })

  it('空文案会被滤掉，不占位', () => {
    const r = adaptMetaAdSet({ id: 'A' }, [
      { adId: 'ad1', adName: '广告一', texts: ['正文', '', '   ', null, undefined, '标题'] },
    ])
    expect(r.adSet.creatives[0].buyerFacingText).toEqual(['正文', '标题'])
  })

  it('名字缺失时退回用 id，不显示 undefined', () => {
    const r = adaptMetaAdSet({ id: 'AS1' }, [{ adId: 'ad1', texts: ['x'] }])
    expect(r.adSet.adSetName).toBe('AS1')
    expect(r.adSet.creatives[0].adName).toBe('ad1')
  })
})

describe('nameClaimsRetargeting —— 启发式，宁可宽松命中', () => {
  it.each([
    '30 Kiteroa · 私约看房 · 暖池重定向',
    'OZ-REACH-Warmpool-BNE-GC',
    'Retargeting - Warm - 20260707',
    '30 Kiteroa · 表单 · 暖池重定向',
  ])('「%s」判为重定向', (n) => expect(nameClaimsRetargeting(n)).toBe(true))

  it.each([
    '30 Kiteroa · 三语专测 · Auckland 全域 · FB only',
    '攒池子 v2 · Auckland 全域 · FB · 25-65',
    '',
  ])('「%s」不判为重定向', (n) => expect(nameClaimsRetargeting(n)).toBe(false))

  it('显式声明覆盖名字启发式', () => {
    const r = adaptMetaAdSet({ id: 'A', name: '看起来不像重定向' }, [], { isRetargeting: true })
    expect(r.claimsRetargeting).toBe(true)
  })
})

// ── 回归：喂 2026-08-04 账户里真实的两个广告组 ────────────────────────
describe('回归：真实广告组回读', () => {
  const POOL: RawMetaAdSet = {
    id: '120252018586810589',
    name: '攒池子 v2 · Auckland 全域 · FB · 25-65',
    optimization_goal: 'THRUPLAY',
    targeting: {
      geo_locations: { regions: [{ name: 'Auckland Region' }] },
      targeting_automation: { advantage_audience: 0 },
      // 真实返回里 custom_audiences / targeting_relaxation_types 都不存在
    },
  }

  const FORM: RawMetaAdSet = {
    id: '120251954036450589',
    name: '30 Kiteroa · 表单 · 暖池重定向',
    optimization_goal: 'LEAD_GENERATION',
    targeting: {
      geo_locations: { regions: [{ name: 'Auckland Region' }] },
      targeting_relaxation_types: { custom_audience: 0 },
      targeting_automation: { advantage_audience: 0 },
      // 同样没有 custom_audiences —— 名字说重定向，实际一个名单都没挂
    },
  }

  it('攒池组：非重定向、非私信、地区对得上 → 放行', () => {
    const r = checkLaunch(adaptMetaAdSet(POOL, [
      { adId: 'a1', adName: '攒池 · 中文', texts: ['Rangitoto College 学区 · 全新 4 房独立屋'] },
    ], { expectedGeo: 'Auckland' }))
    expect(r.safeToActivate).toBe(true)
    expect(r.findings).toHaveLength(0)
  })

  it('🔴 表单组：名字写着暖池重定向，但一个受众名单都没挂 → 拦下', () => {
    const r = checkLaunch(adaptMetaAdSet(FORM, [
      { adId: 'a2', adName: '表单 · 中文', texts: ['Rangitoto 学区 · 全新四房'] },
    ], { expectedGeo: 'Auckland' }))
    expect(r.safeToActivate).toBe(false)
    expect(r.findings.map(f => f.code)).toContain('retargeting_without_audience')
  })

  it('读不到放宽设置时如实提醒，不假装安全', () => {
    const noRelax: RawMetaAdSet = { ...FORM, targeting: { ...FORM.targeting, targeting_relaxation_types: undefined } }
    const r = checkLaunch(adaptMetaAdSet(noRelax, [{ adId: 'a', texts: ['x'] }]))
    expect(r.findings.map(f => f.code)).toContain('retargeting_relaxation_unknown')
  })
})
