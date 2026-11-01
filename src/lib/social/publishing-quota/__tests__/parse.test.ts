import { describe, expect, it } from 'vitest'

import { phraseFor, quotaPhrase, usagePhrase } from '../format'
import {
  kindCap,
  parsePublishingQuota,
  quotaRecordFromConfig,
  weeklyQuotaEnabled,
  type PublishingQuota,
} from '../parse'

const BOTH = {
  post_per_day: 2,
  story_per_day: 3,
  reel_per_week: 3,
  post_per_week: 4,
  story_per_week: 18,
}

function story(quota: PublishingQuota | null) {
  return kindCap(quota, 'story')
}

describe('weekly quota switch', () => {
  it('is on only for the exact string true', () => {
    expect(weeklyQuotaEnabled({ SOCIAL_WEEKLY_QUOTA_ENABLED: 'true' })).toBe(true)
    for (const value of ['TRUE', 'True', '1', 'yes', ' true', 'true ', '']) {
      expect(weeklyQuotaEnabled({ SOCIAL_WEEKLY_QUOTA_ENABLED: value })).toBe(false)
    }
    expect(weeklyQuotaEnabled({})).toBe(false)
  })
})

describe('parsePublishingQuota', () => {
  it('keeps a per-day config unchanged when the switch is off', () => {
    const daily = { post_per_day: 2, story_per_day: 3, reel_per_week: 3 }
    const off = parsePublishingQuota(daily, false)
    const on = parsePublishingQuota(daily, true)
    expect(off).toEqual(on)
    expect(story(off)).toEqual({ period: 'day', count: 3 })
    expect(kindCap(off, 'post')).toEqual({ period: 'day', count: 2 })
    expect(kindCap(off, 'reel')).toEqual({ period: 'week', count: 3 })
  })

  it('ignores weekly keys while the switch is off (mutation: weekly must not leak)', () => {
    const off = parsePublishingQuota(BOTH, false)
    const on = parsePublishingQuota(BOTH, true)
    expect(story(off)).toEqual({ period: 'day', count: 3 })
    expect(off?.story_per_week).toBeNull()
    expect(off?.post_per_week).toBeNull()
    expect(story(on)).not.toEqual(story(off))
  })

  it('lets a weekly whole number win per kind when the switch is on', () => {
    const on = parsePublishingQuota(BOTH, true)
    expect(story(on)).toEqual({ period: 'week', count: 18 })
    expect(kindCap(on, 'post')).toEqual({ period: 'week', count: 4 })
    expect(kindCap(on, 'reel')).toEqual({ period: 'week', count: 3 })
    expect(on?.story_per_day).toBeNull()
    expect(on?.post_per_day).toBeNull()
  })

  it('a weekly key on one kind does not blank the other kind\'s daily cap', () => {
    const on = parsePublishingQuota({ story_per_week: 18, post_per_day: 2, reel_per_week: 3 }, true)
    expect(story(on)).toEqual({ period: 'week', count: 18 })
    expect(kindCap(on, 'post')).toEqual({ period: 'day', count: 2 })
    const dropped = parsePublishingQuota({ post_per_day: 2, reel_per_week: 3 }, true)
    expect(kindCap(on, 'post')).toEqual(kindCap(dropped, 'post'))
  })

  it('an unusable weekly value falls back to the daily cap instead of becoming 0', () => {
    for (const story_per_week of ['18', 18.5, -1, true, null]) {
      const parsed = parsePublishingQuota({ story_per_day: 3, story_per_week, post_per_day: 1 }, true)
      expect(story(parsed)).toEqual({ period: 'day', count: 3 })
    }
  })

  it('zero is a real cap, not "missing" (mutation: treating 0 as absent would show the daily number)', () => {
    const parsed = parsePublishingQuota({ story_per_day: 3, story_per_week: 0 }, true)
    expect(story(parsed)).toEqual({ period: 'week', count: 0 })
    expect(parsed?.story_per_day).toBeNull()
  })

  it('weekly-only config is invisible until the switch is on, then it is the cap', () => {
    const weeklyOnly = { story_per_week: 18, post_per_week: 4, reel_per_week: 3 }
    expect(parsePublishingQuota(weeklyOnly, false)?.story_period).toBeNull()
    expect(parsePublishingQuota(weeklyOnly, false)?.post_period).toBeNull()
    expect(kindCap(parsePublishingQuota(weeklyOnly, false), 'reel')).toEqual({ period: 'week', count: 3 })
    expect(story(parsePublishingQuota(weeklyOnly, true))).toEqual({ period: 'week', count: 18 })
  })

  it('empty, non-object, or all-invalid quota is not configured', () => {
    expect(parsePublishingQuota({}, true)).toBeNull()
    expect(parsePublishingQuota({ story_per_day: '3' }, false)).toBeNull()
    expect(parsePublishingQuota([], true)).toBeNull()
    expect(parsePublishingQuota(null, true)).toBeNull()
  })

  it('reads quota from the calendar column and ignores the weekday block', () => {
    const config = { weekly_pack: { draft_weekday: 4 }, quota: BOTH }
    expect(quotaRecordFromConfig(config)).toEqual(BOTH)
    expect(quotaRecordFromConfig({ weekly_pack: { draft_weekday: 4 } })).toBeNull()
    expect(quotaRecordFromConfig(null)).toBeNull()
    expect(story(parsePublishingQuota(quotaRecordFromConfig(config), false))).toEqual({ period: 'day', count: 3 })
  })
})

describe('kindCap for older payloads', () => {
  it('without a period, the daily number wins when both numbers are present', () => {
    const legacy = { post_per_day: 2, story_per_day: 3, reel_per_week: 3, story_per_week: 18, post_per_week: 4 }
    expect(kindCap(legacy, 'story')).toEqual({ period: 'day', count: 3 })
    expect(kindCap({ ...legacy, story_period: 'week', story_per_day: null }, 'story')).toEqual({ period: 'week', count: 18 })
  })

  it('does not borrow another kind\'s weekly number', () => {
    const quota = { post_per_week: 4, story_per_week: 18, post_period: 'week' as const, story_period: 'week' as const, reel_per_week: null }
    expect(kindCap(quota, 'reel')).toBeNull()
    expect(kindCap(quota, 'post')?.count).toBe(4)
  })
})

describe('quota sentences', () => {
  it('prints the winning period, and never uses a weekly cap as a day\'s denominator', () => {
    const on = parsePublishingQuota(BOTH, true)
    const off = parsePublishingQuota(BOTH, false)
    expect(phraseFor(off, 'story', 'day')).toBe('每天名额 3 条')
    expect(phraseFor(on, 'story', 'day')).toBe('每周名额 18 条')
    expect(phraseFor(on, 'post', 'day')).toBe('每周名额 4 条')
    expect(phraseFor(null, 'reel', 'week')).toBe('每周名额未配置')
    expect(usagePhrase(2, kindCap(off, 'story'), 'day')).toBe('用了 2/3')
    expect(usagePhrase(2, kindCap(on, 'story'), 'day')).toBe('2 条')
    expect(usagePhrase(2, kindCap(on, 'story'), 'week')).toBe('用了 2/18')
    expect(usagePhrase(2, null, 'day')).toBe('2 条（名额未配置）')
    expect(quotaPhrase(kindCap(on, 'story'), 'day')).not.toBe(quotaPhrase(kindCap(off, 'story'), 'day'))
  })
})
