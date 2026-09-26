/**
 * 广告自治「熔断器」——纯函数，无任何 import。
 *
 * 为什么落点是 observe 而不是 deny：
 *   ad_strategy_configs.autonomy_mode 的数据库 CHECK 只允许 'observe' 和 'bounded_auto' 两档，
 *   根本没有 'deny' 这一档，写 'deny' 会被数据库直接拒绝。
 *   而且 deny 是管理员级别的硬闸，熔断器不是它的写入者——熔断器只负责把自治降级回只观察，
 *   让「人」来决定要不要重新打开。所以熔断的落点只能是 'observe'。
 *
 * 为什么第 5 条（当日数据不完整）不切 observe：
 *   数据没采全只是「今天看不清」，不是「策略做错了事」。切回 observe 需要人手动拨开关，
 *   而数据不完整次日补全后会自动恢复，不该让人为一次采集延迟去点开关。
 *   所以第 5 条只做「当日冻结」：今天不出动作，次日自动恢复。
 */

export type CircuitTriggerCode =
  | 'spend_spike'
  | 'account_over_daily_cap'
  | 'kernel_rollback_failed'
  | 'jev_low_scores'
  | 'data_incomplete'

export type CircuitOutcome =
  | 'switched_to_observe'
  | 'frozen_for_day'
  | 'no_trigger'
  | 'unknown_data_partial'

export const SPEND_SPIKE_MEDIAN_MULTIPLE = 3

export const OBSERVE_SWITCHING_TRIGGERS: readonly CircuitTriggerCode[] = [
  'spend_spike',
  'account_over_daily_cap',
  'kernel_rollback_failed',
  'jev_low_scores',
]

export interface CircuitBreakerEvidence {
  readonly clientId: string
  readonly cycleDate: string
  readonly dataCompleteness: 'complete' | 'partial'
  readonly spendTodayCents: number | null
  readonly spendMedianPrev7Cents: number | null
  readonly accountDeltaTodayCents: number | null
  readonly dailyBudgetCapCents: number | null
  readonly kernelRollbackFailures: number
  readonly consecutiveJevLowScores: number
  readonly jevLowScoreLimit: number
}

export interface CircuitTriggerVerdict {
  readonly code: CircuitTriggerCode
  readonly outcome: CircuitOutcome
  readonly evidence: Readonly<Record<string, number | string | null>>
}

export interface CircuitBreakerDecision {
  readonly verdicts: readonly CircuitTriggerVerdict[]
  readonly firedTriggers: readonly CircuitTriggerCode[]
  readonly switchToObserve: boolean
  readonly actionsAllowed: boolean
  readonly requiresPmReset: boolean
  readonly humanReason: string | null
}

const TRIGGER_LABELS: Readonly<Record<CircuitTriggerCode, string>> = {
  spend_spike: '今天花钱突然暴涨',
  account_over_daily_cap: '今天账户改动超过了你设的日预算上限',
  kernel_rollback_failed: '有动作撤回失败',
  jev_low_scores: '连续几次质检分数过低',
  data_incomplete: '今天数据没采全',
}

function verdictSpendSpike(
  e: CircuitBreakerEvidence,
  partial: boolean,
): CircuitTriggerVerdict {
  const base = {
    spend_today_cents: e.spendTodayCents,
    spend_median_prev7_cents: e.spendMedianPrev7Cents,
    multiple: SPEND_SPIKE_MEDIAN_MULTIPLE,
  }
  if (partial) {
    return {
      code: 'spend_spike',
      outcome: 'unknown_data_partial',
      evidence: { ...base, reason: 'data_partial' },
    }
  }
  if (
    e.spendTodayCents === null ||
    e.spendMedianPrev7Cents === null ||
    e.spendMedianPrev7Cents <= 0
  ) {
    return {
      code: 'spend_spike',
      outcome: 'unknown_data_partial',
      evidence: { ...base, reason: 'insufficient_history' },
    }
  }
  const fired =
    e.spendTodayCents > e.spendMedianPrev7Cents * SPEND_SPIKE_MEDIAN_MULTIPLE
  return {
    code: 'spend_spike',
    outcome: fired ? 'switched_to_observe' : 'no_trigger',
    evidence: base,
  }
}

