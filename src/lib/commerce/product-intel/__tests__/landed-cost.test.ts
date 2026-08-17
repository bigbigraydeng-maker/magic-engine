import { describe, it, expect } from 'vitest'
import {
  calculateLandedCost,
  minViablePriceNzd,
  priceBreakdown,
} from '../landed-cost'
import type { CostAssumptions } from '../landed-cost'

/** 2026-08-15 的真实取值，见各字段来源注释。 */
const A: CostAssumptions = {
  fxUsdToNzd: 1.6981,
  freightNzdPerKg: 2.0,
  chargeableWeightKg: 0.8,
  importLevyNzd: 2.21,
  dutyRatePct: 0,
  domesticDeliveryNzd: 3.99,
  paymentFeePct: 2.9,
  paymentFeeFixedNzd: 0.3,
  gstRatePct: 15,
  asOf: '2026-08-15',
}

describe('calculateLandedCost', () => {
  it('货价 + 运费 + 关税 + 征费，四项都算进去', () => {
    const landed = calculateLandedCost(4.5, A)!
    expect(landed.goodsNzd).toBeCloseTo(7.64, 2)
    expect(landed.freightNzd).toBeCloseTo(1.60, 2)
    expect(landed.levyNzd).toBe(2.21)
    expect(landed.totalNzd).toBeCloseTo(11.45, 2)
  })

  it('🔴 重量未知 → null，不许拿默认重量硬算', () => {
    expect(calculateLandedCost(4.5, { ...A, chargeableWeightKg: null })).toBeNull()
    expect(calculateLandedCost(4.5, { ...A, chargeableWeightKg: 0 })).toBeNull()
  })

  it('关税按 CIF（货价+运费）计，不是只按货价', () => {
    const withDuty = calculateLandedCost(4.5, { ...A, dutyRatePct: 10 })!
    expect(withDuty.dutyNzd).toBeCloseTo((7.64 + 1.60) * 0.1, 1)
  })
})

describe('priceBreakdown', () => {
  it('🔴 净收入必须除掉 GST —— 标价不是收入', () => {
    const landed = calculateLandedCost(4.5, A)!
    const b = priceBreakdown(39.9, landed, A)
    expect(b.netRevenueNzd).toBeCloseTo(34.7, 1)
    expect(b.netRevenueNzd).toBeLessThan(b.retailPriceNzd)
  })

  it('毛利 = 净收入 − 到岸 − 本地配送 − 支付费', () => {
    const landed = calculateLandedCost(4.5, A)!
    const b = priceBreakdown(39.9, landed, A)
    const expected = b.netRevenueNzd - landed.totalNzd - 3.99 - (39.9 * 0.029 + 0.3)
    expect(b.grossProfitNzd).toBeCloseTo(expected, 4)
  })

  it('每单广告上限就是毛利 —— 超过它卖一单亏一单', () => {
    const landed = calculateLandedCost(4.5, A)!
    const b = priceBreakdown(39.9, landed, A)
    expect(b.breakEvenCacNzd).toBe(b.grossProfitNzd)
  })

  it('🔴 标价太低时毛利为负 —— 不许被截成 0', () => {
    const landed = calculateLandedCost(4.5, A)!
    const b = priceBreakdown(14.9, landed, A)
    expect(b.grossProfitNzd).toBeLessThan(0)
    expect(b.grossMarginPct).toBeLessThan(0)
  })
})

describe('minViablePriceNzd', () => {
  it('算出来的价格回代，毛利率确实等于目标', () => {
    const landed = calculateLandedCost(4.5, A)!
    for (const target of [30, 50, 60]) {
      const price = minViablePriceNzd(landed, A, target)!
      expect(priceBreakdown(price, landed, A).grossMarginPct).toBeCloseTo(target, 6)
    }
  })

  it('目标毛利率越高，要价越高', () => {
    const landed = calculateLandedCost(4.5, A)!
    expect(minViablePriceNzd(landed, A, 60)!).toBeGreaterThan(
      minViablePriceNzd(landed, A, 30)!,
    )
  })

  it('🔴 目标高到数学上不可能 → null，不许回一个假的天价', () => {
    const landed = calculateLandedCost(4.5, A)!
    expect(minViablePriceNzd(landed, A, 100)).toBeNull()
  })
})
