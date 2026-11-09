import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadDailyPlanSnapshots,
  plannedCountsInWindow,
  type BundleLite,
  type DailyPlanSnapshotLite,
  type DayLite,
  type PostBundleLite,
  type ReelBundleLite,
  type StoryBundleLite,
} from '../daily-plan-read';

// 构造一天
function makeDay(date: string, post: 'PLANNED' | 'NOT_PLANNED', story: 'PLANNED' | 'NOT_PLANNED', reel: 'PLANNED' | 'NOT_PLANNED'): DayLite {
  return { date, slots: { post, story, reel } };
}

// 构造完整 post bundle
function makePostBundle(): PostBundleLite {
  return {
    hook: 'hook',
    body: 'body',
    cta: 'cta',
    image_asset_id: 'asset-1',
    cta_url: 'https://example.com',
  };
}

// 构造完整 story bundle（4 帧）
function makeStoryBundle(): StoryBundleLite {
  return {
    frames: [
      { order: 1, copy: 'a' },
      { order: 2, copy: 'b' },
      { order: 3, copy: 'c' },
      { order: 4, copy: 'd' },
    ],
  };
}

// 构造完整 reel bundle
function makeReelBundle(mediaStatus: string): ReelBundleLite {
  return {
    brief: 'brief',
    script: 'script',
    caption: 'caption',
    source_asset_ids: ['asset-1'],
    media_status: mediaStatus,
  };
}

// 构造一天 bundle
function makeBundle(date: string, post: PostBundleLite | null, story: StoryBundleLite | null, reel: ReelBundleLite | null): BundleLite {
  return { date, post, story, reel };
}

// 构造快照
function makeSnapshot(
  campaignId: string,
  createdAt: string,
  days: DayLite[],
  bundles: BundleLite[],
): DailyPlanSnapshotLite {
  return { campaign_id: campaignId, created_at: createdAt, days, bundles };
}

