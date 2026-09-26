import { MetaReadError } from '../graph-read'
import { LEAD_ACTION_PRIORITY, MESSAGING_ACTION_PRIORITY, pickAction, type MetaActionStat } from '../objective-metrics'
import { resolveCoreMetric, type CoreMetric } from '@/lib/ads-strategy/rules/core-metric'
import type { OutcomeStep } from '@/lib/ads-strategy/portfolio/outcome-ladder'
export type Window = { since: string; until: string }
const DAY = 86_400_000
function dateNumber(day: string): number {
  const n = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0,10) !== day) throw new MetaReadError('invalid_date_range')
  return n
}
export function resolveWindow(input: Window | undefined, timezone: string, now = new Date()): Window {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const end = dateNumber(today) - DAY
  const result = input ?? { since: new Date(end - 6 * DAY).toISOString().slice(0,10), until: new Date(end).toISOString().slice(0,10) }
  const start = dateNumber(result.since), stop = dateNumber(result.until)
  if (start > stop || stop > end || stop-start >= 90 * DAY) throw new MetaReadError('invalid_date_range')
  return result
}
export function previousWindow(window: Window): Window {
  const start = dateNumber(window.since), end = dateNumber(window.until)
  return { since: new Date(start-(end-start+DAY)).toISOString().slice(0,10), until: new Date(start-DAY).toISOString().slice(0,10) }
}
export function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || (typeof value !== 'string' && typeof value !== 'number')) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}
export function ratio(a: number | null, b: number | null, scale = 1): number | null {
  return a !== null && b !== null && b > 0 ? a / b * scale : null
}
function action(value: unknown, type: string): number | null {
  if (!Array.isArray(value)) return null
  const row = value.find((item: { action_type?: string }) => item?.action_type === type)
  return numeric(row?.value)
}
const videos = ['video_p25_watched_actions','video_p50_watched_actions','video_p75_watched_actions','video_p95_watched_actions','video_p100_watched_actions','video_thruplay_watched_actions'] as const
export function normaliseInsight(row: Record<string, unknown>, conversion: string, videoRequested=false) {
  const spend = numeric(row.spend), impressions = numeric(row.impressions), clicks = numeric(row.clicks)
  const conversions = action(row.actions, conversion), leads = action(row.actions, 'lead')
  const starts = action(row.video_play_actions, 'video_view')
  const metrics = { spend, impressions, clicks, reach: numeric(row.reach), frequency: numeric(row.frequency),
    ctr: ratio(clicks, impressions), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions,1000),
    leads, cpl: ratio(spend, leads), conversions, cost_per_conversion: ratio(spend, conversions) }
  return { ...Object.fromEntries(['account_id','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name','date_start','date_stop',
    'age','gender','publisher_platform','platform_position','device_platform','country']
    .filter(key => typeof row[key] === 'string').map(key => [key, row[key]])), ...metrics,
    availability: { metrics:Object.fromEntries(Object.entries(metrics).map(([name,value])=>[name,value===null ? 'not_reported_or_undefined' : 'available'])),
      video:videoRequested ? (starts === null ? 'not_reported_may_be_inapplicable_or_suppressed' : 'available') : 'not_requested' },
    ...(videoRequested ? { video_starts: starts, ...Object.fromEntries(videos.flatMap(key => {
      const count = action(row[key], 'video_view')
      return [[key, count], [`${key}_retention`, ratio(count, starts)]]
    })) } : {}),
    actions: Array.isArray(row.actions) ? row.actions.filter(item => item && typeof item.action_type === 'string')
      .map(item => ({ action_type: item.action_type as string, value: numeric(item.value) })) : null,
  }
}
export function compareMetrics(current: Record<string, unknown>, previous: Record<string, unknown>) {
  return Object.fromEntries(['spend','impressions','clicks','reach','frequency','ctr','cpc','cpm','leads','cpl','conversions','cost_per_conversion'].map(key => {
    const a = numeric(current[key]), b = numeric(previous[key])
    return [key, { current: a, previous: b, delta: a !== null && b !== null ? a-b : null,
      percent_change: a !== null && b !== null && b > 0 ? (a-b)/b*100 : null }]
  }))
}

/** 广告组的去向与优化目标（Graph adsets 读来的）。 */
export interface AdsetMeta { destination_type: string | null; optimization_goal: string | null }

