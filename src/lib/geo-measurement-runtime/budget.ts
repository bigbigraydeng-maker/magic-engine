/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 预算 preflight（Issue #874 / WP04）
 *
 * 🔴 纯函数。每次可能收费的调用前都要重新算一次，不是批次开始时判一次就完事
 *    （Build Control Room 2026-08-11 WP04 裁定第4条）。
 */

import type { GeoBudgetPreflightResult, GeoRuntimeBudget } from './types'

/**
 * 判定下一次调用能不能发起。
 *
 * fail closed 条件（一条不满足就拒绝，绝不猜测）：
 * - `nextCostCeilingUsd` 不是有限数
 * - `nextCostCeilingUsd` 是负数
 * - `nextCostCeilingUsd` 超过剩余授权额度
 */
export function preflightGeoBudget(
  budget: GeoRuntimeBudget,
  spentUsd: number,
  nextCostCeilingUsd: number,
): GeoBudgetPreflightResult {
  if (!Number.isFinite(budget.authorizedUsd) || budget.authorizedUsd < 0) {
    return { ok: false, reason: 'authorized budget must be a finite, non-negative amount' }
  }
  if (!Number.isFinite(spentUsd) || spentUsd < 0) {
    return { ok: false, reason: 'spent-so-far amount must be a finite, non-negative amount' }
  }

  const remainingUsd = budget.authorizedUsd - spentUsd

  if (!Number.isFinite(nextCostCeilingUsd)) {
    return { ok: false, reason: 'next call cost ceiling is not a finite number' }
  }
  if (nextCostCeilingUsd < 0) {
    return { ok: false, reason: 'next call cost ceiling is negative' }
  }
  if (nextCostCeilingUsd > remainingUsd) {
    return {
      ok: false,
      reason: `next call cost ceiling (${nextCostCeilingUsd}) exceeds remaining authorized budget (${remainingUsd})`,
    }
  }

  return { ok: true, remainingUsd }
}
