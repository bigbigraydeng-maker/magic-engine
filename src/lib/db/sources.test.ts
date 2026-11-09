/**
 * Tests for Social Sources Database Operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSources, createSource, getActiveSources } from './sources';
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

describe('Sources Database Operations', () => {
  const mockProjectId = 'project-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabaseModule.verifyProjectOwnership).mockResolvedValue(true);
  });

  describe('getSources', () => {
    it('should fetch all sources for a project', async () => {
      const mockSources = [
        {
          id: 'source-1',
          project_id: mockProjectId,
          platform: 'facebook',
          account_id: 'fb-account-1',
          account_name: 'CEO AI',
          api_token: 'token-xyz',
          token_expires_at: null,
          is_active: true,
          created_at: '2026-04-06T00:00:00Z',
          updated_at: '2026-04-06T00:00:00Z',
        },
      ];

      vi.mocked(supabaseModule.supabaseAdmin.from).mockReturnValue(
        chainable({ data: mockSources, error: null })
      );

      const result = await getSources(mockProjectId);

      expect(result).toHaveLength(1);
      expect(result[0].account_name).toBe('CEO AI');
    });

    it('should throw error if not project owner', async () => {
      vi.mocked(supabaseModule.verifyProjectOwnership).mockResolvedValue(false);

      await expect(getSources(mockProjectId)).rejects.toThrow('Unauthorized');
    });
  });

  describe('createSource', () => {
    const validInput = {
      platform: 'facebook' as const,
      account_id: 'fb-account-123',
      account_name: 'CEO Account',
      api_token: 'fb-token-abc123',
    };

    it('should create a new social source', async () => {
      const mockCreatedSource = {
        id: 'source-123',
        project_id: mockProjectId,
        ...validInput,
        token_expires_at: null,
        is_active: true,
        created_at: '2026-04-06T00:00:00Z',
        updated_at: '2026-04-06T00:00:00Z',
      };

      vi.mocked(supabaseModule.supabaseAdmin.from).mockReturnValue(
        chainable({ data: mockCreatedSource, error: null })
      );

      const result = await createSource(mockProjectId, validInput);

      expect(result.id).toBe('source-123');
      expect(result.platform).toBe('facebook');
    });

    it('should reject invalid platform', async () => {
      const invalidInput = {
        ...validInput,
        platform: 'invalid' as any,
      };

      await expect(createSource(mockProjectId, invalidInput)).rejects.toThrow(
        'Invalid platform'
      );
    });

    it('should reject duplicate account', async () => {
      vi.mocked(supabaseModule.supabaseAdmin.from).mockReturnValue(
        chainable({ data: null, error: { code: '23505', message: 'Duplicate key' } })
      );

      await expect(createSource(mockProjectId, validInput)).rejects.toThrow(
        'Social account already connected: facebook/fb-account-123'
      );
    });

    it('should handle token expiry date', async () => {
      const inputWithExpiry = {
        ...validInput,
        token_expires_at: new Date('2026-12-31'),
      };

      const mockCreatedSource = {
        id: 'source-123',
        project_id: mockProjectId,
        ...validInput,
        token_expires_at: '2026-12-31T00:00:00Z',
        is_active: true,
        created_at: '2026-04-06T00:00:00Z',
        updated_at: '2026-04-06T00:00:00Z',
      };

      vi.mocked(supabaseModule.supabaseAdmin.from).mockReturnValue(
        chainable({ data: mockCreatedSource, error: null })
      );

      const result = await createSource(mockProjectId, inputWithExpiry);

      expect(result.token_expires_at).toBeInstanceOf(Date);
      expect(result.token_expires_at?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    });
  });

  describe('getActiveSources', () => {
    it('should fetch active sources for a specific platform', async () => {
      const mockActiveSources = [
        {
          id: 'source-1',
          project_id: mockProjectId,
          platform: 'xiaohongshu',
          account_id: 'xhs-1',
          account_name: 'Red Account',
          is_active: true,
          created_at: '2026-04-06T00:00:00Z',
          updated_at: '2026-04-06T00:00:00Z',
        },
      ];

      vi.mocked(supabaseModule.supabaseAdmin.from).mockReturnValue(
        chainable({ data: mockActiveSources, error: null })
      );

      const result = await getActiveSources(mockProjectId, 'xiaohongshu');

      expect(result).toHaveLength(1);
      expect(result[0].platform).toBe('xiaohongshu');
    });
  });
});
