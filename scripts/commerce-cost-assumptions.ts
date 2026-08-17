/**
 * 选品脚本共用的成本假设与 API 单价 —— **单一真相源**。
 *
 * commerce-poc.ts 与 commerce-scan-batch.ts 都从这里读，杜绝两份手抄漂移
 * （2026-08-17 子牙复审实测：两处 asOf 已经对不上）。
 *
 * 🔴 这些是运营参数（PM 2026-08-15 费率 + 实时汇率），会过期。真正上生产应从
 *    配置/DB 读，不该写死在脚本里 —— 这里是 POC 阶段的临时集中点。
 */

import type { CostAssumptions } from '../src/lib/commerce/product-intel/landed-cost'

export const COST_ASSUMPTIONS: Omit<CostAssumptions, 'chargeableWeightKg'> = {
  fxUsdToNzd: 1.6981,        // frankfurter, 2026-08-14
  freightNzdPerKg: 2.0,      // PM 提供
  importLevyNzd: 2.21,       // NZ Customs 低值货物征费（空运），2026-04-01 起
  dutyRatePct: 0,            // 中新 FTA 多数消费品；**按 HS code 逐个确认**
  domesticDeliveryNzd: 3.99, // PM 提供
  paymentFeePct: 2.9,
  paymentFeeFixedNzd: 0.3,
  gstRatePct: 15,
  asOf: '2026-08-15',
}

/** DataForSEO / Apify 实测单价（2026-08-16 量级）。 */
export const COST_PER_TIKTOK_ROW_USD = 0.0045
export const COST_PER_IMAGE_SEARCH_USD = 0.006
export const COST_PER_DFSE_CALL_USD = 0.0035
/** 每个种子词固定 3 次 DataForSEO 调用：AU 搜索量 + NZ 搜索量 + NZ 售价。 */
export const DFSE_CALLS_PER_SEED = 3
