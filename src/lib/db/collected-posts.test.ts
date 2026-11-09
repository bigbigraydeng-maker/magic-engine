/**
 * Tests for Collected Posts Database Operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCollectedPosts,
  createCollectedPost,
  getHighEngagementPosts,
} from './collected-posts';
import * as supabaseModule from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
  verifyProjectOwnership: vi.fn(),
}));

type QueryResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number;
};
type FromReturn = ReturnType<typeof supabaseModule.supabaseAdmin.from>;

/**
 * Chainable, awaitable stand-in for a supabase query builder.
 * Every builder method returns the same chain; `await chain` resolves to `result`.
 */
function chainable(result: QueryResult): FromReturn {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'order', 'range', 'limit', 'insert', 'update', 'single']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return chain as unknown as FromReturn;
}

describe('Collected Posts Database Operations', () => {
  const mockProjectId = 'project-123';
  const mockSourceId = 'source-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabaseModule.verifyProjectOwnership).mockResolvedValue(true);
  });

  describe('getCollectedPosts', () => {
    it('should fetch collected posts for a project', async () => {
      const mockPosts = [
        {
          id: 'post-1',
          source_id: mockSourceId,
          external_post_id: 'fb-post-123',
          platform: 'facebook',
          content: 'Great tips for AI entrepreneurs',
          image_urls: ['https://example.com/image.jpg'],
          original_url: 'https://facebook.com/post/123',
          published_at: '2026-04-06T10:00:00Z',
          metrics: {
            likes: 100,
            comments: 20,
            shares: 5,
            views: 500,
          },
          collected_at: '2026-04-06T11:00:00Z',
        },
      ];

      const sourceQuery = chainable({ data: [{ id: mockSourceId }], error: null });
      const postQuery = chainable({ data: mockPosts, error: null, count: 1 });

      vi.mocked(supabaseModule.supabaseAdmin.from).mockImplementation((table) =>
        table === 'social_sources' ? sourceQuery : postQuery
      );

      const result = await getCollectedPosts(mockProjectId, { limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].platform).toBe('facebook');
    });

    it('should return empty result if no sources found', async () => {
      vi.mocked(supabaseModule.supabaseAdmin.from).mockReturnValue(
        chainable({ data: [], error: null })
      );

      const result = await getCollectedPosts(mockProjectId);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('createCollectedPost', () => {
    const validInput = {
      external_post_id: 'post-abc123',
      platform: 'xiaohongshu' as const,
      content: 'AI创业者必看',
      image_urls: ['https://example.com/image.jpg'],
      metrics: {
        likes: 500,
        comments: 100,
        shares: 50,
        views: 5000,
      },
    };

    it('should create a collected post with valid metrics', async () => {
      const mockCreatedPost = {
        id: 'post-123',
        source_id: mockSourceId,
        ...validInput,
        original_url: null,
        published_at: null,
        collected_at: '2026-04-06T11:00:00Z',
      };

      vi.mocked(supabaseModule.supabaseAdmin.from).mockReturnValue(
        chainable({ data: mockCreatedPost, error: null })
      );

      const result = await createCollectedPost(mockSourceId, validInput);

      expect(result.id).toBe('post-123');
      expect(result.metrics.likes).toBe(500);
    });

    it('should reject invalid platform', async () => {
      const invalidInput = {
        ...validInput,
        platform: 'invalid' as any,
      };

      await expect(createCollectedPost(mockSourceId, invalidInput)).rejects.toThrow(
        'Invalid platform'
      );
    });

    it('should reject negative engagement metrics', async () => {
      const invalidInput = {
        ...validInput,
        metrics: {
          likes: -10,
          comments: 0,
          shares: 0,
          views: 100,
        },
      };

      await expect(createCollectedPost(mockSourceId, invalidInput)).rejects.toThrow(
        'Invalid metrics'
      );
    });

    it('should reject non-numeric metrics', async () => {
      const invalidInput = {
        ...validInput,
        metrics: {
          likes: 'not-a-number' as any,
          comments: 0,
          shares: 0,
          views: 100,
        },
      };

      await expect(createCollectedPost(mockSourceId, invalidInput)).rejects.toThrow(
        'Invalid metrics'
      );
    });

    it('should handle duplicate post error', async () => {
      vi.mocked(supabaseModule.supabaseAdmin.from).mockReturnValue(
        chainable({ data: null, error: { code: '23505', message: 'Duplicate' } })
      );

      await expect(createCollectedPost(mockSourceId, validInput)).rejects.toThrow(
        'Post already collected'
      );
    });
  });

  describe('getHighEngagementPosts', () => {
    it('should fetch high engagement posts above threshold', async () => {
      const mockHighEngagementPosts = [
        {
          id: 'post-1',
          source_id: mockSourceId,
          platform: 'facebook',
          content: 'Viral content',
          metrics: {
            likes: 10000,
            comments: 2000,
            shares: 500,
            views: 100000,
          },
          collected_at: '2026-04-06T11:00:00Z',
        },
      ];

      const sourceQuery = chainable({ data: [{ id: mockSourceId }], error: null });
      const postQuery = chainable({ data: mockHighEngagementPosts, error: null });

      vi.mocked(supabaseModule.supabaseAdmin.from).mockImplementation((table) =>
        table === 'social_sources' ? sourceQuery : postQuery
      );

      const result = await getHighEngagementPosts(mockProjectId, 75, 10);

      // Score = (likes*1 + comments*2.5 + shares*3) / views * 100
      // Score = (10000*1 + 2000*2.5 + 500*3) / 100000 * 100 = 16.5 -> filtered out at minScore 75
      expect(result).toEqual([]);

      const lowBar = await getHighEngagementPosts(mockProjectId, 10, 10);
      expect(lowBar).toHaveLength(1);
      expect(lowBar[0].id).toBe('post-1');
    });
  });
});
