/**
 * 按目标盯盘 · 读 Meta（只读）：一个广告系列的结构（广告组 / 广告 / 状态 / 最后修改时间）
 * 和三层洞察（整个系列 / 按广告组 / 按广告）。
 *
 * 🔴 只读：只发 GET，令牌只进 Authorization 头，绝不进网址；报错文字过 sanitizeError 抹掉令牌。
 * 🔴 读不到 / 读不全 / 读不懂 = read:false，绝不当成「还没花钱」；只有读懂了、确实没有数据行才是 total=null。
 * 🔴 平台通用：不点名任何客户。
 *
 * 为什么三层洞察要分开读：频次和触达不能相加（同一个人在不同广告里看到会被去重），
 * 整个系列的触达 / 频次必须单独向 Meta 要，不能把广告的数字加起来。
 */

import {
  MESSAGING_ACTION_PRIORITY,
  pickAction,
  pickActionCost,
  type MetaActionStat,
} from '@/lib/meta/objective-metrics'
import { makeGraphGet, parseGraphTime, type GraphGet } from './meta-reader'
import { dateInTimezone, hasDataArray, hasNextPage } from './post-launch'
import { sanitizeError } from './sanitize'
import type { Sleep } from './retry'
import type { CampaignFact, EntityFact, MetricsRow, SeriesFacts, SeriesUnread } from './objective-watch'

const ACCOUNT_ID_RE = /^act_\d{6,20}$/
const CAMPAIGN_ID_RE = /^\d{6,20}$/
const LIST_LIMIT = '100'
const VIDEO_VIEW = ['video_view']

/** 读系列节点只许要这些字段（meta-reader 的白名单也认这一份）。 */
export const CAMPAIGN_FIELDS = 'id,name,objective,status,effective_status,created_time,updated_time,account_id'
const ADSET_FIELDS = 'id,name,status,effective_status,updated_time,start_time,end_time,destination_type'
const AD_FIELDS = 'id,name,adset_id,status,effective_status,updated_time'
const METRIC_FIELDS = 'spend,impressions,reach,frequency,actions,cost_per_action_type,video_thruplay_watched_actions,cost_per_thruplay'

export type InsightLevel = 'campaign' | 'adset' | 'ad'

const ID_FIELD: Readonly<Record<InsightLevel, string>> = { campaign: 'campaign_id', adset: 'adset_id', ad: 'ad_id' }
const NAME_FIELD: Readonly<Record<InsightLevel, string>> = { campaign: 'campaign_name', adset: 'adset_name', ad: 'ad_name' }

// ─── 解析（纯函数，导出给单测）──────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : null
}

/** Meta 的 [{action_type, value}] 数组；格式不对的条目丢掉。 */
function actionStats(v: unknown): MetaActionStat[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: MetaActionStat[] = []
  for (const raw of v) {
    if (!isRecord(raw) || typeof raw.action_type !== 'string') continue
    const value = typeof raw.value === 'string' ? raw.value : typeof raw.value === 'number' ? String(raw.value) : null
    if (value !== null) out.push({ action_type: raw.action_type, value })
  }
  return out
}

export function parseCampaignNode(body: unknown): CampaignFact | null {
  if (!isRecord(body)) return null
  const id = str(body.id)
  if (id === null) return null
  return {
    id,
    name: str(body.name) ?? id,
    objective: str(body.objective),
    status: str(body.status),
    effective_status: str(body.effective_status),
    created_at: parseGraphTime(body.created_time),
    updated_at: parseGraphTime(body.updated_time),
  }
}

function parseEntity(raw: unknown, withParent: boolean): EntityFact | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  if (id === null) return null
  const base: EntityFact = {
    id,
    name: str(raw.name) ?? id,
    parent_id: withParent ? str(raw.adset_id) : null,
    status: str(raw.status),
    effective_status: str(raw.effective_status),
    updated_at: parseGraphTime(raw.updated_time),
  }
  // 广告组才有定时开始 / 结束时间和投放目的地
  return withParent
    ? base
    : { ...base, start_at: parseGraphTime(raw.start_time), end_at: parseGraphTime(raw.end_time), destination_type: str(raw.destination_type) }
}

/** 广告组 / 广告列表 → 实体；没有 data 数组 = null（读不懂）。 */
export function parseEntities(body: unknown, withParent: boolean): EntityFact[] | null {
  if (!hasDataArray(body)) return null
  const out: EntityFact[] = []
  for (const raw of body.data) {
    const entity = parseEntity(raw, withParent)
    if (entity !== null) out.push(entity)
  }
  return out
}

function parseMetricsRow(raw: unknown, level: InsightLevel): MetricsRow | null {
  if (!isRecord(raw)) return null
  const id = str(raw[ID_FIELD[level]])
  if (id === null) return null
  const reach = num(raw.reach)
  return {
    id,
    name: str(raw[NAME_FIELD[level]]) ?? id,
    spend_cents: Math.round((num(raw.spend) ?? 0) * 100),
    impressions: Math.round(num(raw.impressions) ?? 0),
    reach: reach === null ? null : Math.round(reach),
    frequency: num(raw.frequency),
    thruplays: pickAction(actionStats(raw.video_thruplay_watched_actions), VIDEO_VIEW),
    cost_per_thruplay: pickActionCost(actionStats(raw.cost_per_thruplay), VIDEO_VIEW),
    conversations: pickAction(actionStats(raw.actions), MESSAGING_ACTION_PRIORITY),
    cost_per_conversation: pickActionCost(actionStats(raw.cost_per_action_type), MESSAGING_ACTION_PRIORITY),
  }
}

