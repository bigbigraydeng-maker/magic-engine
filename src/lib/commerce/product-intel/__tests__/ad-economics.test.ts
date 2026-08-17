import { describe, it, expect } from 'vitest'
import {
  breakEvenCacNzd,
  breakEvenRoas,
  estimateCacNzd,
  requiredConversionRatePct,
  unitEconomicsAfterAds,
} from '../ad-economics'

/** 便携榨汁机 @ NZ$34.90，毛利来自 landed-cost 实算。 */
const CASE = { retailPriceNzd: 34.9, grossProfitNzd: 13.59 }

describe('盈亏平衡线', () => {
  it('平衡 ROAS = 标价 ÷ 毛利', () => {
    expect(breakEvenRoas(CASE)!).toBeCloseTo(2.57, 2)
  })

  it('平衡 CAC 就是单件毛利', () => {
    expect(breakEvenCacNzd(CASE)).toBe(13.59)
  })

  it('🔴 毛利为负时平衡 ROAS 无意义 → null，不许回一个正数', () => {
    expect(breakEvenRoas({ retailPriceNzd: 19.9, grossProfitNzd: -2.5 })).toBeNull()
  })
})

describe('反解所需转化率', () => {
  it('用真实 CPC 反解出的转化率，回代后 CAC 正好等于毛利', () => {
    const cpc = 0.48
    const requiredPct = requiredConversionRatePct(cpc, CASE)!
    expect(requiredPct).toBeCloseTo(3.53, 2)
    expect(estimateCacNzd(cpc, requiredPct)!).toBeCloseTo(CASE.grossProfitNzd, 6)
  })

  it('毛利越薄，要求的转化率越高', () => {
    const thin = requiredConversionRatePct(0.48, { retailPriceNzd: 29.9, grossProfitNzd: 9.39 })!
    const fat = requiredConversionRatePct(0.48, { retailPriceNzd: 39.9, grossProfitNzd: 17.8 })!
    expect(thin).toBeGreaterThan(fat)
  })

  it('🔴 毛利为负 → null（再高的转化率也救不回来）', () => {
    expect(requiredConversionRatePct(0.48, { retailPriceNzd: 19.9, grossProfitNzd: -2.5 })).toBeNull()
  })

  it('🔴 CPC 或转化率非正 → null，不许除出 Infinity', () => {
    expect(estimateCacNzd(0, 2)).toBeNull()
    expect(estimateCacNzd(0.48, 0)).toBeNull()
    expect(requiredConversionRatePct(0, CASE)).toBeNull()
  })
})

describe('扣广告后的单件经济', () => {
  it('行业中位转化率 1.57% 下这一单是亏的', () => {
    const cac = estimateCacNzd(0.48, 1.57)!
    const e = unitEconomicsAfterAds(CASE, cac)
    expect(cac).toBeCloseTo(30.57, 2)
    expect(e.isProfitable).toBe(false)
    expect(e.netProfitNzd).toBeLessThan(0)
  })

  it('转化率做到 5% 就转正', () => {
    const e = unitEconomicsAfterAds(CASE, estimateCacNzd(0.48, 5)!)
    expect(e.isProfitable).toBe(true)
    expect(e.netProfitNzd).toBeCloseTo(13.59 - 9.6, 1)
  })

  it('🔴 净利为负必须保留负号，不许截成 0', () => {
    const e = unitEconomicsAfterAds(CASE, 40)
    expect(e.netProfitNzd).toBeCloseTo(-26.41, 2)
    expect(e.netMarginPct).toBeLessThan(0)
  })

  it('CAC 正好等于毛利时净利为 0，且 ROAS 等于平衡 ROAS', () => {
    const e = unitEconomicsAfterAds(CASE, CASE.grossProfitNzd)
    expect(e.netProfitNzd).toBeCloseTo(0, 6)
    expect(e.roas).toBeCloseTo(breakEvenRoas(CASE)!, 6)
  })
})
