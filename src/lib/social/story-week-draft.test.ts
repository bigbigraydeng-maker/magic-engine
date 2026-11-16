import { describe, expect, it } from 'vitest'

import { planStoryWeekDraft } from './story-week-draft'

describe('planStoryWeekDraft', () => {
  it('asks for factory stills when a weekly count is set and does not insert here', () => {
    const receipt = planStoryWeekDraft({ social_week: { story_per_week: 18, post_per_week: 4, reel_per_week: 3 } })
    expect(receipt).toMatchObject({
      requested: 18,
      drafted: 0,
      packId: null,
      skipped: null,
      error: null,
      source: 'social_week',
      lines: [],
    })
  })

  it('uses the quota week count when social_week is absent', () => {
    const receipt = planStoryWeekDraft({ quota: { story_per_day: 3 } })
    expect(receipt.requested).toBe(21)
    expect(receipt.source).toBe('quota')
    expect(receipt.skipped).toBeNull()
  })

  it('skips a missing count and an explicit zero without an error', () => {
    expect(planStoryWeekDraft({}).skipped).toBe('no_story_quota')
    expect(planStoryWeekDraft({ social_week: { story_per_week: 0 } })).toMatchObject({
      requested: 0,
      drafted: 0,
      skipped: 'story_count_zero',
    })
  })
})
