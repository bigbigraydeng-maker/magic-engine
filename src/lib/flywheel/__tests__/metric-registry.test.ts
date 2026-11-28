/**
 * Metric registry — the reconciliation gate.
 *
 * The bug this guards: an ads action declared `expected_metric` for a key no
 * puller ever wrote. The attribution job found no baseline, returned false,
 * counted it as "skipped", and logged nothing — 24 actions, 0 outcomes, no
 * error anywhere for months.
 */

import { describe, it, expect } from 'vitest'
import { ADS_METRIC_KEY } from '../vocabulary'
import {
  ADS_METRIC_PULLERS,
  UnpullableMetricError,
  adsMetricKeysWrittenBy,
  assertAdsExpectedMetric,
  isAdsMetricPulled,
} from '../metric-registry'

describe('ADS_METRIC_PULLERS registry', () => {
  it('covers every key declared in ADS_METRIC_KEY', () => {
    // The Record<AdsMetricKey, …> type makes this a compile error too; the
    // runtime assertion keeps it visible if the typing is ever loosened.
    for (const key of Object.values(ADS_METRIC_KEY)) {
      expect(ADS_METRIC_PULLERS).toHaveProperty(key)
    }
    expect(Object.keys(ADS_METRIC_PULLERS)).toHaveLength(Object.values(ADS_METRIC_KEY).length)
  })

  it('registers the objective-aware cost metrics against the Meta pullback', () => {
    expect(adsMetricKeysWrittenBy('meta_ads_pullback')).toEqual([
      ADS_METRIC_KEY.CPA,
      ADS_METRIC_KEY.COST_PER_LEAD,
      ADS_METRIC_KEY.COST_PER_CONVERSATION,
    ])
  })

  it('registers exactly the seven keys the Google Ads arm writes', () => {
    expect(adsMetricKeysWrittenBy('google_ads_pullback').sort()).toEqual([
      ADS_METRIC_KEY.GOOGLE_CLICKS,
      ADS_METRIC_KEY.GOOGLE_CONVERSIONS,
      ADS_METRIC_KEY.GOOGLE_CPA,
      ADS_METRIC_KEY.GOOGLE_CPC,
      ADS_METRIC_KEY.GOOGLE_CTR,
      ADS_METRIC_KEY.GOOGLE_IMPRESSIONS,
      ADS_METRIC_KEY.GOOGLE_SPEND,
    ].sort())
  })

  it('never lets Google Ads share a metric key with a Meta puller', () => {
    // Readers of ads.account.* select by metric_key and ignore `source`, so a
    // shared key blends two platforms into one number with no error anywhere.
    const metaKeys = new Set([
      ...adsMetricKeysWrittenBy('meta_ads'),
      ...adsMetricKeysWrittenBy('meta_ads_pullback'),
    ])
    const googleKeys = adsMetricKeysWrittenBy('google_ads_pullback')
    expect(googleKeys.filter(key => metaKeys.has(key))).toEqual([])
    for (const key of googleKeys) expect(key.startsWith('ads.google.')).toBe(true)
  })
})

describe('isAdsMetricPulled', () => {
  it('accepts a key that has at least one puller', () => {
    expect(isAdsMetricPulled(ADS_METRIC_KEY.COST_PER_CONVERSATION)).toBe(true)
    expect(isAdsMetricPulled(ADS_METRIC_KEY.SPEND)).toBe(true)
  })

  it('rejects a string that is not an ads metric key at all', () => {
    // These three are real values found in production flywheel_actions rows —
    // invented names that were never in the vocabulary.
    expect(isAdsMetricPulled('roi_efficiency')).toBe(false)
    expect(isAdsMetricPulled('ad_set_active')).toBe(false)
    expect(isAdsMetricPulled('seo.domain.organic_traffic')).toBe(false)
  })
})

describe('assertAdsExpectedMetric — the gate', () => {
  it('lets a pulled metric through', () => {
    expect(() => assertAdsExpectedMetric(ADS_METRIC_KEY.ROAS, 'test')).not.toThrow()
    expect(() => assertAdsExpectedMetric(ADS_METRIC_KEY.COST_PER_LEAD, 'test')).not.toThrow()
  })

  it('lets null / undefined through — unmeasured is honest, false promises are not', () => {
    expect(() => assertAdsExpectedMetric(null, 'test')).not.toThrow()
    expect(() => assertAdsExpectedMetric(undefined, 'test')).not.toThrow()
  })

  it('THROWS on a metric key that exists nowhere in the vocabulary', () => {
    expect(() => assertAdsExpectedMetric('roi_efficiency', 'test'))
      .toThrow(UnpullableMetricError)
    expect(() => assertAdsExpectedMetric('roi_efficiency', 'test'))
      .toThrow(/not a key in ADS_METRIC_KEY/)
  })

  it('THROWS on a key from another flywheel misfiled as an ads metric', () => {
    expect(() => assertAdsExpectedMetric('geo.query.mention_rate', 'test'))
      .toThrow(UnpullableMetricError)
  })

  it('names the calling context in the error so the bad writer is identifiable', () => {
    expect(() => assertAdsExpectedMetric('ads.account.made_up', 'MetaAdsAdapter.execute'))
      .toThrow(/MetaAdsAdapter\.execute/)
  })
})
