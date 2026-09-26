/**
 * 广告设置快照 · 纯函数部分（ads IMPACT 阶段 1，设计 §2.1 / §14 M1 / M9）。
 *
 * 把 Meta 只读接口返回的实体设置，规范化成 `ad_entity_snapshots` 一行；算设置哈希；
 * 决定哪些行要写（设置变了 → 'changed'；今天还没记过 → 'daily'）。
 *
 * 纯函数、不碰网络、不碰 DB——取数与写库在 `snapshot-sync.ts`，这样规则本身可单测。
 * 🔴 平台共享代码：这里不许出现任何客户名、客户 ID、行业判断。
 */

import { createHash } from 'node:crypto'
import type {
  GraphAccountSettings,
  GraphAdSettings,
  GraphAdStudy,
  GraphAdsetSettings,
  GraphCampaignSettings,
  GraphCustomAudience,
} from '@/lib/meta/entity-settings'

export type SnapshotLevel = 'account' | 'campaign' | 'adset' | 'ad' | 'audience'
export type CaptureReason = 'first_seen' | 'changed' | 'daily' | 'disappeared' | 'kernel_pre' | 'kernel_post'

export interface AdStudyRef {
  id: string
  type: string | null
  start_time: string | null
  end_time: string | null
}

/** 与 `ad_entity_snapshots` 列一一对应（不含 id / created_at）。 */
export interface EntitySnapshotRow {
  client_id: string
  platform: 'meta'
  ad_account_id: string
  level: SnapshotLevel
  entity_id: string
  entity_name: string | null
  campaign_id: string | null
  adset_id: string | null
  status: string | null
  effective_status: string | null
  objective: string | null
  optimization_goal: string | null
  destination_type: string | null
  budget_level: 'cbo' | 'abo' | null
  daily_budget_minor: number | null
  lifetime_budget_minor: number | null
  currency: string | null
  bid_strategy: string | null
  special_ad_categories: string[]
  smart_promotion_type: string | null
  included_audience_ids: string[]
  excluded_audience_ids: string[]
  advantage_audience: number | null
  targeting_relaxation: Record<string, number> | null
  targeting_summary: Record<string, unknown> | null
  learning_stage: string | null
  ad_studies: AdStudyRef[]
  creative_video_ids: string[]
  creative_page_id: string | null
  account_status: number | null
  disable_reason: number | null
  timezone_name: string | null
  audience_subtype: string | null
  audience_count_lower: number | null
  audience_rule_object_ids: string[]
  audience_rule_events: string[]
  audience_retention_days: number | null
  audience_created_at: string | null
  shared_account: boolean
  settings_hash: string
  capture_reason: CaptureReason
  source_updated_time: string | null
  captured_at: string
}

type RowWithoutHash = Omit<EntitySnapshotRow, 'settings_hash' | 'capture_reason' | 'captured_at'>

interface Ctx {
  clientId: string
  adAccountId: string
  currency: string | null
  sharedAccount: boolean
}

function blank(ctx: Ctx, level: SnapshotLevel, entityId: string): RowWithoutHash {
  return {
    client_id: ctx.clientId,
    platform: 'meta',
    ad_account_id: ctx.adAccountId,
    level,
    entity_id: entityId,
    entity_name: null,
    campaign_id: null,
    adset_id: null,
    status: null,
    effective_status: null,
    objective: null,
    optimization_goal: null,
    destination_type: null,
    budget_level: null,
    daily_budget_minor: null,
    lifetime_budget_minor: null,
    currency: ctx.currency,
    bid_strategy: null,
    special_ad_categories: [],
    smart_promotion_type: null,
    included_audience_ids: [],
    excluded_audience_ids: [],
    advantage_audience: null,
    targeting_relaxation: null,
    targeting_summary: null,
    learning_stage: null,
    ad_studies: [],
    creative_video_ids: [],
    creative_page_id: null,
    account_status: null,
    disable_reason: null,
    timezone_name: null,
    audience_subtype: null,
    audience_count_lower: null,
    audience_rule_object_ids: [],
    audience_rule_events: [],
    audience_retention_days: null,
    audience_created_at: null,
    shared_account: ctx.sharedAccount,
    source_updated_time: null,
  }
}

