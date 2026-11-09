import type { SupabaseClient } from '@supabase/supabase-js';

// 槽位状态：已排 / 未排
export type SlotState = 'PLANNED' | 'NOT_PLANNED';

// 每日计划里一天的槽位
export interface DaySlotsLite {
  post: SlotState;
  story: SlotState;
  reel: SlotState;
}

// 每日计划里的一天
export interface DayLite {
  date: string;
  slots: DaySlotsLite;
}

// post bundle 内容
export interface PostBundleLite {
  hook: string;
  body: string;
  cta: string;
  image_asset_id: string;
  cta_url: string;
}

// story 帧
export interface StoryFrameLite {
  order: number;
  copy: string;
}

// story bundle 内容
export interface StoryBundleLite {
  frames: StoryFrameLite[];
}

// reel bundle 内容
export interface ReelBundleLite {
  brief: string;
  script: string;
  caption: string;
  source_asset_ids: string[];
  media_status: string;
}

// 每日计划里一天的 bundle 集合
export interface BundleLite {
  date: string;
  post: PostBundleLite | null;
  story: StoryBundleLite | null;
  reel: ReelBundleLite | null;
}

// 精简后的每日计划快照
export interface DailyPlanSnapshotLite {
  campaign_id: string;
  created_at: string;
  days: DayLite[];
  bundles: BundleLite[];
}

// 读取结果
export type DailyPlanRead =
  | { status: 'ok'; snapshots: DailyPlanSnapshotLite[]; rows_total?: number; /** 读到了、但格式读不懂被跳过的行数（有就不能说「没建过」） */ rows_unparseable?: number }
  | { status: 'read_failed'; error: string };

// 窗口内已排好的条数统计
export interface PlannedCounts {
  post: number;
  story: number;
  reel: number;
  shape_error_days: number;
  latest_covered_date: string | null;
  snapshots_used: number;
}

// 计划类型标识
const PLAN_KIND = 'campaign_daily_v1';

// 错误文案最大长度
const MAX_ERROR_LEN = 160;

// 判断是否为普通对象
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 判断是否非空字符串
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// 判断槽位状态是否合法
function isSlotState(value: unknown): value is SlotState {
  return value === 'PLANNED' || value === 'NOT_PLANNED';
}

// 运行时校验并解析一天
function parseDay(value: unknown): DayLite | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!isNonEmptyString(value.date)) {
    return null;
  }
  const slots = value.slots;
  if (!isRecord(slots)) {
    return null;
  }
  if (!isSlotState(slots.post) || !isSlotState(slots.story) || !isSlotState(slots.reel)) {
    return null;
  }
  return {
    date: value.date,
    slots: { post: slots.post, story: slots.story, reel: slots.reel },
  };
}

// 运行时校验并解析 post bundle
function parsePostBundle(value: unknown): PostBundleLite | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isNonEmptyString(value.hook) ||
    !isNonEmptyString(value.body) ||
    !isNonEmptyString(value.cta) ||
    !isNonEmptyString(value.image_asset_id) ||
    !isNonEmptyString(value.cta_url)
  ) {
    return null;
  }
  return {
    hook: value.hook,
    body: value.body,
    cta: value.cta,
    image_asset_id: value.image_asset_id,
    cta_url: value.cta_url,
  };
}

// 运行时校验并解析 story bundle
function parseStoryBundle(value: unknown): StoryBundleLite | null {
  if (!isRecord(value)) {
    return null;
  }
  const frames = value.frames;
  if (!Array.isArray(frames)) {
    return null;
  }
  const parsedFrames: StoryFrameLite[] = [];
  for (const frame of frames) {
    if (!isRecord(frame)) {
      return null;
    }
    if (typeof frame.order !== 'number' || !isNonEmptyString(frame.copy)) {
      return null;
    }
    parsedFrames.push({ order: frame.order, copy: frame.copy });
  }
  return { frames: parsedFrames };
}

// 运行时校验并解析 reel bundle
function parseReelBundle(value: unknown): ReelBundleLite | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isNonEmptyString(value.brief) ||
    !isNonEmptyString(value.script) ||
    !isNonEmptyString(value.caption)
  ) {
    return null;
  }
  const sourceAssetIds = value.source_asset_ids;
  if (!Array.isArray(sourceAssetIds)) {
    return null;
  }
  const parsedIds: string[] = [];
  for (const id of sourceAssetIds) {
    if (typeof id !== 'string') {
      return null;
    }
    parsedIds.push(id);
  }
  if (typeof value.media_status !== 'string') {
    return null;
  }
  return {
    brief: value.brief,
    script: value.script,
    caption: value.caption,
    source_asset_ids: parsedIds,
    media_status: value.media_status,
  };
}

// 运行时校验并解析一天 bundle
function parseBundle(value: unknown): BundleLite | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!isNonEmptyString(value.date)) {
    return null;
  }
  const post = value.post === null ? null : parsePostBundle(value.post);
  const story = value.story === null ? null : parseStoryBundle(value.story);
  const reel = value.reel === null ? null : parseReelBundle(value.reel);
  return { date: value.date, post, story, reel };
}

// 运行时校验并解析整份快照
function parseSnapshot(planData: unknown, createdAt: string): DailyPlanSnapshotLite | null {
  if (!isRecord(planData)) {
    return null;
  }
  if (!isNonEmptyString(planData.campaign_id)) {
    return null;
  }
  const daysRaw = planData.days;
  const bundlesRaw = planData.bundles;
  if (!Array.isArray(daysRaw) || !Array.isArray(bundlesRaw)) {
    return null;
  }
  const days: DayLite[] = [];
  for (const day of daysRaw) {
    const parsed = parseDay(day);
    if (parsed === null) {
      return null;
    }
    days.push(parsed);
  }
  const bundles: BundleLite[] = [];
  for (const bundle of bundlesRaw) {
    const parsed = parseBundle(bundle);
    if (parsed === null) {
      return null;
    }
    bundles.push(parsed);
  }
  return {
    campaign_id: planData.campaign_id,
    created_at: createdAt,
    days,
    bundles,
  };
}

