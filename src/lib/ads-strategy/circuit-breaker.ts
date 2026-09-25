/**
 * 广告自治熔断器（WP3 验收条件 3）。
 *
 * 判据：当日账户预算合计超过前 7 天中位数的 3 倍 → 触发熔断。
 * 触发后把该客户全部 `ads.*` 动作的 `client_automation_policies.mode` 写成
 * `deny`（sync-policy.ts 刻意为此预留的值），同时下发 pm-todo 三件套。
 *
 * 本文件是**纯判据模块**：不 import supabase、无副作用。所有 I/O 归调用方。
 */

/** 熔断倍率阈值。 */
export const CIRCUIT_BREAKER_MULTIPLIER = 3

/** 回看天数。 */
export const CIRCUIT_BREAKER_LOOKBACK_DAYS = 7

export interface DailySpendEntry {
  readonly date: string
  readonly totalBudgetCents: number
}

export interface CircuitBreakerInput {
  readonly clientId: string
  readonly todayTotalBudgetCents: number
  readonly recentDailyBudgets: readonly DailySpendEntry[]
}

export type CircuitBreakerVerdict =
  | { readonly tripped: false }
  | {
      readonly tripped: true
      readonly todayCents: number
      readonly medianCents: number
      readonly multiplier: number
      readonly reason: string
    }

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function evaluateCircuitBreaker(input: CircuitBreakerInput): CircuitBreakerVerdict {
  const history = input.recentDailyBudgets

  if (history.length < 3) {
    return { tripped: false }
  }

  const medianCents = median(history.map(e => e.totalBudgetCents))

  if (medianCents <= 0) {
    return { tripped: false }
  }

  const multiplier = input.todayTotalBudgetCents / medianCents

  if (multiplier > CIRCUIT_BREAKER_MULTIPLIER) {
    return {
      tripped: true,
      todayCents: input.todayTotalBudgetCents,
      medianCents: Math.round(medianCents),
      multiplier: Math.round(multiplier * 100) / 100,
      reason:
        `当日账户预算 $${(input.todayTotalBudgetCents / 100).toFixed(2)} ` +
        `超过 7 天中位数 $${(medianCents / 100).toFixed(2)} 的 ${multiplier.toFixed(1)} 倍` +
        `（阈值 ${CIRCUIT_BREAKER_MULTIPLIER} 倍）`,
    }
  }

  return { tripped: false }
}
