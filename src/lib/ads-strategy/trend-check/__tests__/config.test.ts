import { describe, expect, it } from 'vitest'
import { DEFAULT_TREND_CHECK_RULES, rulesFromLeadsConfig } from '../config'

describe('ads_trend_check config', () => {
  it('defaults match设计稿 §3.3', () => {
    expect(DEFAULT_TREND_CHECK_RULES.ctrDropPct).toBe(30)
    expect(DEFAULT_TREND_CHECK_RULES.singleCreativeMinDays).toBe(10)
    expect(DEFAULT_TREND_CHECK_RULES.frequencyGuardEnabled).toBe(false)
  })

  it('parses client overrides from leads_config', () => {
    const rules = rulesFromLeadsConfig({
      ads_trend_check: {
        ctr_drop_pct: 25,
        single_creative_min_days: 8,
        frequency_guard_enabled: true,
        frequency_7d_max: 4.5,
      },
    })
    expect(rules.ctrDropPct).toBe(25)
    expect(rules.singleCreativeMinDays).toBe(8)
    expect(rules.frequencyGuardEnabled).toBe(true)
    expect(rules.frequency7dMax).toBe(4.5)
  })

  it('ignores invalid override fields', () => {
    const rules = rulesFromLeadsConfig({ ads_trend_check: { ctr_drop_pct: -1, min_impressions_for_ctr: 10 } })
    expect(rules.ctrDropPct).toBe(30)
    expect(rules.minImpressionsForCtr).toBe(400)
  })
})
