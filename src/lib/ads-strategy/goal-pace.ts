/**
 * P21.K — Goal pace judgement (linear-pace + budget-cap reachability).
 *
 * Answers the daily-report question "are we going to hit this goal?" from three
 * cheap inputs: the goal's own target/baseline, the calendar position inside the
 * goal period, and the campaign's recent cost-per-result. It is deliberately
 * PURE — no I/O, no dates-from-now — so it is deterministic, testable, and can
 * be replayed against any historical period.
 *
 * Two independent lenses, in priority order:
 *   1. Reachability under the daily budget cap. Even a campaign that is "behind
 *      pace" can be fine if the cap still leaves room to catch up; conversely a
 *      campaign that is nominally on pace can be doomed if the cap physically
 *      cannot buy the remaining results. This is the honest answer, so it wins.
 *   2. Linear pace. The naive "expected = baseline + (target-baseline) * elapsed
 *      / total" comparison, used when the cap lens can't be computed (no cap, no
 *      cost history) or when the cap still leaves the goal reachable.
 *
 * `actualToDate === null` means "attribution data not ready yet" (M2), which is
 * NOT the same as zero — a null must never be read as "0 results so far", or a
 * fresh period would report a false 🔴 on day one.
 */

export type GoalPaceVerdict =
  | 'on_track'
  | 'behind'
  | 'unreachable_within_caps'
  | 'unknown'

export interface GoalPaceInput {
  targetValue: number            // goals.target_value
  baselineValue: number          // goals.baseline_value（起点，进度按 target - baseline 算）
  periodStart: string            // 'YYYY-MM-DD'
  periodEnd: string              // 'YYYY-MM-DD'
  today: string                  // 'YYYY-MM-DD'
  actualToDate: number | null    // null = 归属数据不足（M2），不是 0
  dailyCapCents: number | null   // ad_strategy_configs.daily_budget_cap_cents
  medianCostPerResultCents7d: number | null   // 近 7 天每结果成本中位数（分）
  /** 日报最新有数据的一天（'YYYY-MM-DD'）。给了就按「有数据的天数」算速度，不按日历天数；不给 = 按 today。 */
  dataThrough?: string | null
  /** 近几天实际日花费（分），给「按实际在投花费」那个上限数；不给 = 不算这一条 */
  actualDailySpendCents?: number | null
}

