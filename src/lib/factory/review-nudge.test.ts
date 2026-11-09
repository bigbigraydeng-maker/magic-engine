import { describe, expect, it } from 'vitest'
import { REVIEW_NUDGE_AFTER_MS, reviewAge } from './review-nudge'

const now = new Date('2026-10-27T00:00:00.000Z')

describe('reviewAge', () => {
  it('nudges at 24 hours and waits before that', () => {
    const exact = new Date(now.getTime() - REVIEW_NUDGE_AFTER_MS).toISOString()
    const early = new Date(now.getTime() - REVIEW_NUDGE_AFTER_MS + 1).toISOString()
    expect(reviewAge(exact, now)).toBe('nudge')
    expect(reviewAge(early, now)).toBe('wait')
  })

  it('an unreadable time is not treated as still waiting', () => {
    expect(reviewAge(null, now)).toBe('unreadable')
    expect(reviewAge('not-a-date', now)).toBe('unreadable')
    expect(reviewAge('', now)).toBe('unreadable')
  })
})
