import { describe, expect, it } from 'vitest'

import { readSocialWeekOnly, resolveConfiguredWeekCounts } from './social-week-quota'

describe('resolveConfiguredWeekCounts', () => {
  it('prefers social_week over the daily quota', () => {
    const config = {
      social_week: { story_per_week: 18, post_per_week: 4, reel_per_week: 3 },
      quota: { story_per_day: 3, post_per_day: 2, reel_per_week: 9 },
    }
    expect(resolveConfiguredWeekCounts(config)).toMatchObject({
      story: { value: 18, source: 'social_week' },
      post: { value: 4, source: 'social_week' },
      reel: { value: 3, source: 'social_week' },
    })
    expect(readSocialWeekOnly(config).gaps).toEqual([])
  })

  it('falls back to quota day counts times 7 and keeps an invalid weekly number out', () => {
    const resolved = resolveConfiguredWeekCounts({
      social_week: { story_per_week: 1.5 },
      quota: { story_per_day: 3, post_per_day: 2, reel_per_week: 3 },
    })
    expect(resolved.story).toEqual({ value: 21, source: 'quota' })
    expect(resolved.post).toEqual({ value: 14, source: 'quota' })
    expect(resolved.reel).toEqual({ value: 3, source: 'quota' })
    expect(resolved.gaps[0]).toContain('没有采用')
  })

  it('leaves a blank config unresolved', () => {
    expect(resolveConfiguredWeekCounts({})).toMatchObject({
      story: { value: null, source: 'none' },
      post: { value: null, source: 'none' },
      reel: { value: null, source: 'none' },
    })
  })
})
