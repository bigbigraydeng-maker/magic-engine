/**
 * 新西兰到岸成本与定价 —— 回答「这个品在 NZ 卖多少钱才活得下去」。
 *
 * 🔴 **GST 对已注册 GST 的企业是过账，不是成本。**
 *    进口时付的 15% 能抵扣回来，卖出时收的 15% 要上缴。所以：
 *      · 成本侧**不算** GST；
 *      · 收入侧必须 `售价 ÷ 1.15` 拿净收入 —— 标价 NZ$39.90 真正进口袋的只有 NZ$34.70。
 *    这一步算错是这门生意最常见的亏法：把含 GST 的售价当收入去减成本，
 *    毛利会虚高 15%。
 *
 * 🔴 **所有假设都必须由调用方显式传入，这里一个默认值都不给。**
 *    汇率、运费费率、重量、关税率会变，埋成默认值就等于埋一个过期数字。
 *    重量拿不到时传 null —— 结果是 UNKNOWN，不是「按 0.5kg 算算看」。
 *
 * 数据来源与时效见 CostAssumptions 各字段注释；调用方有义务把 `asOf` 一起展示。
 */

/** 计算所需的全部外部假设。**没有默认值是刻意的。** */
export interface CostAssumptions {
  /** 1 USD = ? NZD */
  readonly fxUsdToNzd: number
  /**
   * 国际运费费率（**NZD/kg**，不是 USD）。
   *
   * 用 NZD 是因为货代给的报价本来就是 NZD —— 先折成 USD 再折回来只会多一次
   * 汇率误差。空运散货、快递、海运拼柜差价能到 3 倍，调用方按实际渠道传。
   */
  readonly freightNzdPerKg: number
  /**
   * 计费重量（kg）= max(实重, 体积重)。体积重（空运）= 长×宽×高(cm) ÷ 6000。
   * **拿不到就传 null** —— 整个计算返回 null，不许猜。
   */
  readonly chargeableWeightKg: number | null
  /**
   * 低值货物进口征费（NZD，不含 GST）。2026-04-01 起对 ≤NZ$1,000 的进口件征收：
   * 空运 2.21 / 海运 2.09。
   */
  readonly importLevyNzd: number
  /**
   * 关税率（%）。中国—新西兰 FTA 下多数消费品为 0，**但按 HS code 逐个确认**，
   * 不许默认成 0 就不管了。
   */
  readonly dutyRatePct: number
  /** 本地配送到消费者（NZD/件）。 */
  readonly domesticDeliveryNzd: number
  /** 支付通道费率（%）。 */
  readonly paymentFeePct: number
  /** 支付通道固定费（NZD/笔）。 */
  readonly paymentFeeFixedNzd: number
  /** GST 税率（%）。新西兰 15。 */
  readonly gstRatePct: number
  /** 上面这些数是什么时候取的 —— 必须跟结果一起展示。 */
  readonly asOf: string
}

export interface LandedCost {
  /** 货价（NZD） */
  readonly goodsNzd: number
  /** 国际运费（NZD） */
  readonly freightNzd: number
  readonly dutyNzd: number
  readonly levyNzd: number
  /** 到岸合计（**不含 GST，GST 可抵扣**） */
  readonly totalNzd: number
}

/**
 * 算到岸成本。重量未知返回 null —— 空运按重量计费，没有重量就没有答案。
 */
export function calculateLandedCost(
  unitCostUsd: number,
  a: CostAssumptions,
): LandedCost | null {
  if (a.chargeableWeightKg === null || a.chargeableWeightKg <= 0) return null
  if (unitCostUsd <= 0) return null

  const goodsNzd = unitCostUsd * a.fxUsdToNzd
  const freightNzd = a.chargeableWeightKg * a.freightNzdPerKg
  // 关税基数是货价 + 国际运费（CIF 口径）。
  const dutyNzd = (goodsNzd + freightNzd) * (a.dutyRatePct / 100)
  const levyNzd = a.importLevyNzd

  return {
    goodsNzd,
    freightNzd,
    dutyNzd,
    levyNzd,
    totalNzd: goodsNzd + freightNzd + dutyNzd + levyNzd,
  }
}

export interface PricingBreakdown {
  /** 标价（含 GST，NZD） */
  readonly retailPriceNzd: number
  /** 净收入 = 标价 ÷ (1 + GST) */
  readonly netRevenueNzd: number
  readonly landedCostNzd: number
  readonly domesticDeliveryNzd: number
  readonly paymentFeeNzd: number
  /** 毛利 —— **未扣广告**。 */
  readonly grossProfitNzd: number
  readonly grossMarginPct: number
  /**
   * 每单最多能花多少广告费还不亏（= 毛利）。
   * 这是投放的硬约束：单次获客成本超过它，卖一单亏一单。
   */
  readonly breakEvenCacNzd: number
}

/** 按给定标价拆解单件经济模型。 */
export function priceBreakdown(
  retailPriceNzd: number,
  landed: LandedCost,
  a: CostAssumptions,
): PricingBreakdown {
  const netRevenueNzd = retailPriceNzd / (1 + a.gstRatePct / 100)
  const paymentFeeNzd = retailPriceNzd * (a.paymentFeePct / 100) + a.paymentFeeFixedNzd
  const grossProfitNzd =
    netRevenueNzd - landed.totalNzd - a.domesticDeliveryNzd - paymentFeeNzd

  return {
    retailPriceNzd,
    netRevenueNzd,
    landedCostNzd: landed.totalNzd,
    domesticDeliveryNzd: a.domesticDeliveryNzd,
    paymentFeeNzd,
    grossProfitNzd,
    grossMarginPct: netRevenueNzd > 0 ? (grossProfitNzd / netRevenueNzd) * 100 : 0,
    breakEvenCacNzd: grossProfitNzd,
  }
}

/**
 * 达到目标毛利率所需的最低标价（含 GST）。
 *
 * 解 `(net − landed − delivery − net×feePct' − feeFixed) / net = target`，
 * 其中支付费按标价计，先折算回净收入口径再解，避免迭代。
 */
export function minViablePriceNzd(
  landed: LandedCost,
  a: CostAssumptions,
  targetMarginPct: number,
): number | null {
  const gst = 1 + a.gstRatePct / 100
  const target = targetMarginPct / 100
  // 支付费 = 标价×p + f = net×gst×p + f，代入后 net 的系数：
  const netCoefficient = 1 - (a.paymentFeePct / 100) * gst - target
  if (netCoefficient <= 0) return null

  const fixedCosts = landed.totalNzd + a.domesticDeliveryNzd + a.paymentFeeFixedNzd
  const net = fixedCosts / netCoefficient
  return net * gst
}
