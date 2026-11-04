/**
 * Meta Connector · 广告实体设置只读接口（ads IMPACT 阶段 1，设计 §2.1 / §7 L3）。
 *
 * 🔴 本文件**只有 GET**。阶段 1 全程不新增任何对 Meta 的写入；写入口在
 *    `client.ts` / `adsets.ts` / `ad-publisher.ts` / `audience-ladder.ts`，阶段 2 才经内核。
 *
 * 字段形状以 2026-09-14 对真实账户只读实拉为准，见
 * `src/lib/ads-strategy/portfolio/__tests__/fixtures/`。
 *
 * 读失败不抛异常，返回 `complete:false` + `error`——「没有实体」和「Meta 拒绝了我们」
 * 在调用方必须能区分（否则快照会把读失败记成「账户空了」）。
 */

import type { GraphBreakdownRow } from '@/lib/ads-strategy/breakdown-stats/types'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'
const PAGE_LIMIT = '200'
const MAX_PAGES = 25
/** 单个请求上限。一个请求卡住不能拖住整轮快照（3 小时一轮，路由 maxDuration 600s）。 */
const REQUEST_TIMEOUT_MS = 20_000

export interface GraphReadError {
  status: number
  code: number | null
  message: string
}

export interface GraphReadResult<T> {
  rows: T[]
  complete: boolean
  /** Meta 报的错（不含令牌）。complete=true 时为 null。 */
  error: GraphReadError | null
}

/**
 * 读哪些投放状态。不读 ARCHIVED / DELETED：归档实体量大且不投放；它们从结果里消失时，
 * 快照会记一行 'disappeared'（前提是那一层读全了）。PENDING_BILLING_INFO 必须读——D1 投放卡住要看它。
 */
const ALL_STATUSES = [
  'ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED',
  'PENDING_BILLING_INFO', 'PREAPPROVED',
]

export interface GraphAdStudy {
  id: string
  type?: string
  start_time?: string
  end_time?: string
}

export interface GraphAccountSettings {
  id: string
  name?: string
  account_status?: number
  disable_reason?: number
  currency?: string
  timezone_name?: string
}

export interface GraphCampaignSettings {
  id: string
  name?: string
  objective?: string
  status?: string
  effective_status?: string
  daily_budget?: string
  lifetime_budget?: string
  bid_strategy?: string
  special_ad_categories?: string[]
  smart_promotion_type?: string
  updated_time?: string
  ad_studies?: { data?: GraphAdStudy[] }
}

export interface GraphTargeting {
  custom_audiences?: Array<{ id: string; name?: string }>
  excluded_custom_audiences?: Array<{ id: string; name?: string }>
  targeting_automation?: { advantage_audience?: number }
  targeting_relaxation_types?: Record<string, number>
  geo_locations?: unknown
  age_min?: number
  age_max?: number
  /** 未设置 = 留给 Meta「自动版位」，纯播放类优化目标下会把钱导去 audience_network 奖励视频（PITFALLS D9）。 */
  publisher_platforms?: string[]
}

export interface GraphAdsetSettings {
  id: string
  name?: string
  campaign_id?: string
  optimization_goal?: string
  destination_type?: string
  daily_budget?: string
  lifetime_budget?: string
  bid_strategy?: string
  targeting?: GraphTargeting
  status?: string
  effective_status?: string
  learning_stage_info?: { status?: string }
  updated_time?: string
  ad_studies?: { data?: GraphAdStudy[] }
}

export interface GraphAdSettings {
  id: string
  name?: string
  adset_id?: string
  campaign_id?: string
  status?: string
  effective_status?: string
  updated_time?: string
  creative?: {
    id?: string
    video_id?: string
    effective_object_story_id?: string
    object_story_spec?: { page_id?: string; video_data?: { video_id?: string } }
  }
}

export interface GraphCustomAudience {
  id: string
  name?: string
  subtype?: string
  approximate_count_lower_bound?: number
  /** 受众是否可用：code 200 = 正常；读不到时缺省 */
  operation_status?: { code?: number }
  /** 受众是否能投出去：code 200 = 可投；读不到时缺省 */
  delivery_status?: { code?: number }
  time_created?: number
  time_updated?: number
  retention_days?: number
  /** Meta 返回 JSON 字符串；两种形状：视频规则数组 / inclusions 对象 */
  rule?: string
}

