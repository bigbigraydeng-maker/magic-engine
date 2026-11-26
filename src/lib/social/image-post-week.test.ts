import { describe, expect, it } from 'vitest'

import { datesStillNeeded, decideImagePostBatch, spreadWeekDates } from './image-post-week'

const WEEK = { weekStart: '2026-11-16', weekEnd: '2026-11-22' }

describe('spreadWeekDates', () => {
  it('spaces four posts across different days of the target week', () => {
    expect(spreadWeekDates('2026-11-16', 4)).toEqual([
      '2026-11-16',
      '2026-11-18',
      '2026-11-20',
      '2026-11-22',
    ])
  })
})

describe('datesStillNeeded', () => {
  it('skips dates that already have a draft and keeps the rest', () => {
    const planned = spreadWeekDates('2026-11-16', 4)
    const existing = new Map([['2026-11-16', 1], ['2026-11-18', 1]])
    expect(datesStillNeeded(planned, existing)).toEqual(['2026-11-20', '2026-11-22'])
  })
})

describe('decideImagePostBatch', () => {
  it('uses the weekly count even when the social agent is off', () => {
    const batch = decideImagePostBatch({
      config: { social_agent: { enabled: false }, social_week: { post_per_week: 4 } },
      week: WEEK,
    })
    expect(batch).toMatchObject({ action: 'week', requested: 4, source: 'social_week' })
  })

  it('treats a configured zero as zero, not as the daily cap', () => {
    const batch = decideImagePostBatch({
      config: { social_agent: { enabled: true, image_post_per_day: 1 }, social_week: { post_per_week: 0 } },
      week: WEEK,
    })
    expect(batch).toEqual({ action: 'week-skip', skipped: 'post_per_week=0', requested: 0 })
  })

  it('keeps the per-day path when no weekly count is configured', () => {
    expect(decideImagePostBatch({ config: { social_agent: { enabled: false } }, week: WEEK })).toEqual({ action: 'day' })
    expect(decideImagePostBatch({
      config: { social_week: { post_per_week: 4 } },
      week: null,
    })).toEqual({ action: 'day' })
  })
})
