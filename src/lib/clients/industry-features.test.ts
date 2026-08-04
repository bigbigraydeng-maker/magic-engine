import { describe, it, expect } from 'vitest'
import { normaliseIndustry, hasIndustryFeature, industryFeatureFlags } from './industry-features'

describe('normaliseIndustry', () => {
  it('下划线写法能认出来 —— 库里存的就是 real_estate', () => {
    expect(normaliseIndustry('real_estate')).toBe('real estate')
  })

  it('长破折号与斜杠也归一（库里有 Travel — Tour Operator、SPC/hybrid）', () => {
    expect(normaliseIndustry('Travel — Tour Operator')).toBe('travel tour operator')
    expect(normaliseIndustry('SPC/hybrid flooring wholesale (B2B trade)'))
      .toBe('spc hybrid flooring wholesale (b2b trade)')
  })

  it('空值不炸', () => {
    expect(normaliseIndustry(null)).toBe('')
    expect(normaliseIndustry(undefined)).toBe('')
    expect(normaliseIndustry('   ')).toBe('')
  })
})

describe('hasIndustryFeature —— 库里的真实取值', () => {
  it('🔴 中旅看不到「房子」（PM 2026-08-03 点名的 bug）', () => {
    expect(hasIndustryFeature('travel', 'listings')).toBe(false)
    expect(hasIndustryFeature('Travel — Tour Operator', 'listings')).toBe(false)
  })

  it('🔴 建材客户看不到「行程单」（反向同样错）', () => {
    expect(hasIndustryFeature('flooring', 'tailor_made')).toBe(false)
    expect(hasIndustryFeature('SPC/hybrid flooring wholesale (B2B trade)', 'tailor_made')).toBe(false)
  })

  it('地产客户看得到「房子」', () => {
    expect(hasIndustryFeature('real_estate', 'listings')).toBe(true)
  })

  it('旅游客户看得到「行程单」', () => {
    expect(hasIndustryFeature('travel', 'tailor_made')).toBe(true)
    expect(hasIndustryFeature('Travel — Tour Operator', 'tailor_made')).toBe(true)
  })

  it('🔴 行业为空 → 一个都不给（默认隐藏，不是默认显示）', () => {
    // 库里 15 个客户行业是空的。默认显示就等于把地产按钮塞给所有人 —— 正是现在的 bug
    for (const f of ['listings', 'projects', 'tailor_made'] as const) {
      expect(hasIndustryFeature(null, f)).toBe(false)
      expect(hasIndustryFeature('', f)).toBe(false)
      expect(hasIndustryFeature('Healthcare — Physiotherapy', f)).toBe(false)
    }
  })

  it('🔴 「楼盘」是海外地产版独有工具 —— 只给地产,别的行业一律看不到', () => {
    expect(hasIndustryFeature('real_estate', 'projects')).toBe(true)
    expect(hasIndustryFeature('travel', 'projects')).toBe(false)
    expect(hasIndustryFeature('flooring', 'projects')).toBe(false)
    expect(hasIndustryFeature(null, 'projects')).toBe(false)
  })

  it('中文行业也认', () => {
    expect(hasIndustryFeature('房地产中介', 'listings')).toBe(true)
    expect(hasIndustryFeature('旅游运营商', 'tailor_made')).toBe(true)
  })

  it('不会互相串味 —— 地产不给行程单，旅游不给房子', () => {
    expect(hasIndustryFeature('real_estate', 'tailor_made')).toBe(false)
    expect(hasIndustryFeature('travel', 'listings')).toBe(false)
  })
})

describe('industryFeatureFlags', () => {
  it('一次拿全部开关', () => {
    expect(industryFeatureFlags('real_estate')).toEqual({ listings: true, projects: true, tailor_made: false })
    expect(industryFeatureFlags('travel')).toEqual({ listings: false, projects: false, tailor_made: true })
    expect(industryFeatureFlags(null)).toEqual({ listings: false, projects: false, tailor_made: false })
  })
})
