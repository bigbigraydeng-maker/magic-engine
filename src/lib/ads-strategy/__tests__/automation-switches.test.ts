import { describe, expect, it } from 'vitest'
import {
  automationSwitchAuditSummary,
  mergeAdsAutomationSwitches,
  readAdsAutomationSwitches,
} from '../automation-switches'

describe('ads automation switches', () => {
  it('defaults every switch off', () => {
    expect(readAdsAutomationSwitches(null)).toEqual({
      ads_predictive_early_warning: false,
      ads_trend_check: false,
      ads_tune_cards: false,
    })
    expect(readAdsAutomationSwitches({ ads_predictive_early_warning: 'true' }).ads_predictive_early_warning).toBe(false)
    expect(readAdsAutomationSwitches({ ads_tune_cards: { enabled: true } }).ads_tune_cards).toBe(false)
  })

  it('reads trend check as true or { enabled: true }', () => {
    expect(readAdsAutomationSwitches({ ads_trend_check: true }).ads_trend_check).toBe(true)
    expect(readAdsAutomationSwitches({ ads_trend_check: { enabled: true, ctr_drop_pct: 25 } }).ads_trend_check).toBe(true)
    expect(readAdsAutomationSwitches({ ads_trend_check: { ctr_drop_pct: 25 } }).ads_trend_check).toBe(false)
    expect(readAdsAutomationSwitches({ ads_trend_check: false }).ads_trend_check).toBe(false)
  })

  it('merges only the patched keys and keeps trend rule fields', () => {
    const next = mergeAdsAutomationSwitches(
      {
        mailchimp_enabled: true,
        ads_predictive_early_warning_config: { min_spend_major: 20 },
        ads_trend_check: { ctr_drop_pct: 25 },
      },
      { ads_trend_check: true },
    )
    expect(next.mailchimp_enabled).toBe(true)
    expect(next.ads_predictive_early_warning_config).toEqual({ min_spend_major: 20 })
    expect(next.ads_predictive_early_warning).toBeUndefined()
    expect(next.ads_tune_cards).toBeUndefined()
    expect(next.ads_trend_check).toEqual({ ctr_drop_pct: 25, enabled: true })
  })

  it('writes a plain boolean when trend check is not already an object', () => {
    const next = mergeAdsAutomationSwitches({ notify_emails: ['ops@example.test'] }, { ads_trend_check: true })
    expect(next.ads_trend_check).toBe(true)
    expect(next.notify_emails).toEqual(['ops@example.test'])
  })

  it('writes tune cards and early warning as exact booleans', () => {
    const next = mergeAdsAutomationSwitches(
      { ads_tune_cards: { enabled: true }, own_email_domains: ['example.test'] },
      { ads_tune_cards: true, ads_predictive_early_warning: false },
    )
    expect(next.ads_tune_cards).toBe(true)
    expect(next.ads_predictive_early_warning).toBe(false)
    expect(next.own_email_domains).toEqual(['example.test'])
  })

  it('audits only the switches that flipped', () => {
    const before = readAdsAutomationSwitches({})
    const after = readAdsAutomationSwitches({ ads_predictive_early_warning: true })
    expect(automationSwitchAuditSummary(before, before)).toBeNull()
    expect(automationSwitchAuditSummary(before, after)).toBe('【Meta 广告】广告自动化开关：日内预警 关→开。')
  })
})
