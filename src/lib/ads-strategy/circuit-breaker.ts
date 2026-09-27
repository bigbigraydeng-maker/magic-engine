/**
 * 广告自治熔断器（WP3 验收条件 3）。
 *
 * 判据：当日账户**实际花费**合计超过前 7 天**实际花费**中位数的 3 倍 → 触发熔断。
 * 调用方必须从 `ad_daily_insights` 取实际花费（而不是预算）喂给本模块——
 * 预算不变、花费突增到中位数 3 倍以上时用预算算不出这个信号；反过来仅调整
 * 预算但花费未异常时用预算算又会误触发。
 * 触发后把该客户全部 `ads.*` 动作的 `client_automation_policies.mode` 写成
 * `deny`（sync-policy.ts 刻意为此预留的值），同时下发 pm-todo 三件套。
 *
 * 本文件是**纯判据模块**：不 import supabase、无副作用。所有 I/O 归调用方。
 */

/** 熔断倍率阈值。 */
export const CIRCUIT_BREAKER_MULTIPLIER = 3

/** 回看天数。 */
export const CIRCUIT_BREAKER_LOOKBACK_DAYS = 7

/** 非零花费天数最低要求（spec §6.3 #1）。 */
export const CIRCUIT_BREAKER_MIN_NONZERO_DAYS = 5

export interface DailySpendEntry {
  readonly date: string
  readonly totalSpendCents: number
}

export interface CircuitBreakerInput {
  readonly clientId: string
  readonly todayTotalSpendCents: number
  readonly recentDailySpend: readonly DailySpendEntry[]
}

export type CircuitBreakerVerdict =
  | { readonly tripped: false }
  | { readonly tripped: 'undeterminable'; readonly reason: string }
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

/**
 * 按 `date` 取最近 `CIRCUIT_BREAKER_LOOKBACK_DAYS` 个日历日（去重、降序取前 N 个）。
 *
 * 调用方可能传入超过 7 天的回填数据或未排序数据 —— 不按日期先选窗口，
 * 直接把所有行喂进中位数，混进去的更早高花费日会把中位数顶高，
 * 该触发的异常花费反而被放过。
 */
function selectLookbackWindow(history: readonly DailySpendEntry[]): DailySpendEntry[] {
  const latestPerDate = new Map<string, DailySpendEntry>()
  for (const entry of history) {
    latestPerDate.set(entry.date, entry)
  }
  return [...latestPerDate.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, CIRCUIT_BREAKER_LOOKBACK_DAYS)
}

export function evaluateCircuitBreaker(input: CircuitBreakerInput): CircuitBreakerVerdict {
  const history = selectLookbackWindow(input.recentDailySpend)
  const nonZeroDays = history.filter(e => e.totalSpendCents > 0)

  if (nonZeroDays.length < CIRCUIT_BREAKER_MIN_NONZERO_DAYS) {
    return {
      tripped: 'undeterminable',
      reason:
        `非零花费天数 ${nonZeroDays.length} 不足 ${CIRCUIT_BREAKER_MIN_NONZERO_DAYS} 天，` +
        '数据不充分，按 data-partial 处理（不熔不放）',
    }
  }

  const medianCents = median(nonZeroDays.map(e => e.totalSpendCents))

  if (medianCents <= 0) {
    return { tripped: false }
  }

  const multiplier = input.todayTotalSpendCents / medianCents

  if (multiplier > CIRCUIT_BREAKER_MULTIPLIER) {
    return {
      tripped: true,
      todayCents: input.todayTotalSpendCents,
      medianCents: Math.round(medianCents),
      multiplier: Math.round(multiplier * 100) / 100,
      reason:
        `当日账户实际花费 $${(input.todayTotalSpendCents / 100).toFixed(2)} ` +
        `超过 7 天实际花费中位数 $${(medianCents / 100).toFixed(2)} 的 ${multiplier.toFixed(1)} 倍` +
        `（阈值 ${CIRCUIT_BREAKER_MULTIPLIER} 倍）`,
    }
  }

  return { tripped: false }
}