export interface GraphHourlySpendRow {
  campaign_id?: string
  adset_id?: string
  spend?: string
  impressions?: string
  date_start?: string
  hourly_stats_aggregated_by_advertiser_time_zone?: string
}

interface GraphEnvelope {
  data?: unknown
  paging?: { next?: string }
  error?: { message?: string; code?: number }
}

async function fetchJson(target: string): Promise<{ ok: true; body: unknown } | { ok: false; error: GraphReadError }> {
  let res: Response
  try {
    res = await fetch(target, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (err) {
    return { ok: false, error: { status: 0, code: null, message: err instanceof Error ? err.message : 'fetch failed' } }
  }
  const body: unknown = await res.json().catch(() => null)
  const envelope = (body ?? {}) as GraphEnvelope
  if (!res.ok || envelope.error) {
    return {
      ok: false,
      error: { status: res.status, code: envelope.error?.code ?? null, message: envelope.error?.message ?? `HTTP ${res.status}` },
    }
  }
  return { ok: true, body }
}

/** 列表读取：跟 paging.next 走完，遇错保留已读的行并标 incomplete。 */
async function readList<T>(firstUrl: string): Promise<GraphReadResult<T>> {
  const rows: T[] = []
  let next: string | undefined = firstUrl
  for (let page = 0; page < MAX_PAGES && next; page++) {
    const got = await fetchJson(next)
    if (!got.ok) return { rows, complete: false, error: got.error }
    const envelope = (got.body ?? {}) as GraphEnvelope
    if (Array.isArray(envelope.data)) rows.push(...(envelope.data as T[]))
    next = envelope.paging?.next
  }
  if (next) return { rows, complete: false, error: { status: 0, code: null, message: `hit ${MAX_PAGES}-page cap` } }
  return { rows, complete: true, error: null }
}

/** 单对象读取（账户本身）。 */
async function readOne<T>(target: string): Promise<GraphReadResult<T>> {
  const got = await fetchJson(target)
  if (!got.ok) return { rows: [], complete: false, error: got.error }
  return { rows: [got.body as T], complete: true, error: null }
}

function graphUrl(path: string, params: Record<string, string>, accessToken: string): string {
  const qs = new URLSearchParams({ ...params, access_token: accessToken })
  return `${GRAPH_BASE}/${path}?${qs.toString()}`
}

const STATUS_FILTER = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ALL_STATUSES }])
const STUDIES = 'ad_studies{id,type,start_time,end_time}'

export function fetchAccountSettings(adAccountId: string, accessToken: string) {
  return readOne<GraphAccountSettings>(graphUrl(adAccountId, {
    fields: 'id,name,account_status,disable_reason,currency,timezone_name',
  }, accessToken))
}

export function fetchCampaignSettings(adAccountId: string, accessToken: string) {
  return readList<GraphCampaignSettings>(graphUrl(`${adAccountId}/campaigns`, {
    fields: `id,name,objective,status,effective_status,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,smart_promotion_type,updated_time,${STUDIES}`,
    filtering: STATUS_FILTER,
    limit: PAGE_LIMIT,
  }, accessToken))
}

export function fetchAdsetSettings(adAccountId: string, accessToken: string) {
  return readList<GraphAdsetSettings>(graphUrl(`${adAccountId}/adsets`, {
    fields: `id,name,campaign_id,optimization_goal,destination_type,daily_budget,lifetime_budget,bid_strategy,targeting,status,effective_status,learning_stage_info,updated_time,${STUDIES}`,
    filtering: STATUS_FILTER,
    limit: PAGE_LIMIT,
  }, accessToken))
}

export function fetchAdSettings(adAccountId: string, accessToken: string) {
  return readList<GraphAdSettings>(graphUrl(`${adAccountId}/ads`, {
    fields: 'id,name,adset_id,campaign_id,status,effective_status,updated_time,creative{video_id,effective_object_story_id,object_story_spec{page_id,video_data{video_id}}}',
    filtering: STATUS_FILTER,
    limit: PAGE_LIMIT,
  }, accessToken))
}