/** Meta 预算是字符串形式的最小货币单位；"0" / 缺失 = 没设在这一层。 */
export function parseBudgetMinor(v: string | undefined): number | null {
  if (v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function studies(s: { data?: GraphAdStudy[] } | undefined): AdStudyRef[] {
  return (s?.data ?? []).map(x => ({
    id: x.id,
    type: x.type ?? null,
    start_time: x.start_time ?? null,
    end_time: x.end_time ?? null,
  }))
}

export function normalizeAccount(ctx: Ctx, a: GraphAccountSettings): RowWithoutHash {
  return {
    ...blank(ctx, 'account', a.id),
    entity_name: a.name ?? null,
    currency: a.currency ?? ctx.currency,
    account_status: a.account_status ?? null,
    disable_reason: a.disable_reason ?? null,
    timezone_name: a.timezone_name ?? null,
  }
}

export function normalizeCampaign(ctx: Ctx, c: GraphCampaignSettings): RowWithoutHash {
  const daily = parseBudgetMinor(c.daily_budget)
  const lifetime = parseBudgetMinor(c.lifetime_budget)
  return {
    ...blank(ctx, 'campaign', c.id),
    entity_name: c.name ?? null,
    campaign_id: c.id,
    status: c.status ?? null,
    effective_status: c.effective_status ?? null,
    objective: c.objective ?? null,
    // 预算挂在系列上 = CBO；否则由广告组各自持有 = ABO
    budget_level: daily !== null || lifetime !== null ? 'cbo' : 'abo',
    daily_budget_minor: daily,
    lifetime_budget_minor: lifetime,
    bid_strategy: c.bid_strategy ?? null,
    special_ad_categories: [...(c.special_ad_categories ?? [])].sort(),
    smart_promotion_type: c.smart_promotion_type ?? null,
    ad_studies: studies(c.ad_studies),
    source_updated_time: c.updated_time ?? null,
  }
}

export function normalizeAdset(ctx: Ctx, s: GraphAdsetSettings): RowWithoutHash {
  const t = s.targeting ?? {}
  const daily = parseBudgetMinor(s.daily_budget)
  const lifetime = parseBudgetMinor(s.lifetime_budget)
  return {
    ...blank(ctx, 'adset', s.id),
    entity_name: s.name ?? null,
    campaign_id: s.campaign_id ?? null,
    adset_id: s.id,
    status: s.status ?? null,
    effective_status: s.effective_status ?? null,
    optimization_goal: s.optimization_goal ?? null,
    destination_type: s.destination_type ?? null,
    budget_level: daily !== null || lifetime !== null ? 'abo' : null,
    daily_budget_minor: daily,
    lifetime_budget_minor: lifetime,
    bid_strategy: s.bid_strategy ?? null,
    included_audience_ids: (t.custom_audiences ?? []).map(a => a.id).sort(),
    excluded_audience_ids: (t.excluded_custom_audiences ?? []).map(a => a.id).sort(),
    advantage_audience: t.targeting_automation?.advantage_audience ?? null,
    targeting_relaxation: t.targeting_relaxation_types ?? null,
    targeting_summary: {
      geo_locations: t.geo_locations ?? null,
      age_min: t.age_min ?? null,
      age_max: t.age_max ?? null,
      // 未设置(null) = 留给 Meta"自动版位"；D9 用这个字段判纯播放广告有没有排除 Audience Network。
      publisher_platforms: t.publisher_platforms ?? null,
    },
    learning_stage: s.learning_stage_info?.status ?? null,
    ad_studies: studies(s.ad_studies),
    source_updated_time: s.updated_time ?? null,
  }
}

export function normalizeAd(ctx: Ctx, a: GraphAdSettings): RowWithoutHash {
  // creative.video_id 才是投放用的视频（视频受众规则 object_id 对的是它）；
  // object_story_spec.video_data.video_id 是原始上传稿，2026-09-14 实拉两者不同，不拿它匹配。
  const videoId = a.creative?.video_id
  return {
    ...blank(ctx, 'ad', a.id),
    entity_name: a.name ?? null,
    campaign_id: a.campaign_id ?? null,
    adset_id: a.adset_id ?? null,
    status: a.status ?? null,
    effective_status: a.effective_status ?? null,
    creative_video_ids: videoId ? [videoId] : [],
    creative_page_id: a.creative?.object_story_spec?.page_id ?? a.creative?.effective_object_story_id?.split('_')[0] ?? null,
    source_updated_time: a.updated_time ?? null,
  }
}

/**
 * 受众规则里的 object_id / 事件名。两种真实形状（2026-09-14 实拉）：
 *   - 视频受众：`[{"event_name":"video_completed","object_id":2354728365274921}, ...]`
 *   - 主页/表单/像素受众：`{"inclusions":{"rules":[{"event_sources":[{"id":...,"type":"page"}], "filter":...}]}}`
 * 解析不了就返回空数组——D4 会把「规则读不懂」当成「无法按 object_id 匹配」，不会按名字猜。
 */
export function parseAudienceRule(rule: string | undefined): { objectIds: string[]; events: string[] } {
  if (!rule) return { objectIds: [], events: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(rule)
  } catch {
    return { objectIds: [], events: [] }
  }
  const objectIds = new Set<string>()
  const events = new Set<string>()
  if (Array.isArray(parsed)) {
    for (const r of parsed) {
      const item = r as { object_id?: unknown; event_name?: unknown }
      if (item.object_id !== undefined) objectIds.add(String(item.object_id))
      if (typeof item.event_name === 'string') events.add(item.event_name)
    }
  } else if (parsed && typeof parsed === 'object') {
    const inclusions = (parsed as { inclusions?: { rules?: unknown[] } }).inclusions
    for (const r of inclusions?.rules ?? []) {
      const rr = r as { event_sources?: Array<{ id?: unknown; type?: unknown }>; filter?: { filters?: Array<{ field?: unknown; value?: unknown }> } }
      for (const src of rr.event_sources ?? []) if (src.id !== undefined) objectIds.add(String(src.id))
      for (const f of rr.filter?.filters ?? []) {
        if (f.field === 'event' && typeof f.value === 'string') events.add(f.value)
      }
    }
  }
  return { objectIds: [...objectIds].sort(), events: [...events].sort() }
}

export function normalizeAudience(ctx: Ctx, a: GraphCustomAudience): RowWithoutHash {
  const { objectIds, events } = parseAudienceRule(a.rule)
  return {
    ...blank(ctx, 'audience', a.id),
    entity_name: a.name ?? null,
    audience_subtype: a.subtype ?? null,
    audience_count_lower: a.approximate_count_lower_bound ?? null,
    audience_rule_object_ids: objectIds,
    audience_rule_events: events,
    audience_retention_days: a.retention_days ?? null,
    audience_created_at: a.time_created ? new Date(a.time_created * 1000).toISOString() : null,
  }
}

/**
 * 设置哈希：只覆盖「设置」字段。
 *   - 名字、source_updated_time 不进哈希（改名不是设置变化）
 *   - 受众人数只按「是否超过 Meta 显示下限 1000」进哈希：D4 要知道它什么时候跨过下限，
 *     但类似受众人数天天浮动，原值进哈希会每 3 小时记一行噪音（2026-09-14 子牙/魏征复审）
 *   - 嵌套对象（定向地区、扩展开关、实验列表）按 key 深度排序后再序列化，Meta 返回的 key
 *     顺序变化不算设置变化
 */
const HASH_EXCLUDED = new Set<keyof RowWithoutHash>(['entity_name', 'source_updated_time', 'audience_count_lower'])
export const AUDIENCE_DISPLAY_FLOOR = 1000

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort().map(k => [k, canonical((value as Record<string, unknown>)[k])])
  }
  return value
}

