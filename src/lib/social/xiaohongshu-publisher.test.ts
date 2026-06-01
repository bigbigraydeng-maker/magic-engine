/**
 * Unit + Integration tests for xiaohongshu-publisher.ts
 * Covers: publishToXiaohongshu, recordXiaohongshuMetrics, getPreparedUploads
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  publishToXiaohongshu,
  recordXiaohongshuMetrics,
  getPreparedUploads,
  XiaohongshuPublishInput,
} from './xiaohongshu-publisher';
import * as supabaseModule from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const BASE_INPUT: XiaohongshuPublishInput = {
  projectId: 'proj-001',
  taskId: 'task-001',
  sourceId: 'src-001',
  caption: '这是一篇测试笔记',
  hashtags: ['测试', '内容'],
  imageUrl: 'https://example.com/image.jpg',
};

/** Build a standard account response */
function accountQueryMock(metadata: Record<string, any> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'src-001',
        account_id: 'acct-123',
        account_name: '测试账号',
        metadata,
      },
      error: null,
    }),
  };
}

/** Build a logging insert mock that resolves OK */
function logsInsertMock() {
  return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
}

// ---------------------------------------------------------------------------
// publishToXiaohongshu
// ---------------------------------------------------------------------------

describe('publishToXiaohongshu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('throws when account is not found in database', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: new Error('Not found') }),
        } as any;
      }
      return logsInsertMock() as any;
    });

    await expect(publishToXiaohongshu(BASE_INPUT)).rejects.toThrow();
    // generation_logs failure entry should still be attempted
  });

  it('prepares for manual upload when no API integration configured', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return accountQueryMock() as any; // no apiKey/apiSecret
      }
      // xiaohongshu_uploads and generation_logs
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    const result = await publishToXiaohongshu(BASE_INPUT);

    expect(result.status).toBe('prepared');
    expect(result.postId).toMatch(/^xhs_/);
    expect(result.formattedContent).toContain('这是一篇测试笔记');
    expect(result.formattedContent).toContain('#测试');
    expect(result.formattedContent).toContain('#内容');
    expect(result.instructions).toContain('测试账号');
  });

  it('uses API integration path when apiKey and apiSecret are present', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return accountQueryMock({ apiKey: 'key-123', apiSecret: 'secret-456' }) as any;
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    const result = await publishToXiaohongshu(BASE_INPUT);

    expect(result.status).toBe('uploaded');
    expect(result.postId).toMatch(/^xhs_/);
    expect(result.instructions).toContain('API');
  });

  it('formats content with hashtags prefixed by #', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return accountQueryMock() as any;
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    const result = await publishToXiaohongshu({
      ...BASE_INPUT,
      hashtags: ['noHash', '#alreadyHash'],
    });

    expect(result.formattedContent).toContain('#noHash');
    expect(result.formattedContent).toContain('#alreadyHash');
    // Should not double-prefix already-hashed tags
    expect(result.formattedContent).not.toContain('##alreadyHash');
  });

  it('appends engagement prompt to formatted content', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return accountQueryMock() as any;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    const result = await publishToXiaohongshu(BASE_INPUT);

    expect(result.formattedContent).toContain('👇');
  });

  it('includes image URL in instructions', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return accountQueryMock() as any;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    const result = await publishToXiaohongshu(BASE_INPUT);

    expect(result.instructions).toContain('https://example.com/image.jpg');
  });

  it('handles missing imageUrl gracefully', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return accountQueryMock() as any;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    const inputNoImage = { ...BASE_INPUT, imageUrl: undefined };
    const result = await publishToXiaohongshu(inputNoImage);

    expect(result.status).toBe('prepared');
    expect(result.instructions).toContain('(未提供)');
  });

  it('handles empty hashtags array', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return accountQueryMock() as any;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    const result = await publishToXiaohongshu({ ...BASE_INPUT, hashtags: [] });

    expect(result.formattedContent).not.toContain('#');
    expect(result.status).toBe('prepared');
  });

  it('logs success to generation_logs', async () => {
    const logsInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return accountQueryMock() as any;
      if (table === 'generation_logs') return { insert: logsInsert } as any;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    await publishToXiaohongshu(BASE_INPUT);

    const logCall = logsInsert.mock.calls[0][0][0];
    expect(logCall.status).toBe('success');
    expect(logCall.task_id).toBe(BASE_INPUT.taskId);
    expect(logCall.project_id).toBe(BASE_INPUT.projectId);
    expect(logCall.operation).toBe('publish_xiaohongshu');
  });

  it('logs failure to generation_logs when publishing throws', async () => {
    const logsInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }),
        } as any;
      }
      if (table === 'generation_logs') return { insert: logsInsert } as any;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    await expect(publishToXiaohongshu(BASE_INPUT)).rejects.toThrow();

    const logCall = logsInsert.mock.calls[0][0][0];
    expect(logCall.status).toBe('failed');
    expect(logCall.error_message).toBeDefined();
  });

  it('handles scheduledTime by storing it in the upload record', async () => {
    const uploadsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const scheduledTime = new Date('2026-05-01T10:00:00Z');

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return accountQueryMock() as any;
      if (table === 'xiaohongshu_uploads') return { insert: uploadsInsert } as any;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    await publishToXiaohongshu({ ...BASE_INPUT, scheduledTime });

    const uploadRecord = uploadsInsert.mock.calls[0][0][0];
    expect(uploadRecord.scheduled_time).toBe(scheduledTime.toISOString());
  });
});

