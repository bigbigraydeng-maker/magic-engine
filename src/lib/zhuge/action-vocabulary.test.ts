import { describe, expect, it } from 'vitest'
import {
  formatRegisteredActionPrompt,
  isRegisteredRecommendedAction,
  partitionRecommendedActions,
} from './action-vocabulary'

describe('registered recommended actions', () => {
  it('accepts flywheel vocabulary and kernel registry keys', () => {
    expect(isRegisteredRecommendedAction('seo.publish_blog')).toBe(true)
    expect(isRegisteredRecommendedAction('seo.build_publish_package')).toBe(true)
  })

  it('rejects invented slugs and the manual_review bucket itself', () => {
    expect(isRegisteredRecommendedAction('launch_google_search_ads_3pl')).toBe(false)
    expect(isRegisteredRecommendedAction('diversify_meta_ad_creatives_for_tour_recruitment')).toBe(false)
    expect(isRegisteredRecommendedAction('configure_target_keywords')).toBe(false)
    expect(isRegisteredRecommendedAction('manual_review')).toBe(false)
    expect(isRegisteredRecommendedAction('  ')).toBe(false)
  })

  it('splits a batch and tells the model the closed list', () => {
    const split = partitionRecommendedActions([
      { action_type: 'seo.refresh_blog' },
      { action_type: 'configure_target_keywords' },
    ])
    expect(split.registered.map((a) => a.action_type)).toEqual(['seo.refresh_blog'])
    expect(split.manualReview.map((a) => a.action_type)).toEqual(['configure_target_keywords'])
    expect(formatRegisteredActionPrompt()).toContain('seo.publish_blog')
    expect(formatRegisteredActionPrompt()).toContain('manual_review')
  })
})
