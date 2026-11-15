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
      loadExistingReels: async () => [],
    })
    expect(result.story.drafted).toBe(0)
    expect(result.story.packId).toBeNull()
    expect(result.story.error).toBeTruthy()
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
      loadExistingReels: async () => [],
    })
    expect(runImage).toHaveBeenCalledWith('c1', '2026-11-05', expect.anything(), null, expect.objectContaining({
      week: { weekStart: '2026-11-09', weekEnd: '2026-11-15' },
    }))
    expect(result.summary.stills.skipped).toBe('factory_stills_off')
    expect(result.summary.post.drafted).toBe(4)
    expect(result.produced.post.lines).toHaveLength(4)
  })

  it('keeps reels already scheduled for the target week when this run adds none', async () => {
    runImage.mockResolvedValueOnce({
      attempted: 0, drafted: 0, planIds: [], dates: [], requested: 0, skipped: 'post_per_week=0', error: null,
    })
    const result = await prepareWeekDrafts({
      clientId: 'c1',
      now: new Date('2026-11-05T00:00:00.000Z'),
      config: { social_week: { post_per_week: 0 } },
      reelScheduled: [],
      reelScheduledCount: 0,
      supabase: {} as never,
      loadExistingReels: async () => [
        { id: 'old', publishOn: '2026-11-11' },
        { id: 'next', publishOn: '2026-11-20' },
      ],
    })
    expect(result.produced.reel.lines).toEqual([{ date: '2026-11-11', ref: 'old' }])
    expect(result.produced.reel.error).toBeNull()
    expect(result.summary.reel.drafted).toBe(1)
  })

  it('marks the reel list incomplete when already scheduled rows cannot be read', async () => {
    runImage.mockResolvedValueOnce({
      attempted: 0, drafted: 0, planIds: [], dates: [], requested: 0, skipped: null, error: null,
    })
    const result = await prepareWeekDrafts({
      clientId: 'c1',
      now: new Date('2026-11-05T00:00:00.000Z'),
      config: null,
      reelScheduled: [{ id: 'new', publishOn: '2026-11-12' }],
      reelScheduledCount: 1,
      supabase: {} as never,
      loadExistingReels: async () => 'unreadable',
    })
    expect(result.produced.reel.lines).toEqual([{ date: '2026-11-12', ref: 'new' }])
    expect(result.produced.reel.error).toBe('existing_reels_unreadable')
  })
})
