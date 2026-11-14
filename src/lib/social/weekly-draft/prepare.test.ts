import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/openai-client', () => ({
  getOpenAIClient: () => ({ chat: { completions: { create: vi.fn() } } }),
}))
vi.mock('@/lib/social/image-post-step', () => ({ runImagePostStep: vi.fn() }))

import { runImagePostStep } from '@/lib/social/image-post-step'
import { prepareWeekDrafts } from './prepare'

const runImage = vi.mocked(runImagePostStep)

describe('prepareWeekDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
  })

  it('keeps the story skip when image drafting throws', async () => {
    runImage.mockRejectedValueOnce(new Error('boom'))
    const result = await prepareWeekDrafts({
      clientId: 'c1',
      now: new Date('2026-11-05T00:00:00.000Z'),
      config: { social_week: { story_per_week: 18, post_per_week: 4, reel_per_week: 3 } },
      reelScheduled: [{ id: 'r1', publishOn: '2026-11-16' }],
      reelScheduledCount: 1,
      supabase: {} as never,
    })
    expect(result.story).toMatchObject({ drafted: 0, packId: null, skipped: 'no_automatic_story_asset_source', error: null })
    expect(result.image.error).toContain('image_step_failed: boom')
    expect(result.produced.reel.lines).toEqual([{ date: '2026-11-16', ref: 'r1' }])
    expect(result.summary.post.drafted).toBe(0)
    expect(result.summary.reel.error).toBeNull()
  })

  it('asks image drafts for the target week', async () => {
    runImage.mockResolvedValueOnce({
      attempted: 4, drafted: 4, planIds: ['a', 'b', 'c', 'd'],
      dates: ['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-22'],
      requested: 4, skipped: null, error: null,
    })
    const result = await prepareWeekDrafts({
      clientId: 'c1',
      now: new Date('2026-11-05T00:00:00.000Z'),
      config: { social_week: { post_per_week: 4 } },
      reelScheduled: [],
      reelScheduledCount: 0,
      supabase: {} as never,
    })
    expect(runImage).toHaveBeenCalledWith('c1', '2026-11-05', expect.anything(), null, expect.objectContaining({
      week: { weekStart: '2026-11-09', weekEnd: '2026-11-15' },
    }))
    expect(result.summary.post.drafted).toBe(4)
    expect(result.produced.post.lines).toHaveLength(4)
  })
})
