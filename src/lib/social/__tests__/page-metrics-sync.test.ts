/**
 * Unit tests for the pure rollup in page-metrics-sync.ts (社媒数据监控复活).
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/meta/page-sync-authorization', () => ({ authorizeConfiguredPage: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({
  fetchPagePosts: vi.fn(),
}))

import { computeSocialRollup, countPageMetricFailures, syncPageMetrics } from '../page-metrics-sync'
import type { PagePost } from '@/lib/meta/page-posts'
import { authorizeConfiguredPage } from '@/lib/meta/page-sync-authorization'
import { fetchPagePosts } from '@/lib/meta/page-posts'

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

function fakeDb(inserts: unknown[]) {
  return {
    from(table: string) {
      if (table === 'clients') {
        return {
          select: () => ({ eq: async () => ({ data: [{ id: 'client-1', factory_config: null }], error: null }) }),
        }
      }
      if (table === 'social_comment_config') {
        return { select: async () => ({ data: [{ client_id: 'client-1', fb_page_id: 'page-1' }], error: null }) }
      }
      const empty = { data: [] as unknown[], error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: async () => empty,
        update: () => chain,
        upsert: async () => ({ error: null }),
        insert: async (rows: unknown) => { inserts.push(rows); return { error: null } },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(empty)),
      }
      return chain
    },
  }
}

describe('syncPageMetrics token resolution', () => {
  it('reads with the Page token the ownership gate hands back', async () => {
    vi.mocked(authorizeConfiguredPage).mockResolvedValue({ ok: true, pageToken: 'stored-page-token', via: 'client_oauth' })
    vi.mocked(fetchPagePosts).mockResolvedValue([post({ createdAt: '2026-09-02T00:00:00Z', reactions: 3 })])
    const inserts: unknown[] = []

    const result = await syncPageMetrics(fakeDb(inserts) as never)

    expect(result.results).toEqual([{ client_id: 'client-1', page_id: 'page-1', outcome: 'synced', posts_seen: 1 }])
    expect(authorizeConfiguredPage).toHaveBeenCalledWith(expect.anything(), 'client-1', 'page-1', expect.anything())
    expect(fetchPagePosts).toHaveBeenCalledWith('page-1', 'stored-page-token', expect.any(Number))
    expect(inserts).toHaveLength(1)
  })

  it('AD-SEC-4: a configured Page not verified as this client\'s is never read and nothing is recorded under this client', async () => {
    vi.mocked(fetchPagePosts).mockClear()
    vi.mocked(authorizeConfiguredPage).mockResolvedValue({ ok: false, skipped: 'page_not_verified', reason: 'not_bound_page' })
    const inserts: unknown[] = []

    const result = await syncPageMetrics(fakeDb(inserts) as never)

    expect(result.results).toEqual([{ client_id: 'client-1', page_id: 'page-1', outcome: 'error', error: 'page_not_verified: not_bound_page' }])
    expect(countPageMetricFailures(result)).toBe(1)
    expect(fetchPagePosts).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it('Graph 190 记下来，但不算进这轮 failed；普通 500 照算', async () => {
    vi.mocked(authorizeConfiguredPage).mockResolvedValue({ ok: true, pageToken: 'stored-page-token', via: 'client_oauth' })
    vi.mocked(fetchPagePosts).mockRejectedValue(new Error('HTTP 400 code=190'))

    const tokenDead = await syncPageMetrics(fakeDb([]) as never)
    expect(tokenDead.results[0].error).toContain('190')
    expect(countPageMetricFailures(tokenDead)).toBe(0)

    vi.mocked(fetchPagePosts).mockRejectedValue(new Error('HTTP 500 boom'))
    const real = await syncPageMetrics(fakeDb([]) as never)
    expect(countPageMetricFailures(real)).toBe(1)
  })
})