// ---------------------------------------------------------------------------
// recordXiaohongshuMetrics
// ---------------------------------------------------------------------------

describe('recordXiaohongshuMetrics', () => {
  const UPLOAD_ID = 'xhs_12345_abcde';
  const METRICS = { likes: 150, comments: 30, shares: 10, views: 5000 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('records metrics successfully', async () => {
    const collectedInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'xiaohongshu_uploads') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { task_id: 'task-001', project_id: 'proj-001' },
            error: null,
          }),
        } as any;
      }
      return { insert: collectedInsert } as any;
    });

    await expect(recordXiaohongshuMetrics(UPLOAD_ID, METRICS)).resolves.toBeUndefined();
    expect(collectedInsert).toHaveBeenCalledTimes(1);

    const inserted = collectedInsert.mock.calls[0][0][0];
    expect(inserted.platform).toBe('xiaohongshu');
    expect(inserted.metrics.likes).toBe(150);
    expect(inserted.metrics.views).toBe(5000);
  });

  it('throws when upload record is not found', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }),
    } as any);

    await expect(recordXiaohongshuMetrics('nonexistent', METRICS)).rejects.toThrow(
      'Upload not found'
    );
  });

  it('throws when collected_posts insert fails', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'xiaohongshu_uploads') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { task_id: 'task-001', project_id: 'proj-001' },
            error: null,
          }),
        } as any;
      }
      return {
        insert: vi.fn().mockResolvedValue({ data: null, error: new Error('insert failed') }),
      } as any;
    });

    await expect(recordXiaohongshuMetrics(UPLOAD_ID, METRICS)).rejects.toThrow('insert failed');
  });

  it('stores all four metric fields', async () => {
    const collectedInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'xiaohongshu_uploads') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { task_id: 'task-001', project_id: 'proj-001' },
            error: null,
          }),
        } as any;
      }
      return { insert: collectedInsert } as any;
    });

    await recordXiaohongshuMetrics(UPLOAD_ID, METRICS);

    const inserted = collectedInsert.mock.calls[0][0][0];
    expect(inserted.metrics).toMatchObject({
      likes: 150,
      comments: 30,
      shares: 10,
      views: 5000,
    });
  });

  it('handles zero-value metrics without throwing', async () => {
    const collectedInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'xiaohongshu_uploads') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { task_id: 'task-001', project_id: 'proj-001' },
            error: null,
          }),
        } as any;
      }
      return { insert: collectedInsert } as any;
    });

    await expect(
      recordXiaohongshuMetrics(UPLOAD_ID, { likes: 0, comments: 0, shares: 0, views: 0 })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getPreparedUploads
// ---------------------------------------------------------------------------

describe('getPreparedUploads', () => {
  const PROJECT_ID = 'proj-query-001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns prepared uploads for a project', async () => {
    const mockUploads = [
      { id: 'xhs_1', project_id: PROJECT_ID, status: 'prepared', created_at: '2026-04-07T00:00:00Z' },
      { id: 'xhs_2', project_id: PROJECT_ID, status: 'prepared', created_at: '2026-04-06T00:00:00Z' },
    ];

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockUploads, error: null }),
    } as any);

    const result = await getPreparedUploads(PROJECT_ID);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('xhs_1');
    expect(result[1].id).toBe('xhs_2');
  });

  it('returns empty array when no prepared uploads exist', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any);

    const result = await getPreparedUploads(PROJECT_ID);

    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });

  it('throws when Supabase query fails', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: new Error('query failed') }),
    } as any);

    await expect(getPreparedUploads(PROJECT_ID)).rejects.toThrow('query failed');
  });

  it('filters only status=prepared records', async () => {
    const eqMock = vi.fn().mockReturnThis();
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: eqMock,
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any);

    await getPreparedUploads(PROJECT_ID);

    // Should have called .eq() for both project_id and status
    const eqCalls = eqMock.mock.calls;
    expect(eqCalls.some(([col, val]) => col === 'project_id' && val === PROJECT_ID)).toBe(true);
    expect(eqCalls.some(([col, val]) => col === 'status' && val === 'prepared')).toBe(true);
  });
});