export function settingsHash(row: RowWithoutHash): string {
  const keys = (Object.keys(row) as Array<keyof RowWithoutHash>).filter(k => !HASH_EXCLUDED.has(k)).sort()
  const body = keys.map(k => [k, canonical(row[k])])
  body.push(['audience_above_floor', row.audience_count_lower === null ? null : row.audience_count_lower > AUDIENCE_DISPLAY_FLOOR])
  return createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32)
}

/** 标记「消失」行的哈希。消失后再出现会因哈希不同记 changed。 */
export const DISAPPEARED_HASH = 'disappeared'

export interface LatestSnapshotRef {
  level: SnapshotLevel
  entity_id: string
  settings_hash: string
  capture_reason: CaptureReason
  captured_at: string
}

/** 「这一层读全了却没返回它」的实体行：只带身份，设置字段全空，effective_status 标 NOT_RETURNED。 */
export function disappearedDraft(ctx: Ctx, level: SnapshotLevel, entityId: string): RowWithoutHash {
  return { ...blank(ctx, level, entityId), effective_status: 'NOT_RETURNED' }
}

/**
 * 决定这一轮要写哪些行。
 *
 * - 近 30 天从没记过该实体 → 'first_seen'（不算设置变化）
 * - 与最新一行哈希不同 → 'changed'
 * - 哈希相同，但 `dayKey(captured_at)` 今天还没有行 → 'daily'（「另每天一次」）
 * - 最新一行不是 disappeared，但该层 `completeLevels` 里读全了却没返回它 → 'disappeared'
 *   （读不全的层绝不判消失——否则一次读失败会把整层记成「没了」）
 *
 * `reason` 传 kernel_pre / kernel_post 时当前实体一律写（阶段 2 内核运行前后各抓一次，§14 M1）。
 * `dayKey` 由调用方给（按账户时区切天），纯函数里不猜时区。
 */
