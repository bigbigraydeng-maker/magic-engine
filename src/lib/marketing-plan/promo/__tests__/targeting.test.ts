import { describe, expect, it } from 'vitest'
import { parsePromoSpec, type PromoSpec } from '../spec'
import { newAdsTargeting, withAdsTargeting, withTargetingAge } from '../form'
import { promoContentHash } from '../content-hash'

function adsStep(settings: Record<string, unknown> = {}) {
  return {
    id: 'step-1',
    kind: 'ads_campaign' as const,
    settings: {
      ad_account_id: 'act_1',
      daily_budget_cents: 2000,
      audience_ref: 'aud-1',
      creative_refs: [],
      placements: [],
      paused_ranges: [],
      ...settings,
    },
  }
}

function spec(stepSettings: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'promo_v1',
    goal_id: 'goal-1',
    phases: [{
      id: 'p1', name: '阶段 1', start_date: '2026-11-01', end_date: '2026-11-14',
      steps: [adsStep(stepSettings)],
    }],
    checks: [],
  }
}

const NZ55 = { countries: ['NZ'], city_keys: [], excluded_audience_refs: [], age_min: 55 }

describe('结构化定向能存下来', () => {
  it('国家 + 年龄下限能解析', () => {
    const r = parsePromoSpec(spec({ audience_ref: '', targeting: NZ55 }))
    if (!r.ok) throw new Error(`应该解析成功：${JSON.stringify(r.issues)}`)
    const t = r.spec.phases[0].steps[0].kind === 'ads_campaign'
      ? r.spec.phases[0].steps[0].settings.targeting
      : undefined
    expect(t?.countries).toEqual(['NZ'])
    expect(t?.age_min).toBe(55)
  })

  it('旧计划没有 targeting 这个键，解析后也不许凭空多出来', () => {
    const r = parsePromoSpec(spec())
    if (!r.ok) throw new Error('应该解析成功')
    const s = r.spec.phases[0].steps[0]
    if (s.kind !== 'ads_campaign') throw new Error('类型不对')
    expect('targeting' in s.settings).toBe(false)
  })

  it('国家码小写会被拒', () => {
    const r = parsePromoSpec(spec({ targeting: { ...NZ55, countries: ['nz'] } }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.includes('countries'))).toBe(true)
  })

  it('年龄下限低于 18 会被拒', () => {
    const r = parsePromoSpec(spec({ targeting: { ...NZ55, age_min: 16 } }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.includes('age_min'))).toBe(true)
  })
})

describe('二选一：受众编号 或 投放地区', () => {
  it('两样都空 → 被拒，而且说清是哪一步', () => {
    const r = parsePromoSpec(spec({ audience_ref: '' }))
    if (r.ok) throw new Error('应该被拒')
    const issue = r.issues.find(i => i.path.endsWith('settings.audience_ref'))
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('投放地区')
  })

  it('受众编号只填了空格也算空', () => {
    const r = parsePromoSpec(spec({ audience_ref: '   ' }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.endsWith('settings.audience_ref'))).toBe(true)
  })

  it('只填投放地区（受众留空）→ 通过', () => {
    const r = parsePromoSpec(spec({ audience_ref: '', targeting: NZ55 }))
    if (!r.ok) throw new Error(`应该通过：${JSON.stringify(r.issues)}`)
    expect(r.spec.phases).toHaveLength(1)
  })

  it('加了 targeting 但国家和城市都空 → 还是等于没说投给谁', () => {
    const r = parsePromoSpec(spec({ audience_ref: '', targeting: newAdsTargeting() }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.endsWith('settings.audience_ref'))).toBe(true)
  })

  it('只填受众编号（不填投放地区）→ 通过', () => {
    const r = parsePromoSpec(spec())
    if (!r.ok) throw new Error('应该通过')
    expect(r.spec.phases).toHaveLength(1)
  })
})

