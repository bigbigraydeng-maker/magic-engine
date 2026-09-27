/** 一条判据算出来的结论。 */
export type DetectorVerdict =
  | { readonly kind: 'trip'; readonly reason: string; readonly sticky: boolean; readonly evidence: Record<string, unknown> }
  | { readonly kind: 'no_trip'; readonly evidence: Record<string, unknown> }
  | { readonly kind: 'undeterminable'; readonly reason: string; readonly evidence: Record<string, unknown> }

/** `ad_daily_insights` 里按天汇总后的一行（调用方已按账户 + 日期 group 过）。 */
export interface DailySpendPoint {
  /** ISO 日期，形如 '2026-09-26' */
  readonly insightDate: string
  /** 当天该账户总花费，单位**分**（调用方已换算，这里不做单位换算） */
  readonly spendCents: number
}

/** `ads_growth_states` 那一天的行。查不到行时调用方传 null。 */
export interface GrowthStateRow {
  readonly dataCompleteness: string
}

/** 中位数样本下限：少于这个数，倍数判据没有统计意义。 */
const MIN_NON_ZERO_DAYS = 5

/** 相对倍数阈值：严格大于才熔断。 */
const SPIKE_MULTIPLIER = 3

/**
 * 偶数个样本时取中间两个的平均，奇数个取正中间。
 * 单独抽出来是因为"中位数怎么算"是判据的核心语义，混在 detectSpendSpike 里会看不清。
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[mid]
  }
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function detectSpendSpike(args: {
  /** 要判的那一天（"完整前一天"，调用方按账户时区算好） */
  readonly targetDate: string
  /** targetDate 之前 7 天的花费点（不含 targetDate 本身），顺序不保证 */
  readonly previousDays: readonly DailySpendPoint[]
  /** targetDate 当天的花费，分。null = 当天根本没有数据行 */
  readonly targetSpendCents: number | null
  /** 绝对硬顶，分。超过它无论中位数多少都熔断 */
  readonly absoluteCapCents: number
}): DetectorVerdict {
  const { targetDate, previousDays, targetSpendCents, absoluteCapCents } = args

  const nonZeroSpends = previousDays
    .map((point) => point.spendCents)
    .filter((spend) => spend > 0)
  const nonZeroDayCount = nonZeroSpends.length
  const medianCents = nonZeroDayCount > 0 ? median(nonZeroSpends) : null

  const evidence: Record<string, unknown> = {
    targetDate,
    targetSpendCents,
    nonZeroDayCount,
    medianCents,
    absoluteCapCents,
  }

  // 不知道花了多少，就不能说"没超"——缺失事实必须显式暴露，不能被当成安全。
  if (targetSpendCents === null) {
    return { kind: 'undeterminable', reason: 'facts:spend_missing_for_target_day', evidence }
  }

  // 绝对硬顶不依赖历史，所以必须排在中位数之前：历史不足时相对判据会 undeterminable，
  // 那时绝对硬顶是唯一还能说话的判据。
  if (targetSpendCents > absoluteCapCents) {
    return { kind: 'trip', reason: 'circuit:absolute_spend_cap', sticky: false, evidence }
  }

  // 样本太少时算出来的倍数没有意义——这是"判不了"，不是"没超"。
  if (nonZeroDayCount < MIN_NON_ZERO_DAYS) {
    return { kind: 'undeterminable', reason: 'facts:not_enough_spend_days', evidence }
  }

  // medianCents 在 nonZeroDayCount >= 5 时必然非 null，这里只是让类型收窄。
  if (medianCents !== null && targetSpendCents > medianCents * SPIKE_MULTIPLIER) {
    return { kind: 'trip', reason: 'circuit:spend_spike', sticky: false, evidence }
  }

  return { kind: 'no_trip', evidence }
}

export function detectDataCompleteness(args: {
  readonly targetDate: string
  /** 那一天的行。**查不到行时传 null** */
  readonly row: GrowthStateRow | null
}): DetectorVerdict {
  const { targetDate, row } = args
  const dataCompleteness = row === null ? null : row.dataCompleteness
  const evidence: Record<string, unknown> = { targetDate, dataCompleteness }

  // 查不到行 = 这一天根本没算过，和"算过但数据不全"根因不同、处置不同，
  // 所以 reason 必须分开，不能合并。
  if (row === null) {
    return { kind: 'undeterminable', reason: 'facts:growth_state_missing', evidence }
  }

  if (row.dataCompleteness === 'complete') {
    return { kind: 'no_trip', evidence }
  }

  // 数据不全时当天不动手，第二天数据补上自然恢复——这是"当轮冻结"，不是熔断，
  // 返回 trip 会让它变成需要人解除的熔断事件，那是错的。
  return { kind: 'undeterminable', reason: 'facts:data_partial', evidence }
}