/**
 * 按广告组去向算出的结果口径。🔴 留资 = 各「留资组」的留资之和，开聊 = 各「开聊组」的开聊之和，永不相加
 * （Messenger 里填表的人会同时记一次留资、一次开聊——手册 §13）。去向为空（播放/互动/网站转化）或读不到的组不进结果口径。
 */
export interface CoreResultSummary {
  core_metric: CoreMetric | 'mixed' | null
  leads: number | null
  conversations: number | null
  results: number | null
  cost_per_result: number | null
  cost_per_lead: number | null
  cost_per_conversation: number | null
  /** 目标不是收集客户的组（播放、互动、网站转化…）的花费 */
  other_goal_spend: number
  /** 去向读不到的组的花费 */
  unknown_goal_spend: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Graph 原始 actions 数组 → pickAction 能吃的形状（丢掉坏项；value 统一成字符串）。 */
export function toActionStats(value: unknown): MetaActionStat[] | undefined {
  if (!Array.isArray(value)) return undefined
  const stats: MetaActionStat[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { action_type, value: raw } = item as { action_type?: unknown; value?: unknown }
    if (typeof action_type !== 'string') continue
    if (typeof raw === 'string') { stats.push({ action_type, value: raw }); continue }
    if (typeof raw === 'number' && Number.isFinite(raw)) stats.push({ action_type, value: String(raw) })
  }
  return stats
}

/** 'unknown' = 没读到这个组的去向。 */
export function adsetCoreMetric(meta: AdsetMeta | undefined, clientPrimary: OutcomeStep | null): CoreMetric | null | 'unknown' {
  if (!meta) return 'unknown'
  return resolveCoreMetric({ destinationType: meta.destination_type, optimizationGoal: meta.optimization_goal, clientPrimary })
}

/** rows: Graph insights rows at level=adset (fields include adset_id, spend, actions). */
export function summariseCoreResults(rows: readonly Record<string, unknown>[], metaById: ReadonlyMap<string, AdsetMeta>, clientPrimary: OutcomeStep | null): CoreResultSummary {
  let leads = 0, conversations = 0, leadSpend = 0, convSpend = 0, otherSpend = 0, unknownSpend = 0
  let hasLead = false, hasConv = false
  for (const row of rows) {
    const adsetId = row.adset_id
    if (typeof adsetId !== 'string') continue
    const spend = numeric(row.spend) ?? 0
    const metric = adsetCoreMetric(metaById.get(adsetId), clientPrimary)
    if (metric === 'lead') {
      leads += pickAction(toActionStats(row.actions), LEAD_ACTION_PRIORITY)
      leadSpend += spend
      if (spend > 0) hasLead = true
    } else if (metric === 'messaging_started') {
      conversations += pickAction(toActionStats(row.actions), MESSAGING_ACTION_PRIORITY)
      convSpend += spend
      if (spend > 0) hasConv = true
    } else if (metric === 'unknown') {
      unknownSpend += spend
    } else {
      otherSpend += spend
    }
  }
  const core_metric: CoreMetric | 'mixed' | null = hasLead && hasConv ? 'mixed' : hasLead ? 'lead' : hasConv ? 'messaging_started' : null
  const finalLeads = hasLead ? leads : null
  const finalConversations = hasConv ? conversations : null
  const cost_per_lead = hasLead && leads > 0 ? round2(leadSpend / leads) : null
  const cost_per_conversation = hasConv && conversations > 0 ? round2(convSpend / conversations) : null
  const results = core_metric === 'lead' ? finalLeads : core_metric === 'messaging_started' ? finalConversations : null
  const cost_per_result = core_metric === 'lead' ? cost_per_lead : core_metric === 'messaging_started' ? cost_per_conversation : null
  return { core_metric, leads: finalLeads, conversations: finalConversations, results, cost_per_result,
    cost_per_lead, cost_per_conversation, other_goal_spend: round2(otherSpend), unknown_goal_spend: round2(unknownSpend) }
}

/** Same, grouped by campaign_id (rows without a string campaign_id are skipped). */
export function coreResultsByCampaign(rows: readonly Record<string, unknown>[], metaById: ReadonlyMap<string, AdsetMeta>, clientPrimary: OutcomeStep | null): Map<string, CoreResultSummary> {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const campaignId = row.campaign_id
    if (typeof campaignId !== 'string') continue
    const group = groups.get(campaignId)
    if (group) group.push(row)
    else groups.set(campaignId, [row])
  }
  return new Map([...groups].map(([id, group]) => [id, summariseCoreResults(group, metaById, clientPrimary)]))
}