export interface GoalPace {
  expectedToDate: number | null   // 线性节奏：baseline + (target-baseline) * elapsedDays / totalDays
  actualToDate: number | null
  gapPct: number | null           // (actual - expected) / expected * 100；expected <= 0 时 null；1 位小数
  projectedEnd: number | null     // baseline + (actual-baseline)/elapsedDays * totalDays；elapsedDays=0 时 null；取整
  verdict: GoalPaceVerdict
  reason: string                  // 中文一句话，给日报直接用
  /** 按日预算上限算的到期最多结果数；算不出就没有这个字段 */
  reachableAtCap?: number
  /** 按近几天实际日花费算的到期最多结果数；算不出就没有这个字段 */
  reachableAtActualSpend?: number
  /** 速度所用的数据截止日（日报口径，通常是昨天）；没给 dataThrough 就没有这个字段 */
  dataThrough?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse 'YYYY-MM-DD' to a UTC epoch-day number, or null if malformed/invalid. */
function parseUtcDay(s: string): number | null {
  if (!DATE_RE.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const dt = new Date(ms)
  // Reject rollovers like 2026-02-31 → 2026-03-03.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null
  }
  return Math.floor(ms / 86_400_000)
}

/** Whole days from `a` to `b` (b - a), both already parsed epoch-days. */
function daysBetween(a: number, b: number): number {
  return b - a
}

/** Linear pace: baseline + (target - baseline) * elapsedDays / totalDays. */
function linearExpected(
  targetValue: number,
  baselineValue: number,
  elapsedDays: number,
  totalDays: number,
): number {
  return baselineValue + (targetValue - baselineValue) * (elapsedDays / totalDays)
}

/** Project the end value from the observed slope; null when there is no slope yet. */
function projectEnd(
  actualToDate: number,
  baselineValue: number,
  elapsedDays: number,
  totalDays: number,
): number | null {
  if (elapsedDays === 0) return null
  const slope = (actualToDate - baselineValue) / elapsedDays
  return Math.round(baselineValue + slope * totalDays)
}

/** (actual - expected) / expected * 100, rounded to 1 dp; null when expected <= 0. */
function gapPercent(actual: number, expected: number): number | null {
  if (expected <= 0) return null
  return Math.round(((actual - expected) / expected) * 1000) / 10
}

/** Max results the remaining days can buy under the cap, or null if not computable. */
function reachableUnderCap(
  actualToDate: number,
  dailyCapCents: number | null | undefined,
  medianCostPerResultCents7d: number | null,
  remainingDays: number,
): number | null {
  if (dailyCapCents == null || medianCostPerResultCents7d === null) return null
  if (medianCostPerResultCents7d <= 0) return null
  const perDay = Math.floor(dailyCapCents / medianCostPerResultCents7d)
  return actualToDate + perDay * remainingDays
}

interface VerdictResult {
  verdict: GoalPaceVerdict
  reason: string
}

/** Apply the verdict rules in priority order. */
function decideVerdict(args: {
  actualToDate: number
  targetValue: number
  gapPct: number | null
  reachable: number | null
  reachableAtSpend: number | null
}): VerdictResult {
  const { targetValue, gapPct, reachable, reachableAtSpend } = args

  if (reachable !== null && reachable < 0.8 * targetValue) {
    const spendPart = reachableAtSpend === null ? '' : `；按近几天实际花费约 ${reachableAtSpend}`
    return {
      verdict: 'unreachable_within_caps',
      reason: `按日预算上限和近 7 天同类结果成本，到期最多约 ${reachable}${spendPart}，不到目标的 80%`,
    }
  }
  if (gapPct !== null && gapPct < -15) {
    return { verdict: 'behind', reason: `落后线性节奏 ${Math.abs(gapPct)}%` }
  }
  if (gapPct === null) {
    return { verdict: 'on_track', reason: '节奏无法比较（预期值为 0）' }
  }
  const dir = gapPct >= 0 ? '超前' : '落后'
  return { verdict: 'on_track', reason: `按节奏走（${dir} ${Math.abs(gapPct)}%）` }
}

/**
 * Judge whether a goal is on pace, from its target/baseline, the calendar
 * position inside the period, and the campaign's recent cost-per-result.
 *
 * Pure and deterministic: all date math is whole days on UTC, and every
 * "can't judge" path returns `unknown` rather than guessing.
 */
export function computeGoalPace(input: GoalPaceInput): GoalPace {
  const {
    targetValue, baselineValue, periodStart, periodEnd, today,
    actualToDate, dailyCapCents, medianCostPerResultCents7d,
    dataThrough, actualDailySpendCents,
  } = input

  const start = parseUtcDay(periodStart)
  const end = parseUtcDay(periodEnd)
  const now = parseUtcDay(today)

  const unknown = (reason: string): GoalPace => ({
    expectedToDate: null, actualToDate: null, gapPct: null,
    projectedEnd: null, verdict: 'unknown', reason,
  })

  // Rule 1: bad inputs / missing attribution.
  if (actualToDate === null) return unknown('归属数据不足，未判')
  if (start === null || end === null || now === null || end < start) {
    return unknown('目标期日期无效')
  }

  const totalDays = daysBetween(start, end) + 1

  // Rule 2: period hasn't started.
  if (now < start) return unknown('目标期未开始')

  // Rule 3: first day — too little signal to project.
  // 速度只算有日报数据的天：dataThrough 比今天早（通常是昨天）就以它为准。
  const through = dataThrough ? parseUtcDay(dataThrough) : null
  if (through !== null && through < start) return unknown('日报还没有这个目标期的数据，未判')
  const clampedNow = Math.min(now, end, through ?? now)
  const elapsedDays = daysBetween(start, clampedNow) + 1
  const expectedToDate = linearExpected(targetValue, baselineValue, elapsedDays, totalDays)

  if (elapsedDays === 1) {
    return {
      expectedToDate, actualToDate, gapPct: null,
      projectedEnd: null, verdict: 'unknown', reason: '第 1 天，样本不足',
    }
  }

  const gapPct = gapPercent(actualToDate, expectedToDate)
  const projectedEnd = projectEnd(actualToDate, baselineValue, elapsedDays, totalDays)
  const remainingDays = totalDays - elapsedDays
  const reachable = reachableUnderCap(
    actualToDate, dailyCapCents, medianCostPerResultCents7d, remainingDays,
  )

  const reachableAtSpend = reachableUnderCap(
    actualToDate, actualDailySpendCents, medianCostPerResultCents7d, remainingDays,
  )

  const { verdict, reason } = decideVerdict({
    actualToDate, targetValue, gapPct, reachable, reachableAtSpend,
  })

  return {
    expectedToDate, actualToDate, gapPct, projectedEnd, verdict, reason,
    ...(reachable !== null ? { reachableAtCap: reachable } : {}),
    ...(reachableAtSpend !== null ? { reachableAtActualSpend: reachableAtSpend } : {}),
    ...(dataThrough ? { dataThrough } : {}),
  }
}
