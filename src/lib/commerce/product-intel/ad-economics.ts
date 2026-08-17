/**
 * 投流经济模型 —— 把 Meta 广告成本接到单件毛利上，回答「投得起投不起」。
 *
 * 🔴 **毛利不是利润上限，是广告的预算上限。** 每单花在广告上的钱一旦等于毛利，
 *    卖一单赚零；超过就是卖一单亏一单。所以这里所有函数围绕两个硬数字转：
 *      · 盈亏平衡 CAC = 单件毛利
 *      · 盈亏平衡 ROAS = 标价 ÷ 单件毛利
 *    这两个数**只由我们自己的成本决定，跟投放水平无关**，所以是可以先算死的。
 *
 * 🔴 **CPC 和转化率必须分开对待，因为可信度差一个量级。**
 *      · CPC —— 同一个国家同一个竞价市场，跨行业迁移是站得住的；
 *      · 转化率 —— 换个品类就完全不是一回事，**绝不能拿别的行业的数当自己的**。
 *    所以这里不内置任何转化率默认值，只提供「要多少转化率才不亏」的反解，
 *    让调用方拿它跟真实投放结果比。
 */

/** 单件毛利（NZD，已扣到岸/配送/支付，未扣广告）—— 由 landed-cost 算出来。 */
export interface AdEconomicsInput {
  readonly retailPriceNzd: number
  readonly grossProfitNzd: number
}

/**
 * 盈亏平衡 ROAS —— Meta 后台看到的 ROAS 低于它就是在亏钱。
 *
 * 用含 GST 的标价算，因为 Meta 报的转化价值就是订单金额（含税），
 * 换成净收入去比会得出一个后台里对不上的数字。
 */
export function breakEvenRoas(input: AdEconomicsInput): number | null {
  if (input.grossProfitNzd <= 0) return null
  return input.retailPriceNzd / input.grossProfitNzd
}

/** 每单最多能花多少广告费 —— 就是单件毛利。 */
export function breakEvenCacNzd(input: AdEconomicsInput): number {
  return input.grossProfitNzd
}

/**
 * 给定点击成本，反解「落地页转化率要做到多少才不亏」。
 *
 * 这是这套模型最有用的一个数：它把「投得起吗」变成一个**可以在真实投放里
 * 直接验证的百分比**，而不是一句感觉。
 */
export function requiredConversionRatePct(
  cpcNzd: number,
  input: AdEconomicsInput,
): number | null {
  if (cpcNzd <= 0 || input.grossProfitNzd <= 0) return null
  return (cpcNzd / input.grossProfitNzd) * 100
}

/** 按给定点击成本与转化率估算单次获客成本。 */
export function estimateCacNzd(cpcNzd: number, conversionRatePct: number): number | null {
  if (cpcNzd <= 0 || conversionRatePct <= 0) return null
  return cpcNzd / (conversionRatePct / 100)
}

export interface AdAdjustedUnitEconomics {
  readonly cacNzd: number
  /** 扣掉广告之后的单件净利。**可以是负的，不许截成 0。** */
  readonly netProfitNzd: number
  readonly netMarginPct: number
  /** 这一单实际做到的 ROAS（标价 ÷ 广告花费）。 */
  readonly roas: number
  readonly isProfitable: boolean
}

/** 扣掉广告后的单件经济模型。 */
export function unitEconomicsAfterAds(
  input: AdEconomicsInput,
  cacNzd: number,
): AdAdjustedUnitEconomics {
  const netProfitNzd = input.grossProfitNzd - cacNzd
  return {
    cacNzd,
    netProfitNzd,
    netMarginPct: input.retailPriceNzd > 0
      ? (netProfitNzd / input.retailPriceNzd) * 100
      : 0,
    roas: cacNzd > 0 ? input.retailPriceNzd / cacNzd : Infinity,
    isProfitable: netProfitNzd > 0,
  }
}