describe('国家和城市不能同时填', () => {
  it('同时填 → 被拒，并说清城市范围会失效', () => {
    const r = parsePromoSpec(spec({ targeting: { ...NZ55, city_keys: ['city-123'] } }))
    if (r.ok) throw new Error('应该被拒')
    const issue = r.issues.find(i => i.path.endsWith('targeting.city_keys'))
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('并集')
  })

  it('只填城市 → 通过', () => {
    const r = parsePromoSpec(spec({ audience_ref: '', targeting: { countries: [], city_keys: ['city-123'], excluded_audience_refs: [] } }))
    if (!r.ok) throw new Error(`应该通过：${JSON.stringify(r.issues)}`)
    expect(r.spec.phases).toHaveLength(1)
  })
})

describe('年龄上下限', () => {
  it('下限比上限大 → 被拒', () => {
    const r = parsePromoSpec(spec({ targeting: { ...NZ55, age_min: 60, age_max: 30 } }))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.some(i => i.path.endsWith('targeting.age_max'))).toBe(true)
  })
})

describe('删除时必须真把键删掉（否则会污染内容指纹）', () => {
  it('withAdsTargeting 传 undefined → settings 里没有 targeting 这个键', () => {
    const withT = withAdsTargeting(adsStep(), newAdsTargeting())
    expect('targeting' in withT.settings).toBe(true)
    const removed = withAdsTargeting(withT, undefined)
    expect('targeting' in removed.settings).toBe(false)
  })

  it('withTargetingAge 传 undefined → 没有 age_min 这个键', () => {
    const t = withTargetingAge(newAdsTargeting(), 'age_min', 55)
    expect(t.age_min).toBe(55)
    const cleared = withTargetingAge(t, 'age_min', undefined)
    expect('age_min' in cleared).toBe(false)
  })

  it('⭐ 加上投放范围又删掉，内容指纹必须跟从没填过完全一样', () => {
    const base = parsePromoSpec(spec())
    if (!base.ok) throw new Error('基线应该解析成功')
    const neverHad = promoContentHash(base.spec)

    const step0 = base.spec.phases[0].steps[0]
    if (step0.kind !== 'ads_campaign') throw new Error('类型不对')
    const added = withAdsTargeting(step0, newAdsTargeting())
    const removed = withAdsTargeting(added, undefined)
    const afterRoundTrip: PromoSpec = {
      ...base.spec,
      phases: [{ ...base.spec.phases[0], steps: [removed] }],
    }
    expect(promoContentHash(afterRoundTrip)).toBe(neverHad)
  })

  it('⭐ 年龄填了又清空，内容指纹必须跟从没填过完全一样', () => {
    const withPlace = parsePromoSpec(spec({ audience_ref: '', targeting: { countries: ['NZ'], city_keys: [], excluded_audience_refs: [] } }))
    if (!withPlace.ok) throw new Error('基线应该解析成功')
    const neverHadAge = promoContentHash(withPlace.spec)

    const step0 = withPlace.spec.phases[0].steps[0]
    if (step0.kind !== 'ads_campaign') throw new Error('类型不对')
    const t0 = step0.settings.targeting
    if (t0 === undefined) throw new Error('应该有投放范围')
    const cleared = withAdsTargeting(step0, withTargetingAge(withTargetingAge(t0, 'age_min', 55), 'age_min', undefined))
    const after: PromoSpec = {
      ...withPlace.spec,
      phases: [{ ...withPlace.spec.phases[0], steps: [cleared] }],
    }
    expect(promoContentHash(after)).toBe(neverHadAge)
  })

  it('真填了投放范围，指纹**必须**变 —— 否则等于改了钱怎么花却没人知道', () => {
    const base = parsePromoSpec(spec())
    if (!base.ok) throw new Error('基线应该解析成功')
    const withTargeting = parsePromoSpec(spec({ targeting: NZ55 }))
    if (!withTargeting.ok) throw new Error('应该解析成功')
    expect(promoContentHash(withTargeting.spec)).not.toBe(promoContentHash(base.spec))
  })
})
