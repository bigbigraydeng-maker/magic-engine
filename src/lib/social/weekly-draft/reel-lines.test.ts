import { describe, expect, it } from 'vitest'

import { mergeScheduledReels } from './reel-lines'

const WEEK = { weekStart: '2026-11-09', weekEnd: '2026-11-15' }

describe('mergeScheduledReels', () => {
  it('keeps reels already dated in the target week when this run scheduled none', () => {
    const merged = mergeScheduledReels(
      [],
      [{ id: 'old', publishOn: '2026-11-11' }],
      WEEK,
    )
    expect(merged).toEqual([{ id: 'old', publishOn: '2026-11-11' }])
  })

  it('unions this run with the week and drops dates outside the week', () => {
    const merged = mergeScheduledReels(
      [{ id: 'new', publishOn: '2026-11-16' }],
      [
        { id: 'old', publishOn: '2026-11-12' },
        { id: 'next', publishOn: '2026-11-20' },
      ],
      WEEK,
    )
    expect(merged).toEqual([
      { id: 'old', publishOn: '2026-11-12' },
      { id: 'new', publishOn: '2026-11-16' },
    ])
  })

  it('keeps one row when the same reel is in both lists', () => {
    const merged = mergeScheduledReels(
      [{ id: 'same', publishOn: '2026-11-14' }],
      [{ id: 'same', publishOn: '2026-11-10' }],
      WEEK,
    )
    expect(merged).toEqual([{ id: 'same', publishOn: '2026-11-14' }])
  })
})
