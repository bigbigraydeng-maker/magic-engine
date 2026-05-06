/**
 * Tests for content_strategy_items database operations (Phase 8.D.1.1)
 *
 *  - listStrategyItems: filter by status / action_type / strategy_run_id
 *    + ordered by priority_score desc + optional limit
 *  - insertStrategyItems: bulk insert (a single analyzer run produces many)
 *  - updateStrategyStatus: change status + optionally set linked_blog_post_id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => {
  const fromMock = vi.fn()
  return {
    supabaseAdmin: { from: fromMock },
    supabase: { from: fromMock },
  }
})

import {
  listStrategyItems,
  insertStrategyItems,
  updateStrategyStatus,
  countStrategyItemsByStatus,
} from './strategy-items'
import { supabaseAdmin } from '@/lib/supabase'
import type { ContentStrategyItem } from '@/types/magic-engine'

const CLIENT_ID = 'client-1'

const sample: ContentStrategyItem = {
  id: 'item-1',
  client_id: CLIENT_ID,
  strategy_run_id: 'run-1',
  action_type: 'new_blog',
  content_mode: 'unified',
  priority: 'high',
  priority_score: 82,
  proposed_title: 'How NZ travellers get a China visa',
  rationale: 'AI weak spot + low KD keyword + no existing page',
  content_angle: null,
  source_page_id: null,
  source_query_id: 'q-1',
  source_keyword: 'china visa nz',
  keyword_volume: 480,
  keyword_kd: 32,
  status: 'pending',
  linked_blog_post_id: null,
  created_at: '2026-05-05T00:00:00Z',
  updated_at: '2026-05-05T00:00:00Z',
}

describe('Strategy Items DB', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listStrategyItems', () => {
    it('lists by client_id ordered by priority_score desc', async () => {
      const limit = vi.fn().mockResolvedValue({ data: [sample], error: null })
      const order = vi.fn().mockReturnValue({ limit })
      const eq1 = vi.fn().mockReturnValue({ order, eq: vi.fn().mockReturnValue({ order }) })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      const result = await listStrategyItems(CLIENT_ID)

      expect(supabaseAdmin.from).toHaveBeenCalledWith('content_strategy_items')
      expect(eq1).toHaveBeenCalledWith('client_id', CLIENT_ID)
      expect(order).toHaveBeenCalledWith('priority_score', { ascending: false })
      expect(result).toEqual([sample])
    })

    it('applies status filter when given', async () => {
      const limit = vi.fn().mockResolvedValue({ data: [], error: null })
      const order = vi.fn().mockReturnValue({ limit })
      const eq2 = vi.fn().mockReturnValue({ order })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2, order })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      await listStrategyItems(CLIENT_ID, { status: 'approved' })
      expect(eq2).toHaveBeenCalledWith('status', 'approved')
    })

    it('applies action_type and strategy_run_id filters', async () => {
      const limit = vi.fn().mockResolvedValue({ data: [], error: null })
      const order = vi.fn().mockReturnValue({ limit })
      const eq3 = vi.fn().mockReturnValue({ order })
      const eq2 = vi.fn().mockReturnValue({ eq: eq3 })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      await listStrategyItems(CLIENT_ID, {
        action_type: 'upgrade_page',
        strategy_run_id: 'run-7',
      })
      expect(eq2).toHaveBeenCalledWith('action_type', 'upgrade_page')
      expect(eq3).toHaveBeenCalledWith('strategy_run_id', 'run-7')
    })

    it('respects limit option', async () => {
      const limitFn = vi.fn().mockResolvedValue({ data: [], error: null })
      const order = vi.fn().mockReturnValue({ limit: limitFn })
      const eq1 = vi.fn().mockReturnValue({ order })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      await listStrategyItems(CLIENT_ID, { limit: 25 })
      expect(limitFn).toHaveBeenCalledWith(25)
    })

    it('throws on supabase error', async () => {
      const limit = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'boom' } })
      const order = vi.fn().mockReturnValue({ limit })
      const eq1 = vi.fn().mockReturnValue({ order })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      await expect(listStrategyItems(CLIENT_ID)).rejects.toThrow(/boom/)
    })
  })

  describe('insertStrategyItems', () => {
    it('bulk-inserts and returns rows', async () => {
      const select = vi
        .fn()
        .mockResolvedValue({ data: [sample], error: null })
      const insert = vi.fn().mockReturnValue({ select })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ insert } as any)

      const rows = await insertStrategyItems([
        {
          client_id: CLIENT_ID,
          strategy_run_id: 'run-1',
          action_type: 'new_blog',
          content_mode: 'unified',
          priority_score: 82,
        },
      ])

      expect(insert).toHaveBeenCalledWith([
        expect.objectContaining({
          client_id: CLIENT_ID,
          strategy_run_id: 'run-1',
          action_type: 'new_blog',
          content_mode: 'unified',
          priority_score: 82,
        }),
      ])
      expect(rows).toEqual([sample])
    })

    it('returns empty array when input empty (no DB call)', async () => {
      const result = await insertStrategyItems([])
      expect(result).toEqual([])
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
    })

    it('throws when insert fails', async () => {
      const select = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'fk violation' } })
      const insert = vi.fn().mockReturnValue({ select })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ insert } as any)

      await expect(
        insertStrategyItems([
          {
            client_id: CLIENT_ID,
            strategy_run_id: 'r',
            action_type: 'new_blog',
            content_mode: 'unified',
            priority_score: 1,
          },
        ])
      ).rejects.toThrow(/fk violation/)
    })
  })

  describe('updateStrategyStatus', () => {
    it('updates status and optionally linked blog post', async () => {
      const single = vi
        .fn()
        .mockResolvedValue({ data: { ...sample, status: 'approved' }, error: null })
      const select = vi.fn().mockReturnValue({ single })
      const eq = vi.fn().mockReturnValue({ select })
      const update = vi.fn().mockReturnValue({ eq })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ update } as any)

      await updateStrategyStatus('item-1', {
        status: 'approved',
        linked_blog_post_id: 'post-9',
      })

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved', linked_blog_post_id: 'post-9' })
      )
      expect(eq).toHaveBeenCalledWith('id', 'item-1')
    })

    it('throws when update fails', async () => {
      const single = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'not found' } })
      const select = vi.fn().mockReturnValue({ single })
      const eq = vi.fn().mockReturnValue({ select })
      const update = vi.fn().mockReturnValue({ eq })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ update } as any)

      await expect(
        updateStrategyStatus('nope', { status: 'dismissed' })
      ).rejects.toThrow(/not found/)
    })
  })

  describe('countStrategyItemsByStatus', () => {
    it('returns map of status → count', async () => {
      // The implementation is allowed to fetch all rows then bucket them in JS,
      // or run a single grouped query. Either way, the expected output is a map.
      const limit = vi.fn().mockResolvedValue({
        data: [
          { status: 'pending' },
          { status: 'pending' },
          { status: 'approved' },
        ],
        error: null,
      })
      const order = vi.fn().mockReturnValue({ limit })
      const eq1 = vi.fn().mockReturnValue({ order, limit })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      const result = await countStrategyItemsByStatus(CLIENT_ID)
      expect(result.pending).toBe(2)
      expect(result.approved).toBe(1)
      expect(result.dismissed ?? 0).toBe(0)
    })
  })
})
