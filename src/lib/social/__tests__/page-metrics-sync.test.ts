/**
 * Unit tests for the pure rollup in page-metrics-sync.ts (社媒数据监控复活).
 */

import { describe, it, expect } from 'vitest'
import { computeSocialRollup } from '../page-metrics-sync'
import type { PagePost } from '@/lib/meta/page-posts'

const NOW = new Date('2026-08-01T12:00:00Z')

function post(partial: Partial<PagePost>): PagePost {
  return {
    postId: 'p1',
    fullId: 'page_p1',
    createdAt: '2026-07-30T00:00:00Z',
    message: 'x',
    mediaType: 'video',
    reactions: 0,
    comments: 0,
    shares: 0,
    score: 0,
    ...partial,
  }
}

describe('computeSocialRollup', () => {
  it('sums 7-day window only, older posts excluded from sums', () => {
    const rollup = computeSocialRollup(
      [
        post({ createdAt: '2026-07-30T00:00:00Z', reactions: 10, comments: 2, shares: 1 }),
        post({ createdAt: '2026-07-01T00:00:00Z', reactions: 99, comments: 99, shares: 99 }),
      ],
      NOW,
    )
    expect(rollup.posts_7d).toBe(1)
    expect(rollup.reactions_7d).toBe(10)
    expect(rollup.comments_7d).toBe(2)
    expect(rollup.shares_7d).toBe(1)
  })

  it('days_since_last_post uses the NEWEST post regardless of window', () => {
    const rollup = computeSocialRollup(
      [post({ createdAt: '2026-07-22T12:00:00Z' }), post({ createdAt: '2026-07-10T00:00:00Z' })],
      NOW,
    )
    expect(rollup.days_since_last_post).toBe(10)
    expect(rollup.posts_7d).toBe(0)
  })

  it('top_post_score is the max across ALL fetched posts', () => {
    const rollup = computeSocialRollup(
      [post({ score: 5 }), post({ createdAt: '2026-06-01T00:00:00Z', score: 42 })],
      NOW,
    )
    expect(rollup.top_post_score).toBe(42)
  })

  it('empty feed → zeros and null last-post (断更监控的空态)', () => {
    const rollup = computeSocialRollup([], NOW)
    expect(rollup).toEqual({
      posts_7d: 0,
      reactions_7d: 0,
      comments_7d: 0,
      shares_7d: 0,
      days_since_last_post: null,
      top_post_score: 0,
    })
  })

  it('malformed createdAt rows are skipped, not crashed on', () => {
    const rollup = computeSocialRollup([post({ createdAt: 'garbage', reactions: 7 })], NOW)
    expect(rollup.posts_7d).toBe(0)
    expect(rollup.days_since_last_post).toBeNull()
  })
})
