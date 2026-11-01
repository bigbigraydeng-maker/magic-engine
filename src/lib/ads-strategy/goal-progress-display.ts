/**
 * 广告健康页「今天看这里」目标进度条 —— 纯展示逻辑（复用 ads_growth_states.goal_pace，不重算）。
 */

import { ADS_ATTRIBUTABLE_METRIC_KEYS } from '@/lib/ads-strategy/portfolio/goal-context'

/** 进度条尚未接入的指标（已报价 / 定金 / 成交等），只显示「还没设目标」。 */
export const GOAL_PROGRESS_PENDING_METRIC_KEYS: ReadonlySet<string> = new Set([
  'signups_count',
  'orders_count',
  'contract_value_signed',
  'pre_orders_count',
])

export function isGoalProgressPending(metricKey: string | null | undefined): boolean {
  if (!metricKey) return false
  if (GOAL_PROGRESS_PENDING_METRIC_KEYS.has(metricKey)) return true
  // 非广告可量指标、又不在 pending 表里的，也不在「今天看这里」画进度条（避免误读 SEO 等目标）。
  return !ADS_ATTRIBUTABLE_METRIC_KEYS.has(metricKey)
}

export function remainingGoalDays(dayIndex: number, totalDays: number): number {
  if (!Number.isFinite(dayIndex) || !Number.isFinite(totalDays) || totalDays < 1) return 0
  return Math.max(0, totalDays - dayIndex)
}

/** 剩余天数内每天要补多少才达标；算不出返回 null。 */
export function perDayNeededToHitTarget(
  target: number,
  done: number | null,
  dayIndex: number,
  totalDays: number,
): number | null {
  if (done === null || !Number.isFinite(target)) return null
  const remaining = remainingGoalDays(dayIndex, totalDays)
  if (remaining <= 0) return null
  const gap = target - done
  if (gap <= 0) return 0
  return Math.ceil(gap / remaining)
}
