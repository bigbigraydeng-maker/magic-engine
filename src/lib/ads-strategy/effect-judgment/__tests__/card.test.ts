import { describe, expect, it } from 'vitest'
import {
  buildEffectJudgmentCard, dailyCapGate, effectJudgmentLines, parseEffectJudgmentCard,
  prescriptionCostReadings, storedEffectCard,
  type EffectJudgmentCard, type EffectJudgmentSources,
} from '../card'

const GOAL = {
  periodStart: '2026-10-01',
  periodEnd: '2026-10-30',
  targetValue: 100,
  baselineValue: 0,
  budgetCurrency: 'NZD',
}

function sources(over: Partial<EffectJudgmentSources> = {}): EffectJudgmentSources {
  return {
    goal: GOAL,
    approvedPrimary: 'lead',
    approvedCost: { amount: 12, currency: null },
    approvedCostState: 'value',
    prescriptionCosts: [],
    dailyCapCents: 5000,
    dailyCapState: 'value',
    today: '2026-10-20',
    actualToDate: 70,
    medianCostCents: 1200,
    sampleDays: null,
    loadError: null,
    ...over,
  }
}

function card(over: Partial<EffectJudgmentCard> = {}): EffectJudgmentCard {
  const built = buildEffectJudgmentCard(sources())
  return { ...built, ...over }
}