// 读取每日计划快照（只读）
export async function loadDailyPlanSnapshots(
  supabase: SupabaseClient,
  clientId: string,
): Promise<DailyPlanRead> {
  const { data, error } = await supabase
    .from('social_plans')
    .select('plan_data, created_at')
    .eq('client_id', clientId)
    .contains('plan_data', { plan_kind: PLAN_KIND })
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    return { status: 'read_failed', error: error.message.slice(0, MAX_ERROR_LEN) };
  }

  const snapshots: DailyPlanSnapshotLite[] = [];
  const rows: unknown[] = Array.isArray(data) ? data : [];
  let unparseable = 0;
  for (const row of rows) {
    if (!isRecord(row)) {
      unparseable += 1;
      continue;
    }
    const createdAt = row.created_at;
    if (!isNonEmptyString(createdAt)) {
      unparseable += 1;
      continue;
    }
    const parsed = parseSnapshot(row.plan_data, createdAt);
    if (parsed === null) {
      unparseable += 1;
      continue;
    }
    snapshots.push(parsed);
  }

  return { status: 'ok', snapshots, rows_total: rows.length, rows_unparseable: unparseable };
}

// 判断某天某类型在快照里是否内容齐全
function isBundleComplete(snapshot: DailyPlanSnapshotLite, date: string, kind: 'post' | 'story' | 'reel'): boolean {
  const bundle = snapshot.bundles.find((item) => item.date === date);
  if (!bundle) {
    return false;
  }
  if (kind === 'post') {
    const post = bundle.post;
    if (!post) {
      return false;
    }
    return (
      isNonEmptyString(post.hook) &&
      isNonEmptyString(post.body) &&
      isNonEmptyString(post.cta) &&
      isNonEmptyString(post.image_asset_id)
    );
  }
  if (kind === 'story') {
    const story = bundle.story;
    if (!story) {
      return false;
    }
    if (story.frames.length !== 4) {
      return false;
    }
    return story.frames.every((frame) => isNonEmptyString(frame.copy));
  }
  const reel = bundle.reel;
  if (!reel) {
    return false;
  }
  return (
    isNonEmptyString(reel.brief) &&
    isNonEmptyString(reel.script) &&
    isNonEmptyString(reel.caption)
  );
}

// 判断某天某类型在某快照里是否被标记为 PLANNED
function isSlotPlanned(snapshot: DailyPlanSnapshotLite, date: string, kind: 'post' | 'story' | 'reel'): boolean {
  const day = snapshot.days.find((item) => item.date === date);
  if (!day) {
    return false;
  }
  return day.slots[kind] === 'PLANNED';
}

// 枚举 [from, to] 之间的所有 UTC 日历天
function enumerateDates(from: string, to: string): string[] {
  const result: string[] = [];
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return result;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  for (let time = start; time <= end; time += dayMs) {
    result.push(new Date(time).toISOString().slice(0, 10));
  }
  return result;
}

// 统计窗口内已排好的条数
export function plannedCountsInWindow(
  snaps: readonly DailyPlanSnapshotLite[],
  from: string,
  to: string,
): PlannedCounts {
  // 按 campaign_id 分组，只保留 created_at 最新的一份
  const latestByCampaign = new Map<string, DailyPlanSnapshotLite>();
  for (const snap of snaps) {
    const existing = latestByCampaign.get(snap.campaign_id);
    if (!existing || snap.created_at > existing.created_at) {
      latestByCampaign.set(snap.campaign_id, snap);
    }
  }
  const used = Array.from(latestByCampaign.values());

  const dates = enumerateDates(from, to);
  const kinds: Array<'post' | 'story' | 'reel'> = ['post', 'story', 'reel'];

  let post = 0;
  let story = 0;
  let reel = 0;
  let shapeErrorDays = 0;

  for (const date of dates) {
    let dayHasShapeError = false;
    for (const kind of kinds) {
      let plannedAnywhere = false;
      let completeAnywhere = false;
      for (const snap of used) {
        if (isSlotPlanned(snap, date, kind)) {
          plannedAnywhere = true;
          if (isBundleComplete(snap, date, kind)) {
            completeAnywhere = true;
          }
        }
      }
      if (completeAnywhere) {
        if (kind === 'post') {
          post += 1;
        } else if (kind === 'story') {
          story += 1;
        } else {
          reel += 1;
        }
      } else if (plannedAnywhere) {
        dayHasShapeError = true;
      }
    }
    if (dayHasShapeError) {
      shapeErrorDays += 1;
    }
  }

  // latest_covered_date：所有留下来的快照里、任一槽位是 PLANNED 的 day.date 的最大值
  let latestCoveredDate: string | null = null;
  for (const snap of used) {
    for (const day of snap.days) {
      if (day.slots.post === 'PLANNED' || day.slots.story === 'PLANNED' || day.slots.reel === 'PLANNED') {
        if (latestCoveredDate === null || day.date > latestCoveredDate) {
          latestCoveredDate = day.date;
        }
      }
    }
  }

  return {
    post,
    story,
    reel,
    shape_error_days: shapeErrorDays,
    latest_covered_date: latestCoveredDate,
    snapshots_used: used.length,
  };
}
