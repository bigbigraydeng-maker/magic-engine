import { describe, expect, it } from 'vitest'

import { mergeQuotaConfig, parseQuotaPatch } from '../save'

describe('mergeQuotaConfig', () => {
  it('writes quota numbers and leaves weekly_pack and other quota keys in place', () => {
    const current = {
      weekly_pack: { draft_weekday: 1 },
      other: { kept: true },
      quota: { story_per_day: 3, story_per_week: 9, post_per_week: 4, note: 'keep-me' },
    }
    const parsed = parseQuotaPatch({ story_per_week: 7, post_per_week: null, reel_per_week: 1 })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const merged = mergeQuotaConfig(current, parsed.patch)
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.config.weekly_pack).toEqual({ draft_weekday: 1 })
    expect(merged.config.other).toEqual({ kept: true })
    expect(merged.config.quota).toEqual({ story_per_day: 3, story_per_week: 7, note: 'keep-me', reel_per_week: 1 })
    expect(parseQuotaPatch({ story_per_week: 7.5 }).ok).toBe(false)
    expect(parseQuotaPatch({ story_per_week: '7' }).ok).toBe(false)
    expect(parseQuotaPatch({ weekly_pack: { draft_weekday: 2 } }).ok).toBe(false)
    expect(mergeQuotaConfig(['not-an-object'], { story_per_week: 1 }).ok).toBe(false)
  })
})
