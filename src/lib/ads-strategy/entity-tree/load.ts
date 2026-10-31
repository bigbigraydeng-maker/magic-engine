/**
 * Loads stored daily insights + latest entity snapshots for the ads-health "每条广告" tab.
 * Read-only: database only, never calls Meta.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { countAction } from '@/lib/ads-strategy/link-clicks'
import { buildEntityTree } from './build'
import type { EntityTree, InsightRow, SnapshotRow } from './build'
import { scopeToClientPage } from './scope'

/** The tree plus what the scope filter left out, so the page never says "nothing running" when it simply could not tell. */
export interface EntityTreeResult {
  tree: EntityTree
  hiddenAdsets: number
  noPageRegistered: boolean
}

const PAGE_SIZE = 1000
/** Snapshots are taken daily; a few days back is enough to hold the latest one of every live entity. */
const SNAPSHOT_LOOKBACK_DAYS = 4
export const TREE_DEFAULT_DAYS = 7
export const TREE_MAX_DAYS = 30

type Level = 'campaign' | 'adset' | 'ad'

interface RawInsight {
  level: string
  entity_id: string
  entity_name: string | null
  parent_id: string | null
  insight_date: string
  spend: number | string | null
  impressions: number | string | null
  clicks: number | string | null
  leads: number | string | null
  messaging_conversations: number | string | null
  actions?: unknown
  video_3s_views?: number | string | null
}

interface RawSnapshot {
  level: string
  entity_id: string
  entity_name: string | null
  campaign_id: string | null
  adset_id: string | null
  effective_status: string | null
  daily_budget_minor: number | string | null
  currency: string | null
  captured_at: string
  creative_page_id: string | null
}

const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

const isLevel = (v: string): v is Level => v === 'campaign' || v === 'adset' || v === 'ad'

export function toInsightRow(r: RawInsight): InsightRow | null {
  if (!isLevel(r.level)) return null
  return {
    level: r.level,
    entityId: r.entity_id,
    entityName: r.entity_name,
    parentId: r.parent_id,
    date: r.insight_date,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    leads: num(r.leads),
    messagingConversations: num(r.messaging_conversations),
    linkClicks: countAction(r.actions, 'link_click'),
    video3sViews: num(r.video_3s_views),
  }
}

export function toSnapshotRow(r: RawSnapshot): SnapshotRow | null {
  if (!isLevel(r.level)) return null
  return {
    level: r.level,
    entityId: r.entity_id,
    entityName: r.entity_name,
    campaignId: r.campaign_id,
    adsetId: r.adset_id,
    effectiveStatus: r.effective_status,
    dailyBudgetMinor: r.daily_budget_minor === null ? null : num(r.daily_budget_minor),
    currency: r.currency,
    capturedAt: r.captured_at,
    creativePageId: r.creative_page_id,
  }
}

/** Offset paging on a random id can read one row twice when a sync inserts mid-read; one row per (level, entity, date). */
export function dedupeInsights(rows: InsightRow[]): InsightRow[] {
  const seen = new Map<string, InsightRow>()
  for (const r of rows) seen.set(`${r.level}|${r.entityId}|${r.date}`, r)
  return [...seen.values()]
}

export function clampTreeDays(raw: string | null): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return TREE_DEFAULT_DAYS
  return Math.min(n, TREE_MAX_DAYS)
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
}

async function loadClientPageId(clientId: string, supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.from('clients').select('facebook_page_id').eq('id', clientId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { facebook_page_id: string | null } | null)?.facebook_page_id ?? null
}

export async function loadEntityTree(clientId: string, days: number, supabase: SupabaseClient): Promise<EntityTreeResult> {
  const latest = await supabase
    .from('ad_daily_insights')
    .select('insight_date')
    .eq('client_id', clientId)
    .order('insight_date', { ascending: false })
    .limit(1)
  if (latest.error) throw new Error(latest.error.message)
  const endDate = (latest.data?.[0] as { insight_date: string } | undefined)?.insight_date
  if (!endDate) {
    const empty = buildEntityTree([], [], { endDate: addDays(new Date().toISOString().slice(0, 10), -1), days })
    return { tree: empty, hiddenAdsets: 0, noPageRegistered: false }
  }
  const since = addDays(endDate, -(days - 1))

  const rawInsights = await pageAll<RawInsight>((from, to) =>
    supabase
      .from('ad_daily_insights')
      .select('level, entity_id, entity_name, parent_id, insight_date, spend, impressions, clicks, leads, messaging_conversations, actions, video_3s_views')
      .eq('client_id', clientId)
      .gte('insight_date', since)
      .lte('insight_date', endDate)
      .order('id', { ascending: true })
      .range(from, to),
  )
  const capturedSince = `${addDays(endDate, -SNAPSHOT_LOOKBACK_DAYS)}T00:00:00Z`
  const rawSnapshots = await pageAll<RawSnapshot>((from, to) =>
    supabase
      .from('ad_entity_snapshots')
      .select('level, entity_id, entity_name, campaign_id, adset_id, effective_status, daily_budget_minor, currency, captured_at, creative_page_id')
      .eq('client_id', clientId)
      .in('level', ['campaign', 'adset', 'ad'])
      .gte('captured_at', capturedSince)
      .order('id', { ascending: true })
      .range(from, to),
  )

  const clientPageId = await loadClientPageId(clientId, supabase)
  const insights = dedupeInsights(rawInsights.map(toInsightRow).filter((r): r is InsightRow => r !== null))
  const snapshots = rawSnapshots.map(toSnapshotRow).filter((r): r is SnapshotRow => r !== null)
  const scoped = scopeToClientPage(insights, snapshots, clientPageId)
  const tree = buildEntityTree(scoped.insights, scoped.snapshots, { endDate, days, sharedCampaignIds: scoped.sharedCampaignIds })
  return { tree, hiddenAdsets: scoped.droppedAdsets, noPageRegistered: scoped.noPageRegistered }
}