export function selectRowsToWrite(
  current: RowWithoutHash[],
  latest: LatestSnapshotRef[],
  opts: {
    capturedAt: string
    dayKey: (iso: string) => string
    reason?: 'scheduled' | 'kernel_pre' | 'kernel_post'
    /** 本轮读全了的层级。不传 = 不判消失。 */
    completeLevels?: ReadonlySet<SnapshotLevel>
    /** 生成消失行用的上下文（client / account） */
    ctx?: Ctx
  },
): EntitySnapshotRow[] {
  const latestByKey = new Map<string, LatestSnapshotRef>()
  for (const l of latest) {
    const key = `${l.level}:${l.entity_id}`
    const prev = latestByKey.get(key)
    if (!prev || l.captured_at > prev.captured_at) latestByKey.set(key, l)
  }
  const today = opts.dayKey(opts.capturedAt)
  const kernel = opts.reason === 'kernel_pre' || opts.reason === 'kernel_post' ? opts.reason : null
  const out: EntitySnapshotRow[] = []
  const seen = new Set<string>()
  for (const row of current) {
    const key = `${row.level}:${row.entity_id}`
    seen.add(key)
    const hash = settingsHash(row)
    const base = { ...row, settings_hash: hash, captured_at: opts.capturedAt }
    if (kernel) {
      out.push({ ...base, capture_reason: kernel })
      continue
    }
    const prev = latestByKey.get(key)
    if (!prev) out.push({ ...base, capture_reason: 'first_seen' })
    else if (prev.settings_hash !== hash) out.push({ ...base, capture_reason: 'changed' })
    else if (opts.dayKey(prev.captured_at) !== today) out.push({ ...base, capture_reason: 'daily' })
  }

  if (opts.completeLevels && opts.ctx) {
    for (const [key, prev] of Array.from(latestByKey.entries())) {
      if (seen.has(key) || prev.capture_reason === 'disappeared') continue
      if (!opts.completeLevels.has(prev.level)) continue
      out.push({
        ...disappearedDraft(opts.ctx, prev.level, prev.entity_id),
        settings_hash: DISAPPEARED_HASH,
        capture_reason: 'disappeared',
        captured_at: opts.capturedAt,
      })
    }
  }
  return out
}

export type { Ctx as SnapshotContext, RowWithoutHash as SnapshotRowDraft }
