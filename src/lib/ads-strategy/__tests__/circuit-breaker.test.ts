import { describe, it, expect } from 'vitest'

import {
  evaluateCircuitBreaker,
  SPEND_SPIKE_MEDIAN_MULTIPLE,
  type CircuitBreakerDecision,
  type CircuitBreakerEvidence,
  type CircuitTriggerCode,
  type CircuitTriggerVerdict,
} from '../circuit-breaker'

function evidence(
  over: Partial<CircuitBreakerEvidence> = {},
): CircuitBreakerEvidence {
  return {
    clientId: 'c-1',
    cycleDate: '2026-09-27',
    dataCompleteness: 'complete',
    spendTodayCents: 10_000,
    spendMedianPrev7Cents: 9_000,
    accountDeltaTodayCents: 1_000,
    dailyBudgetCapCents: 50_000,
    kernelRollbackFailures: 0,
    consecutiveJevLowScores: 0,
    jevLowScoreLimit: 3,
    ...over,
  }
}

function verdictFor(
  decision: CircuitBreakerDecision,
  code: CircuitTriggerCode,
): CircuitTriggerVerdict {
  const verdict = decision.verdicts.find((v) => v.code === code)
  if (verdict === undefined) {
    throw new Error(`verdict not found for code: ${code}`)
  }
  return verdict
}

describe('evaluateCircuitBreaker', () => {
  it('全绿时不出动作、不切 observe、没有人类理由', () => {
    const decision = evaluateCircuitBreaker(evidence())

    expect(decision.firedTriggers).toHaveLength(0)
    expect(decision.actionsAllowed).toBe(true)
    expect(decision.switchToObserve).toBe(false)
    expect(decision.humanReason).toBeNull()
  })

  it('花费超过前 7 日中位数的 3 倍时触发 spend_spike 并切回 observe', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ spendTodayCents: 28_000, spendMedianPrev7Cents: 9_000 }),
    )

    expect(decision.firedTriggers).toContain('spend_spike')
    expect(decision.switchToObserve).toBe(true)
    expect(decision.requiresPmReset).toBe(true)
    expect(decision.actionsAllowed).toBe(false)
  })

  it('花费正好等于前 7 日中位数的 3 倍时不触发（判据是严格大于）', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ spendTodayCents: 27_000, spendMedianPrev7Cents: 9_000 }),
    )

    expect(verdictFor(decision, 'spend_spike').outcome).toBe('no_trigger')
    expect(decision.firedTriggers).not.toContain('spend_spike')
  })

  it('数据不完整时只冻结当日、不切 observe，且理由说明不用点开关', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ dataCompleteness: 'partial' }),
    )

    expect(decision.firedTriggers).toEqual(['data_incomplete'])
    expect(decision.switchToObserve).toBe(false)
    expect(decision.requiresPmReset).toBe(false)
    expect(decision.actionsAllowed).toBe(false)
    expect(decision.humanReason).toContain('不用你点开关')
  })

  it('数据不完整时花费与账户两条 verdict 都是 unknown_data_partial，且不触发 spend_spike', () => {
    const decision = evaluateCircuitBreaker(
      evidence({
        dataCompleteness: 'partial',
        spendTodayCents: 999_999,
        spendMedianPrev7Cents: 1_000,
      }),
    )

    expect(verdictFor(decision, 'spend_spike').outcome).toBe(
      'unknown_data_partial',
    )
    expect(verdictFor(decision, 'account_over_daily_cap').outcome).toBe(
      'unknown_data_partial',
    )
    expect(decision.firedTriggers).not.toContain('spend_spike')
  })

  it('前 7 日中位数为 0 时 spend_spike 无法判定、不触发', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ spendMedianPrev7Cents: 0 }),
    )

    expect(verdictFor(decision, 'spend_spike').outcome).toBe(
      'unknown_data_partial',
    )
    expect(decision.firedTriggers).not.toContain('spend_spike')
  })

  it('前 7 日中位数为 null 时 spend_spike 无法判定、不触发', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ spendMedianPrev7Cents: null }),
    )

    expect(verdictFor(decision, 'spend_spike').outcome).toBe(
      'unknown_data_partial',
    )
    expect(decision.firedTriggers).not.toContain('spend_spike')
  })

  it('账户改动超过日预算上限时触发 account_over_daily_cap 并切回 observe', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ accountDeltaTodayCents: 60_000, dailyBudgetCapCents: 50_000 }),
    )

    expect(decision.firedTriggers).toContain('account_over_daily_cap')
    expect(decision.switchToObserve).toBe(true)
  })

  it('日预算上限为 null 时 account_over_daily_cap 无法判定、不触发', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ dailyBudgetCapCents: null }),
    )

    expect(verdictFor(decision, 'account_over_daily_cap').outcome).toBe(
      'unknown_data_partial',
    )
    expect(decision.firedTriggers).not.toContain('account_over_daily_cap')
  })

  it('有撤回失败且数据不完整时两条都触发，并切回 observe', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ kernelRollbackFailures: 1, dataCompleteness: 'partial' }),
    )

    expect(decision.firedTriggers).toContain('kernel_rollback_failed')
    expect(decision.firedTriggers).toContain('data_incomplete')
    expect(decision.switchToObserve).toBe(true)
  })

  it('连续低分达到上限时触发 jev_low_scores（判据是大于等于）', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ consecutiveJevLowScores: 3, jevLowScoreLimit: 3 }),
    )

    expect(decision.firedTriggers).toContain('jev_low_scores')
  })

  it('连续低分未达到上限时不触发 jev_low_scores', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ consecutiveJevLowScores: 2, jevLowScoreLimit: 3 }),
    )

    expect(decision.firedTriggers).not.toContain('jev_low_scores')
  })

  it('低分上限为 0 时该判据被禁用、不触发', () => {
    const decision = evaluateCircuitBreaker(
      evidence({ consecutiveJevLowScores: 99, jevLowScoreLimit: 0 }),
    )

    expect(verdictFor(decision, 'jev_low_scores').outcome).toBe('no_trigger')
    expect(decision.firedTriggers).not.toContain('jev_low_scores')
  })

  it('verdicts 恒为 5 条且顺序固定，花费倍数常量为 3', () => {
    const decision = evaluateCircuitBreaker(evidence())

    expect(decision.verdicts).toHaveLength(5)
    expect(decision.verdicts.map((v) => v.code)).toEqual([
      'spend_spike',
      'account_over_daily_cap',
      'kernel_rollback_failed',
      'jev_low_scores',
      'data_incomplete',
    ])
    expect(SPEND_SPIKE_MEDIAN_MULTIPLE).toBe(3)
  })
})