export function fetchCustomAudiences(adAccountId: string, accessToken: string) {
  return readList<GraphCustomAudience>(graphUrl(`${adAccountId}/customaudiences`, {
    fields: 'id,name,subtype,approximate_count_lower_bound,operation_status{code},delivery_status{code},time_created,time_updated,retention_days,rule',
    limit: PAGE_LIMIT,
  }, accessToken))
}

/**
 * 单个自定义受众（含所属账户号 account_id）。
 * 2026-10-26 实测：Meta 的「账户受众列表」边会漏掉部分相似受众（直接按 id 读得到、account_id 也对，
 * 但列表里没有），所以归属核对在列表里找不到时要用它补一次，不能直接判「不属于这个账户」。
 */
export function fetchCustomAudienceById(audienceId: string, accessToken: string) {
  return readOne<GraphCustomAudience & { account_id?: string }>(graphUrl(audienceId, {
    fields: 'id,name,subtype,account_id,approximate_count_lower_bound,operation_status{code},delivery_status{code}',
  }, accessToken))
}

/**
 * 某一天按广告组、按账户时区小时拆开的花费（D1 投放卡住按需拉，**不入库**，只进诊断证据）。
 */
export function fetchHourlyAdsetSpend(adAccountId: string, accessToken: string, day: string) {
  return readList<GraphHourlySpendRow>(graphUrl(`${adAccountId}/insights`, {
    fields: 'campaign_id,adset_id,spend,impressions',
    level: 'adset',
    breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    time_range: JSON.stringify({ since: day, until: day }),
    limit: '500',
  }, accessToken))
}

/**
 * 广告级、按天、按一种切法拆开的 insights（广告机会挖掘底座，只读，设计 v0.3 §3）。
 * `graphBreakdowns` 由 `breakdown-stats/specs.ts` 给出；Meta 不允许小时拆分叠加别的切法，调用方一次只传一种。
 * 窗口要由调用方切小（按 7 天一段）：广告 × 24 小时 × 天数很快会顶到 MAX_PAGES 上限，顶到就是 complete:false。
 */
export function fetchAdBreakdownInsights(
  adAccountId: string,
  accessToken: string,
  graphBreakdowns: string,
  since: string,
  until: string,
) {
  return readList<GraphBreakdownRow>(graphUrl(`${adAccountId}/insights`, {
    fields: 'ad_id,adset_id,campaign_id,spend,impressions,clicks,inline_link_clicks,actions,account_currency',
    level: 'ad',
    breakdowns: graphBreakdowns,
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    limit: '500',
  }, accessToken))
}

export interface GraphAccountDailySpendRow {
  date_start?: string
  spend?: string
}

/** 账户级逐日总花费（对账用：各切法花费合计应等于它）。Meta 对零花费的日子不返回行。 */
export function fetchAccountDailySpend(adAccountId: string, accessToken: string, since: string, until: string) {
  return readList<GraphAccountDailySpendRow>(graphUrl(`${adAccountId}/insights`, {
    fields: 'spend',
    level: 'account',
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    limit: '500',
  }, accessToken))
}

// ---------------------------------------------------------------------------
// 心跳（heartbeat）专用瘦读接口。全部 GET，只读；字段刻意收窄以压低延迟与配额。
// ---------------------------------------------------------------------------

/** 账户级心跳字段：账户状态 / 停用原因 / 币种 / 时区。 */
export interface GraphHeartbeatAccount {
  id: string
  account_status?: number
  disable_reason?: number
  currency?: string
  timezone_name?: string
}

export function fetchHeartbeatAccount(adAccountId: string, accessToken: string) {
  return readOne<GraphHeartbeatAccount>(graphUrl(adAccountId, {
    fields: 'id,account_status,disable_reason,currency,timezone_name',
  }, accessToken))
}

/** 广告组级心跳字段。不含 targeting / ad_studies / creative。 */
export interface GraphHeartbeatAdset {
  id: string
  name?: string
  campaign_id?: string
  effective_status?: string
  daily_budget?: string
  lifetime_budget?: string
  created_time?: string
  start_time?: string
  updated_time?: string
  adset_schedule?: unknown[]
  is_dynamic_creative?: boolean
}

