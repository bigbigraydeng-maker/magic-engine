import { describe, it, expect } from 'vitest'
import { METRIC_POLARITY, getMetricPolarity, isLowerBetter } from '../polarity'
import { HEALTH_METRICS } from '../health/score'

describe('metric polarity', () => {
  it('marks cost and rank metrics as lower_is_better', () => {
    expect(getMetricPolarity('ads.account.cost_per_lead')).toBe('lower_is_better')
    expect(getMetricPolarity('ads.account.cost_per_conversation')).toBe('lower_is_better')
    expect(getMetricPolarity('ads.account.cpa')).toBe('lower_is_better')
    expect(getMetricPolarity('ads.account.cpc')).toBe('lower_is_better')
    expect(getMetricPolarity('geo.query.avg_rank')).toBe('lower_is_better')
  })

  it('marks spend as neutral', () => {
    expect(METRIC_POLARITY['ads.account.spend']).toBe('neutral')
    expect(getMetricPolarity('ads.account.spend')).toBe('neutral')
  })

  it('defaults unlisted keys to higher_is_better', () => {
    expect(getMetricPolarity('ads.account.clicks')).toBe('higher_is_better')
    expect(getMetricPolarity('ads.account.roas')).toBe('higher_is_better')
    expect(getMetricPolarity('ads.account.ctr')).toBe('higher_is_better')
    expect(getMetricPolarity('geo.query.mention_rate')).toBe('higher_is_better')
    expect(getMetricPolarity('made.up.key')).toBe('higher_is_better')
  })

  it('isLowerBetter is false for neutral metrics', () => {
    expect(isLowerBetter('ads.account.spend')).toBe(false)
  })
})

describe('HEALTH_METRICS agrees with the polarity table', () => {
  const flat = Object.values(HEALTH_METRICS).flat()

  it('every entry matches isLowerBetter', () => {
    for (const m of flat) {
      expect(m.lowerIsBetter).toBe(isLowerBetter(m.key))
    }
  })

  it('lower-is-better keys are flagged true', () => {
    const lowerBetterKeys = [
      'seo.gsc.avg_position',
      'seo.ga4.bounce_rate',
      'geo.query.avg_rank',
      'ads.account.cpa',
    ]
    for (const key of lowerBetterKeys) {
      const entry = flat.find(m => m.key === key)
      expect(entry).toBeDefined()
      expect(entry?.lowerIsBetter).toBe(true)
    }
  })

  it('higher-is-better keys are flagged false', () => {
    const higherBetterKeys = [
      'seo.gsc.clicks',
      'seo.ga4.sessions',
      'geo.query.mention_rate',
      'ads.account.roas',
      'ads.account.ctr',
      'social.account.engagement_rate',
      'social.posts.published_count',
    ]
    for (const key of higherBetterKeys) {
      const entry = flat.find(m => m.key === key)
      expect(entry).toBeDefined()
      expect(entry?.lowerIsBetter).toBe(false)
    }
  })
})