/**
 * 洞察响应 → 行；没有 data 数组、或有任何一行读不懂（不是对象 / 缺编号）= null（读不懂，不是「没数据」）。
 * 🔴 不悄悄丢行：丢了行会把「有数据」说成「还没花钱」。
 */
export function parseMetricsRows(body: unknown, level: InsightLevel): MetricsRow[] | null {
  if (!hasDataArray(body)) return null
  const out: MetricsRow[] = []
  for (const raw of body.data) {
    const row = parseMetricsRow(raw, level)
    if (row === null) return null
    out.push(row)
  }
  return out
}

// ─── 读 ─────────────────────────────────────────────────────────────────────

export interface SeriesReadInput {
  adAccountId: string
  campaignId: string
  token: string
  fetcher: typeof fetch
  now: Date
  /** 单测里换成不真等的版本；不传就真等 */
  sleep?: Sleep
}

async function readTimezone(graphGet: GraphGet, adAccountId: string): Promise<string | null> {
  try {
    const body = await graphGet(adAccountId, { fields: 'timezone_name' })
    const tz = isRecord(body) ? body.timezone_name : null
    return typeof tz === 'string' && tz.length > 0 ? tz : null
  } catch {
    return null
  }
}

async function readEntities(graphGet: GraphGet, path: string, fields: string, withParent: boolean, what: string): Promise<EntityFact[]> {
  const body = await graphGet(path, { fields, limit: LIST_LIMIT })
  const entities = parseEntities(body, withParent)
  if (entities === null) throw new Error(`${what}列表响应读不懂（里面没有 data 数组）`)
  if (hasNextPage(body)) throw new Error(`${what}太多，读不全`)
  return entities
}

async function readInsights(graphGet: GraphGet, campaignId: string, level: InsightLevel, range: string): Promise<MetricsRow[]> {
  const idFields = `${ID_FIELD[level]},${NAME_FIELD[level]}`
  const body = await graphGet(`${campaignId}/insights`, {
    level,
    fields: `${idFields},${METRIC_FIELDS}`,
    time_range: range,
    limit: LIST_LIMIT,
  })
  const rows = parseMetricsRows(body, level)
  if (rows === null) throw new Error('洞察响应读不懂（里面没有 data 数组），不当成「还没花钱」')
  if (hasNextPage(body)) throw new Error('洞察结果有下一页，读不全，不当成完整结果')
  return rows
}

async function readSeries(graphGet: GraphGet, input: SeriesReadInput): Promise<SeriesFacts> {
  const { adAccountId, campaignId, now } = input
  // 🔴 账户时区读不到就读不到：悄悄退回 UTC 日期，新西兰早上会少算一天，当天才开始花钱的系列会被误报「没花钱」
  const timezone = await readTimezone(graphGet, adAccountId)
  if (timezone === null) throw new Error('读不到广告账户的时区，没法定数据的日期范围')
  const nodeBody = await graphGet(campaignId, { fields: CAMPAIGN_FIELDS })
  const campaign = parseCampaignNode(nodeBody)
  if (campaign === null || campaign.id !== campaignId) throw new Error('系列节点响应读不懂（编号对不上）')
  // 🔴 系列必须属于配置的广告账户：编号抄错会读到别家的数据
  const owner = isRecord(nodeBody) ? str(nodeBody.account_id) : null
  if (owner !== adAccountId.replace(/^act_/, '')) throw new Error('这个系列不属于配置的广告账户（或读不到它所属的账户），不读它的数据')
  const adsets = await readEntities(graphGet, `${campaignId}/adsets`, ADSET_FIELDS, false, '广告组')
  const ads = await readEntities(graphGet, `${campaignId}/ads`, AD_FIELDS, true, '广告')
  const created = campaign.created_at === null ? now : new Date(campaign.created_at)
  const range = JSON.stringify({ since: dateInTimezone(created, timezone), until: dateInTimezone(now, timezone) })
  const total = await readInsights(graphGet, campaignId, 'campaign', range)
  const byAdset = await readInsights(graphGet, campaignId, 'adset', range)
  const byAd = await readInsights(graphGet, campaignId, 'ad', range)
  return {
    read: true,
    as_of: now.toISOString(),
    campaign,
    adsets,
    ads,
    total: total.find(r => r.id === campaignId) ?? null,
    by_adset: byAdset,
    by_ad: byAd,
  }
}

/** 永不 reject：读不到就 read:false。 */
export async function readSeriesFacts(input: SeriesReadInput): Promise<SeriesFacts | SeriesUnread> {
  const fail = (error: string): SeriesUnread => ({ read: false, error })
  if (!ACCOUNT_ID_RE.test(input.adAccountId)) return fail('广告账户编号格式不对')
  if (!CAMPAIGN_ID_RE.test(input.campaignId)) return fail('广告系列编号格式不对（要 6–20 位纯数字）')
  const graphGet = makeGraphGet(input.fetcher, input.token, input.sleep)
  try {
    return await readSeries(graphGet, input)
  } catch (err) {
    return fail(`读取失败：${sanitizeError(err, [input.token])}`)
  }
}