function verdictAccountOverDailyCap(
  e: CircuitBreakerEvidence,
  partial: boolean,
): CircuitTriggerVerdict {
  const base = {
    account_delta_today_cents: e.accountDeltaTodayCents,
    daily_budget_cap_cents: e.dailyBudgetCapCents,
  }
  if (partial) {
    return {
      code: 'account_over_daily_cap',
      outcome: 'unknown_data_partial',
      evidence: { ...base, reason: 'data_partial' },
    }
  }
  if (e.accountDeltaTodayCents === null || e.dailyBudgetCapCents === null) {
    return {
      code: 'account_over_daily_cap',
      outcome: 'unknown_data_partial',
      evidence: { ...base, reason: 'cap_or_delta_unknown' },
    }
  }
  const fired = e.accountDeltaTodayCents > e.dailyBudgetCapCents
  return {
    code: 'account_over_daily_cap',
    outcome: fired ? 'switched_to_observe' : 'no_trigger',
    evidence: base,
  }
}

function verdictKernelRollbackFailed(
  e: CircuitBreakerEvidence,
): CircuitTriggerVerdict {
  const fired = e.kernelRollbackFailures > 0
  return {
    code: 'kernel_rollback_failed',
    outcome: fired ? 'switched_to_observe' : 'no_trigger',
    evidence: { rollback_failures: e.kernelRollbackFailures },
  }
}

function verdictJevLowScores(e: CircuitBreakerEvidence): CircuitTriggerVerdict {
  const base = {
    consecutive_low_scores: e.consecutiveJevLowScores,
    limit: e.jevLowScoreLimit,
  }
  if (e.jevLowScoreLimit <= 0) {
    return {
      code: 'jev_low_scores',
      outcome: 'no_trigger',
      evidence: { ...base, reason: 'limit_disabled' },
    }
  }
  const fired = e.consecutiveJevLowScores >= e.jevLowScoreLimit
  return {
    code: 'jev_low_scores',
    outcome: fired ? 'switched_to_observe' : 'no_trigger',
    evidence: base,
  }
}

function verdictDataIncomplete(
  e: CircuitBreakerEvidence,
  partial: boolean,
): CircuitTriggerVerdict {
  return {
    code: 'data_incomplete',
    outcome: partial ? 'frozen_for_day' : 'no_trigger',
    evidence: { data_completeness: e.dataCompleteness },
  }
}

function buildHumanReason(
  firedTriggers: readonly CircuitTriggerCode[],
): string | null {
  if (firedTriggers.length === 0) {
    return null
  }
  if (firedTriggers.length === 1 && firedTriggers[0] === 'data_incomplete') {
    return '今天的广告数据没采全，这个客户今天不出动作；明天数据补全会自动恢复，不用你点开关。'
  }
  const names = firedTriggers.map((code) => TRIGGER_LABELS[code]).join('、')
  return `自治已切回只观察：${names}。要重新打开自治，请到看板把开关拨回自动。`
}

export function evaluateCircuitBreaker(
  e: CircuitBreakerEvidence,
): CircuitBreakerDecision {
  const partial = e.dataCompleteness === 'partial'

  const verdicts: readonly CircuitTriggerVerdict[] = [
    verdictSpendSpike(e, partial),
    verdictAccountOverDailyCap(e, partial),
    verdictKernelRollbackFailed(e),
    verdictJevLowScores(e),
    verdictDataIncomplete(e, partial),
  ]

  const firedTriggers = verdicts
    .filter(
      (v) => v.outcome !== 'no_trigger' && v.outcome !== 'unknown_data_partial',
    )
    .map((v) => v.code)

  const switchToObserve = firedTriggers.some((code) =>
    OBSERVE_SWITCHING_TRIGGERS.includes(code),
  )
  const actionsAllowed = firedTriggers.length === 0
  const requiresPmReset = switchToObserve

  return {
    verdicts,
    firedTriggers,
    switchToObserve,
    actionsAllowed,
    requiresPmReset,
    humanReason: buildHumanReason(firedTriggers),
  }
}
