import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_VERDICT_RULES,
  observationWindowForAction,
  rulesFromLeadsConfig,
  scoreReviewVerdict,
  tierLabelZh,
} from '../review-verdict-rules'
import { PAUSE_CARD_ACTION } from '../executed-review'
import { BUDGET_CARD_ACTION } from '../executed-review'

describe('review verdict rules', () => {
  it('parses client overrides from leads_config', () => {
    const rules = rulesFromLeadsConfig({
      ads_execution_review: {
        budget_window_days: 10,
        pause_window_days: 4,
        margin_pct: 20,
        min_primary_outcomes: 8,
      },
    })
    expect(rules).toEqual({
      budgetWindowDays: 10,
      pauseWindowDays: 4,
      marginPct: 20,
      minPrimaryOutcomes: 8,
    })
  })

  it('falls back to defaults for invalid overrides', () => {
    expect(rulesFromLeadsConfig(null)).toEqual(DEFAULT_REVIEW_VERDICT_RULES)
    expect(rulesFromLeadsConfig({ ads_execution_review: { margin_pct: -1 } }).marginPct).toBe(15)
  })

  it('scores useful / not_useful / unclear at 15%', () => {
    const rules = DEFAULT_REVIEW_VERDICT_RULES
    expect(scoreReviewVerdict({
      metric: 'ads.account.cost_per_lead',
      before: 10,
      after: 8,
      targetCost: null,
      rules,
      primaryOutcomeCount: 6,
    }).tier).toBe('useful')
    expect(scoreReviewVerdict({
      metric: 'ads.account.cost_per_lead',
      before: 10,
      after: 12,
      targetCost: null,
      rules,
      primaryOutcomeCount: 6,
    }).tier).toBe('not_useful')
    expect(scoreReviewVerdict({
      metric: 'ads.account.cost_per_lead',
      before: 10,
      after: 10.5,
      targetCost: null,
      rules,
      primaryOutcomeCount: 6,
    }).tier).toBe('unclear')
    expect(scoreReviewVerdict({
      metric: 'ads.account.cost_per_lead',
      before: 10,
      after: 8,
      targetCost: null,
      rules,
      primaryOutcomeCount: 4,
    }).tier).toBe('unclear')
  })

  it('picks default pause vs budget windows', () => {
    const rules = DEFAULT_REVIEW_VERDICT_RULES
    expect(observationWindowForAction(BUDGET_CARD_ACTION, rules, 14)).toBe(7)
    expect(observationWindowForAction(PAUSE_CARD_ACTION, rules, 7)).toBe(3)
  })

  it('maps tier labels for UI', () => {
    expect(tierLabelZh('useful')).toBe('有用')
    expect(tierLabelZh('not_useful')).toBe('没用')
    expect(tierLabelZh('unclear')).toBe('看不出')
  })
})