/** 心跳只看「还活着」的投放状态；PAUSED / ARCHIVED 不读。 */
const HEARTBEAT_STATUSES = ['ACTIVE', 'WITH_ISSUES', 'PENDING_REVIEW', 'IN_PROCESS', 'DISAPPROVED', 'PREAPPROVED']
const HEARTBEAT_STATUS_FILTER = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: HEARTBEAT_STATUSES }])

/**
 * 只读一页的广告组读取（给「实时在投合计」用）：状态过滤由调用方传（覆盖预算核算要算的全部在投状态，
 * 心跳自己的 HEARTBEAT_STATUSES 不含 PENDING_BILLING_INFO）；**不跟分页**——有下一页就标 incomplete，
 * 让调用方回落快照，这样每个账户的实际 HTTP 请求数就是 1（不会被 readList 的 25 页翻页放大）。
 */
export async function fetchAdsetsSinglePage(
  adAccountId: string,
  accessToken: string,
  statuses: readonly string[],
): Promise<GraphReadResult<GraphHeartbeatAdset>> {
  const got = await fetchJson(graphUrl(`${adAccountId}/adsets`, {
    fields: 'id,name,campaign_id,effective_status,daily_budget,lifetime_budget,created_time,start_time,updated_time,adset_schedule,is_dynamic_creative',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: [...statuses] }]),
    limit: PAGE_LIMIT,
  }, accessToken))
  if (!got.ok) return { rows: [], complete: false, error: got.error }
  const envelope = (got.body ?? {}) as GraphEnvelope
  const rows = Array.isArray(envelope.data) ? (envelope.data as GraphHeartbeatAdset[]) : []
  if (envelope.paging?.next) {
    return { rows, complete: false, error: { status: 0, code: null, message: 'more than one page; not followed' } }
  }
  return { rows, complete: true, error: null }
}

export function fetchHeartbeatAdsets(adAccountId: string, accessToken: string) {
  return readList<GraphHeartbeatAdset>(graphUrl(`${adAccountId}/adsets`, {
    fields: 'id,name,campaign_id,effective_status,daily_budget,lifetime_budget,created_time,start_time,updated_time,adset_schedule,is_dynamic_creative',
    filtering: HEARTBEAT_STATUS_FILTER,
    limit: PAGE_LIMIT,
  }, accessToken))
}

/** 广告级心跳字段。不展开 creative。 */
export interface GraphHeartbeatAd {
  id: string
  adset_id?: string
  effective_status?: string
  updated_time?: string
}

export function fetchHeartbeatAds(adAccountId: string, accessToken: string) {
  return readList<GraphHeartbeatAd>(graphUrl(`${adAccountId}/ads`, {
    fields: 'id,adset_id,effective_status,updated_time',
    filtering: HEARTBEAT_STATUS_FILTER,
    limit: PAGE_LIMIT,
  }, accessToken))
}

/** 当日按广告组拆的花费/曝光（账户时区日期由调用方给出）。 */
export interface GraphHeartbeatInsightRow {
  adset_id?: string
  spend?: string
  impressions?: string
}

export function fetchHeartbeatTodayInsights(adAccountId: string, accessToken: string, day: string) {
  return readList<GraphHeartbeatInsightRow>(graphUrl(`${adAccountId}/insights`, {
    fields: 'adset_id,spend,impressions',
    level: 'adset',
    time_range: JSON.stringify({ since: day, until: day }),
    limit: '500',
  }, accessToken))
}

/** 每账户每小时心跳读次数：账户 + 广告组 + 广告 + 当日 insights。设计上限为每账户每小时 <= 6 次。 */
export const HEARTBEAT_READ_CALLS_PER_ACCOUNT = 4

/** Minimal public read projection. Shared with the model-neutral AI tools; no targeting/PII. */
export const AI_ENTITY_FIELDS = {
  account: 'id,name,account_status,currency,timezone_name',
  campaigns: 'id,name,objective,status,effective_status,updated_time',
  adsets: 'id,name,campaign_id,optimization_goal,status,effective_status,updated_time',
  ads: 'id,name,adset_id,campaign_id,status,effective_status,updated_time,creative{id,video_id}',
} as const