describe('effect judgment card', () => {
  it('writes the four facts from the goal, the approved cost, and the daily cap', () => {
    const built = buildEffectJudgmentCard(sources())
    expect(built.primary_result).toBe('lead')
    expect(built.cost_per_result).toMatchObject({ amount: 12, currency: 'NZD', empty_reason: null })
    expect(built.daily_spend_cap).toMatchObject({ cents: 5000, currency: 'NZD', empty_reason: null })
    expect(built.review).toEqual({
      anchor: '2026-10-01',
      day7: '2026-10-07',
      day14: '2026-10-14',
      empty_reason: null,
    })
    expect(built.pacing.line).toBeTruthy()
    expect(built.pacing.empty_reason).toBeNull()
    expect(built.blocked).toBe(false)
    const text = effectJudgmentLines(built).join('\n')
    expect(text).toContain('每个结果最多花 12 NZD')
    expect(text).toContain('每天最多花 50 NZD')
    expect(text).toContain('不会改广告预算')
    expect(text).toContain('2026年10月7日')
    expect(text).toContain('2026年10月14日')
    expect(text).not.toMatch(/[{}[\]]/)
  })

  it('leaves a missing cost empty and does not invent zero or use history', () => {
    const built = buildEffectJudgmentCard(sources({
      approvedCost: null,
      approvedCostState: 'missing',
      medianCostCents: 900,
    }))
    expect(built.cost_per_result.amount).toBeNull()
    expect(built.cost_per_result.empty_reason).toContain('不能用历史花费代替')
    expect(built.blocked).toBe(true)
    expect(effectJudgmentLines(built).join('\n')).toContain('还没写下')
  })

  it('does not adopt a cost that only appears in the prescription text', () => {
    const built = buildEffectJudgmentCard(sources({
      approvedCost: null,
      approvedCostState: 'missing',
      prescriptionCosts: [{ amount: 12, currency: 'NZD' }],
    }))
    expect(built.cost_per_result.amount).toBeNull()
    expect(built.cost_per_result.empty_reason).toContain('不能拿它当已批准的成本')
  })

  it('blocks when the approved cost and the prescription cost disagree', () => {
    const built = buildEffectJudgmentCard(sources({
      prescriptionCosts: [{ amount: 18, currency: 'NZD' }],
    }))
    expect(built.cost_per_result.amount).toBeNull()
    expect(built.cost_per_result.empty_reason).toContain('不取其中一个')
    expect(built.cost_per_result.empty_reason).toContain('12')
    expect(built.cost_per_result.empty_reason).toContain('18')
  })

  it('keeps the cost when both places agree', () => {
    const built = buildEffectJudgmentCard(sources({
      prescriptionCosts: [{ amount: 12, currency: 'NZD' }],
    }))
    expect(built.cost_per_result.amount).toBe(12)
    expect(built.cost_per_result.source).toContain('一致')
  })

  it('does not turn the goal total into a daily cap', () => {
    const built = buildEffectJudgmentCard(sources({
      dailyCapCents: null,
      dailyCapState: 'missing',
    }))
    expect(built.daily_spend_cap.cents).toBeNull()
    expect(built.daily_spend_cap.empty_reason).toContain('不能拿来分成每天')
    expect(built.pacing.line).toContain('日预算上限')
  })

  it('rejects a cap that is not whole cents', () => {
    const built = buildEffectJudgmentCard(sources({ dailyCapCents: 10.5 }))
    expect(built.daily_spend_cap.cents).toBeNull()
    expect(built.daily_spend_cap.empty_reason).toContain('整数分')
    expect(built.pacing.line).toContain('日预算上限')
  })

  it('says the pace is unknown when results so far were not read', () => {
    const built = buildEffectJudgmentCard(sources({ actualToDate: null }))
    expect(built.pacing.verdict).toBe('unknown')
    expect(built.pacing.line).toContain('归属数据不足')
    expect(built.pacing.empty_reason).toBeNull()
  })

  it('leaves review dates empty when the goal has no start day', () => {
    const built = buildEffectJudgmentCard(sources({ goal: null }))
    expect(built.review.day7).toBeNull()
    expect(built.review.day14).toBeNull()
    expect(built.review.empty_reason).toContain('开始日')
    expect(built.pacing.empty_reason).toContain('没有目标')
  })

  it('rejects an impossible start day instead of rolling it over', () => {
    const built = buildEffectJudgmentCard(sources({
      goal: { ...GOAL, periodStart: '2026-02-31' },
    }))
    expect(built.review.day7).toBeNull()
  })

  it('round-trips a stored card and treats a missing key as an older prescription', () => {
    const built = buildEffectJudgmentCard(sources())
    expect(parseEffectJudgmentCard(built)).toEqual(built)
    expect(parseEffectJudgmentCard({ ...built, primary_result: undefined })?.primary_result).toBeNull()
    expect(storedEffectCard({ measure: built })).toEqual(built)
    expect(storedEffectCard({})).toBeUndefined()
    expect(storedEffectCard(null)).toBeUndefined()
  })

  it('blocks an unreadable card instead of filling numbers', () => {
    const stored = storedEffectCard({ measure: { v: 1, cost_per_result: { amount: '12' } } })
    expect(stored?.cost_per_result.amount).toBeNull()
    expect(stored?.blocked).toBe(true)
    expect(stored?.block_reasons[0]).toContain('读不懂')
  })

  it('reads only cost metrics from prescription targets', () => {
    expect(prescriptionCostReadings([
      { metric: '线索', target_value: 10, unit: '条' },
      { metric: '成本', target_value: 12, unit: 'NZD' },
      { metric: 'CPL', target_value: 0, unit: 'NZD' },
    ])).toEqual([{ amount: 12, currency: 'NZD' }])
  })

  it('checks the recorded daily cap and does not pick a side when they differ', () => {
    expect(dailyCapGate(undefined, 5000)).toEqual({ action: 'keep' })
    expect(dailyCapGate(card(), 5000)).toEqual({ action: 'keep' })
    const clash = dailyCapGate(card(), 8000)
    expect(clash.action).toBe('block')
    if (clash.action === 'block') expect(clash.reason).toContain('不取其中一个')
    const blank = dailyCapGate(card({
      daily_spend_cap: { cents: null, currency: null, source: null, empty_reason: '还没设置。' },
    }), 5000)
    expect(blank).toEqual({ action: 'block', reason: '还没设置。' })
  })

  it('says there is no card when the page has nothing to read', () => {
    expect(effectJudgmentLines(null)).toEqual(['这份处方还没有效果判断卡。'])
  })
})