describe('plannedCountsInWindow', () => {
  it('同一活动两份快照只用最新的一份', () => {
    const oldSnap = makeSnapshot(
      'c1',
      '2026-10-01T00:00:00.000Z',
      [makeDay('2026-10-05', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED')],
      [makeBundle('2026-10-05', makePostBundle(), null, null)],
    );
    const newSnap = makeSnapshot(
      'c1',
      '2026-10-02T00:00:00.000Z',
      [makeDay('2026-10-05', 'NOT_PLANNED', 'NOT_PLANNED', 'NOT_PLANNED')],
      [],
    );
    const counts = plannedCountsInWindow([oldSnap, newSnap], '2026-10-01', '2026-10-31');
    expect(counts.snapshots_used).toBe(1);
    expect(counts.post).toBe(0);
  });

  it('两个活动各排不同日子取并集，同一天同类型只算一条', () => {
    const snapA = makeSnapshot(
      'c1',
      '2026-10-01T00:00:00.000Z',
      [
        makeDay('2026-10-05', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
        makeDay('2026-10-06', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
      ],
      [makeBundle('2026-10-05', makePostBundle(), null, null), makeBundle('2026-10-06', makePostBundle(), null, null)],
    );
    const snapB = makeSnapshot(
      'c2',
      '2026-10-01T00:00:00.000Z',
      [
        makeDay('2026-10-05', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
        makeDay('2026-10-07', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
      ],
      [makeBundle('2026-10-05', makePostBundle(), null, null), makeBundle('2026-10-07', makePostBundle(), null, null)],
    );
    const counts = plannedCountsInWindow([snapA, snapB], '2026-10-01', '2026-10-31');
    expect(counts.snapshots_used).toBe(2);
    expect(counts.post).toBe(3);
  });

  it('PLANNED 但 bundle 缺失不算排好，同一天多个类型都缺只记一次 shape_error_days', () => {
    const snap = makeSnapshot(
      'c1',
      '2026-10-01T00:00:00.000Z',
      [makeDay('2026-10-05', 'PLANNED', 'PLANNED', 'PLANNED')],
      [],
    );
    const counts = plannedCountsInWindow([snap], '2026-10-01', '2026-10-31');
    expect(counts.post).toBe(0);
    expect(counts.story).toBe(0);
    expect(counts.reel).toBe(0);
    expect(counts.shape_error_days).toBe(1);
  });

  it('Story 只有 3 帧不算排好，Post 缺 image_asset_id 不算，Reel 的 media_status 为 NO_MEDIA 仍算', () => {
    const shortStory: StoryBundleLite = {
      frames: [
        { order: 1, copy: 'a' },
        { order: 2, copy: 'b' },
        { order: 3, copy: 'c' },
      ],
    };
    const badPost: PostBundleLite = {
      hook: 'hook',
      body: 'body',
      cta: 'cta',
      image_asset_id: '',
      cta_url: 'https://example.com',
    };
    const snap = makeSnapshot(
      'c1',
      '2026-10-01T00:00:00.000Z',
      [
        makeDay('2026-10-05', 'PLANNED', 'PLANNED', 'PLANNED'),
        makeDay('2026-10-06', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
      ],
      [
        makeBundle('2026-10-05', null, shortStory, makeReelBundle('NO_MEDIA')),
        makeBundle('2026-10-06', badPost, null, null),
      ],
    );
    const counts = plannedCountsInWindow([snap], '2026-10-01', '2026-10-31');
    expect(counts.story).toBe(0);
    expect(counts.reel).toBe(1);
    expect(counts.post).toBe(0);
    expect(counts.shape_error_days).toBe(2);
  });

  it('窗口外的日期不计，跨月逐日正确', () => {
    const snap = makeSnapshot(
      'c1',
      '2026-10-01T00:00:00.000Z',
      [
        makeDay('2026-10-29', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
        makeDay('2026-10-30', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
        makeDay('2026-11-01', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
        makeDay('2026-11-03', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
        makeDay('2026-11-04', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
      ],
      [
        makeBundle('2026-10-29', makePostBundle(), null, null),
        makeBundle('2026-10-30', makePostBundle(), null, null),
        makeBundle('2026-11-01', makePostBundle(), null, null),
        makeBundle('2026-11-03', makePostBundle(), null, null),
        makeBundle('2026-11-04', makePostBundle(), null, null),
      ],
    );
    const counts = plannedCountsInWindow([snap], '2026-10-30', '2026-11-03');
    expect(counts.post).toBe(3);
  });

  it('latest_covered_date 取 PLANNED 日期最大值，全 NOT_PLANNED 为 null', () => {
    const snap = makeSnapshot(
      'c1',
      '2026-10-01T00:00:00.000Z',
      [
        makeDay('2026-10-05', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED'),
        makeDay('2026-10-09', 'NOT_PLANNED', 'PLANNED', 'NOT_PLANNED'),
      ],
      [],
    );
    const counts = plannedCountsInWindow([snap], '2026-10-01', '2026-10-31');
    expect(counts.latest_covered_date).toBe('2026-10-09');

    const emptySnap = makeSnapshot(
      'c2',
      '2026-10-01T00:00:00.000Z',
      [makeDay('2026-10-05', 'NOT_PLANNED', 'NOT_PLANNED', 'NOT_PLANNED')],
      [],
    );
    const emptyCounts = plannedCountsInWindow([emptySnap], '2026-10-01', '2026-10-31');
    expect(emptyCounts.latest_covered_date).toBeNull();
  });
});

// 假 supabase 查询链
interface FakeQueryResult {
  data: unknown;
  error: { message: string } | null;
}

// 构造假 supabase 客户端
function makeFakeSupabase(result: FakeQueryResult): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    contains: () => chain,
    order: () => chain,
    limit: () => Promise.resolve(result),
  };
  const client = {
    from: () => chain,
  };
  return client as unknown as SupabaseClient;
}

describe('loadDailyPlanSnapshots', () => {
  it('error 时返回 read_failed 且文案被截断', () => {
    const longMessage = 'x'.repeat(300);
    const supabase = makeFakeSupabase({ data: null, error: { message: longMessage } });
    return loadDailyPlanSnapshots(supabase, 'client-1').then((result) => {
      expect(result.status).toBe('read_failed');
      if (result.status === 'read_failed') {
        expect(result.error.length).toBe(160);
      }
    });
  });

  it('零行时返回 ok 且 snapshots 为空数组', async () => {
    const supabase = makeFakeSupabase({ data: [], error: null });
    const result = await loadDailyPlanSnapshots(supabase, 'client-1');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.snapshots).toEqual([]);
    }
  });

  it('形状不合格的行被跳过，合格的行被保留', async () => {
    const goodRow = {
      created_at: '2026-10-01T00:00:00.000Z',
      plan_data: {
        plan_kind: 'campaign_daily_v1',
        campaign_id: 'c1',
        days: [makeDay('2026-10-05', 'PLANNED', 'NOT_PLANNED', 'NOT_PLANNED')],
        bundles: [makeBundle('2026-10-05', makePostBundle(), null, null)],
      },
    };
    const badRow = {
      created_at: '2026-10-02T00:00:00.000Z',
      plan_data: {
        plan_kind: 'campaign_daily_v1',
        campaign_id: '',
        days: [],
        bundles: [],
      },
    };
    const supabase = makeFakeSupabase({ data: [badRow, goodRow], error: null });
    const result = await loadDailyPlanSnapshots(supabase, 'client-1');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.snapshots.length).toBe(1);
      expect(result.snapshots[0].campaign_id).toBe('c1');
    }
  });
});
