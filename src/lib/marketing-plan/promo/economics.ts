/**
 * 经营判断卡算出来的两个数 —— 纯函数，不存库，页面每次现算。
 *
 * 口径（统筹 2026-10-18 定）：
 *   每条线索的价值 = 每座留存 × 每单几座 × 线索成交率
 *   （每座留存是「一个座位」的钱，一单有若干座，所以要先乘每单座数，再乘成交率。）
 *   保本所需成交率 = 实际每条线索成本 ÷（每座留存 × 每单几座）
 *
 * 算不出来一律返回 null，页面显示「未知」——不许当成 0。
 * 这里不出现任何客户名或客户数字：数字全部来自传进来的经营判断卡。
 */

import type { BusinessCase } from './spec'

/** 算出来的两个数；算不出的那个是 null。 */
export interface BusinessCaseMath {
  /** 可承受的每条线索成本（分）。 */
  acceptable_lead_cost_cents: number | null
  /** 按实际线索成本，保本所需的最低成交率（0–1）；没有实际成本就是 null。 */
  breakeven_rate: number | null
  /** 每单留存（分）= 每座留存 × 每单几座；给页面写公式用。 */
  retained_per_booking_cents: number | null
}

/** 只有有限数才放行；NaN / Infinity 一律当未知。 */
function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null
}

/**
 * @param bc 经营判断卡；为 undefined 表示还没填。
 * @param actualLeadCostCents 实际每条线索成本（分），读不到传 null。
 */
export function businessCaseMath(
  bc: BusinessCase | undefined,
  actualLeadCostCents: number | null,
): BusinessCaseMath {
  if (bc === undefined) {
    return {
      acceptable_lead_cost_cents: null,
      breakeven_rate: null,
      retained_per_booking_cents: null,
    }
  }

  // 每单留存 = 每座留存 × 每单几座
  const retained_per_booking_cents =
    bc.retained_per_seat_cents > 0 && bc.pax_per_booking > 0
      ? finiteOrNull(Math.round(bc.retained_per_seat_cents * bc.pax_per_booking))
      : null

  // 可承受线索成本 = 每单留存 × 成交率
  const acceptable_lead_cost_cents =
    retained_per_booking_cents !== null && bc.lead_to_booking_rate > 0
      ? finiteOrNull(Math.round(retained_per_booking_cents * bc.lead_to_booking_rate))
      : null

  // 保本成交率 = 实际线索成本 ÷ 每单留存（不四舍五入）
  const breakeven_rate =
    actualLeadCostCents !== null &&
    actualLeadCostCents > 0 &&
    retained_per_booking_cents !== null
      ? finiteOrNull(actualLeadCostCents / retained_per_booking_cents)
      : null

  return {
    acceptable_lead_cost_cents,
    breakeven_rate,
    retained_per_booking_cents,
  }
}
