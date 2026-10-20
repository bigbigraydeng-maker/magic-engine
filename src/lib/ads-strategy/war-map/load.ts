/**
 * 广告作战地图 S1 · 读数据（只读，不建表、不加定时任务）。
 *
 * 把库里「已经每天算好」的几张表读成 `WarMapInput`，交给纯函数 `buildWarMap`。
 * 设计稿：docs/specs/2026-10-16-ads-war-map-page-design-v0.1.md §3。
 *
 * 🔴 读失败就抛错，由路由回「读不到」；不许把失败吞成空数组 —— 空数组会被页面
 *    渲染成「没有池子 / 没有广告」，跟「真的没有」长得一模一样。
 * 🔴 「没有这一行」是另一回事：经营视图今天还没跑 = growth: null；没有推广计划 = plan: null。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { loadAdStrategyConfigWithSource } from '@/lib/ads-strategy/config'
import { loadAccountStatusRows, latestPerAccount } from '@/lib/ads-strategy/account-status'
import { readPromoSpec } from '@/lib/marketing-plan/promo/spec'
import { unusableAccountNote } from './pools'
import { nzDay } from './util'
import { computeRunningSince, type SnapRowLite } from './running-since'
import type {
  AccountInput,
  AdsetInput,
  AudienceHistoryPoint,
  AudienceInput,
  CampaignFrequencyInput,
  GrowthInput,
  PlanInput,
  WarMapInput,
} from './types'

const DAY_MS = 86_400_000
/** 池子人数往回看几天（趋势要 7 天，多留一天防边界） */
const AUDIENCE_LOOKBACK_DAYS = 9

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

// ── 账户状态 ────────────────────────────────────────────────────────────────
/** 「读全了却没返回它」的实体会被写一行 disappeared：最新一行是它，就整个实体不要，不能当成「读不到」。 */
const DISAPPEARED = 'disappeared'

async function loadAccounts(clientId: string, now: Date): Promise<AccountInput[]> {
  const rows = await loadAccountStatusRows(clientId, isoDaysAgo(now, 14))
  const out: AccountInput[] = []
  for (const r of latestPerAccount(rows)) {
    if (r.capture_reason === DISAPPEARED) continue
    out.push({
      adAccountId: r.ad_account_id,
      name: r.entity_name,
      statusCode: r.account_status,
      capturedAt: r.captured_at,
      timezoneName: r.timezone_name,
    })
  }
  return out
}

// ── 观众池：最新人数 + 近 9 天历史（同一次查询）──────────────────────────────
interface AudienceRow {
  entity_id: string
  entity_name: string | null
  ad_account_id: string
  audience_count_lower: number | null
  audience_subtype: string | null
  audience_rule_events: string[] | null
  capture_reason: string | null
  captured_at: string
}

async function loadAudiences(
  clientId: string,
  now: Date,
): Promise<{ audiences: AudienceInput[]; history: AudienceHistoryPoint[] }> {
  const rows = await fetchAll<AudienceRow>((from, to) =>
    supabaseAdmin
      .from('ad_entity_snapshots')
      .select('entity_id, entity_name, ad_account_id, audience_count_lower, audience_subtype, audience_rule_events, capture_reason, captured_at')
      .eq('client_id', clientId)
      .eq('level', 'audience')
      .gte('captured_at', isoDaysAgo(now, AUDIENCE_LOOKBACK_DAYS))
      // 排序要唯一，否则翻页会重复或漏行
      .order('captured_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )
  const seen = new Set<string>()
  const audiences: AudienceInput[] = []
  const history: AudienceHistoryPoint[] = []
  for (const r of rows) {
    if (r.capture_reason !== DISAPPEARED) {
      history.push({ audienceId: r.entity_id, capturedAt: r.captured_at, countLower: r.audience_count_lower })
    }
    if (seen.has(r.entity_id)) continue
    seen.add(r.entity_id)
    if (r.capture_reason === DISAPPEARED) continue // 已被删掉的池子不显示
    audiences.push({
      id: r.entity_id,
      name: r.entity_name,
      adAccountId: r.ad_account_id,
      countLower: r.audience_count_lower,
      capturedAt: r.captured_at,
      subtype: r.audience_subtype,
      ruleEvents: r.audience_rule_events ?? [],
    })
  }
  return { audiences, history }
}

// ── 广告组：谁在用哪个池子 ───────────────────────────────────────────────────
interface AdsetRow {
  entity_id: string
  effective_status: string | null
  included_audience_ids: string[] | null
  capture_reason: string | null
}

async function loadAdsets(clientId: string, now: Date): Promise<AdsetInput[]> {
  const rows = await fetchAll<AdsetRow>((from, to) =>
    supabaseAdmin
      .from('ad_entity_snapshots')
      .select('entity_id, effective_status, included_audience_ids, capture_reason')
      .eq('client_id', clientId)
      .eq('level', 'adset')
      .gte('captured_at', isoDaysAgo(now, 2))
      .order('captured_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )
  const seen = new Map<string, AdsetInput>()
  for (const r of rows) {
    if (seen.has(r.entity_id)) continue
    if (r.capture_reason === DISAPPEARED) {
      seen.set(r.entity_id, { id: r.entity_id, effectiveStatus: 'NOT_RETURNED', includedAudienceIds: [] })
      continue
    }
    seen.set(r.entity_id, {
      id: r.entity_id,
      effectiveStatus: r.effective_status,
      includedAudienceIds: r.included_audience_ids ?? [],
    })
  }
  return Array.from(seen.values())
}

// ── 数据日 / 取数时间（两个时钟）+ 近 7 天频率 ────────────────────────────────
async function loadClocks(
  clientId: string,
  accountIds: string[] | null,
): Promise<{ dataDay: string | null; fetchedAt: string | null }> {
  if (accountIds !== null && accountIds.length === 0) return { dataDay: null, fetchedAt: null }
  const dayQuery = supabaseAdmin
    .from('ad_daily_insights')
    .select('insight_date')
    .eq('client_id', clientId)
  const fetchedQuery = supabaseAdmin
    .from('ad_daily_insights')
    .select('fetched_at')
    .eq('client_id', clientId)
  const [dayRes, fetchedRes] = await Promise.all([
    (accountIds === null ? dayQuery : dayQuery.in('ad_account_id', accountIds))
      .order('insight_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    (accountIds === null ? fetchedQuery : fetchedQuery.in('ad_account_id', accountIds))
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (dayRes.error) throw new Error(`读数据日失败：${dayRes.error.message}`)
  if (fetchedRes.error) throw new Error(`读取数时间失败：${fetchedRes.error.message}`)
  return {
    dataDay: str((dayRes.data as { insight_date?: unknown } | null)?.insight_date),
    fetchedAt: str((fetchedRes.data as { fetched_at?: unknown } | null)?.fetched_at),
  }
}

interface InsightRow {
  entity_id: string
  entity_name: string | null
  ad_account_id: string
  insight_date: string
  spend: number | string | null
  frequency_7d: number | string | null
}

async function loadCampaigns(clientId: string, dataDay: string | null): Promise<CampaignFrequencyInput[]> {
  if (!dataDay) return []
  const rows = await fetchAll<InsightRow>((from, to) =>
    supabaseAdmin
      .from('ad_daily_insights')
      .select('entity_id, entity_name, ad_account_id, insight_date, spend, frequency_7d')
      .eq('client_id', clientId)
      .eq('level', 'campaign')
      .gte('insight_date', shiftDay(dataDay, -6))
      .lte('insight_date', dataDay)
      .order('insight_date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )
  const byCampaign = new Map<string, CampaignFrequencyInput>()
  for (const r of rows) {
    const cur = byCampaign.get(r.entity_id) ?? {
      campaignId: r.entity_id,
      campaignName: r.entity_name,
      adAccountId: r.ad_account_id,
      spend7d: 0,
      frequency7d: null,
    }
    cur.spend7d += num(r.spend) ?? 0
    // 已按日期倒序：第一个非空的 7 天频率就是最近的
    if (cur.frequency7d === null) cur.frequency7d = num(r.frequency_7d)
    byCampaign.set(r.entity_id, cur)
  }
  return Array.from(byCampaign.values())
}

// ── 经营视图（卫青每天写的那一行）────────────────────────────────────────────
function readGrowthProblems(raw: unknown): GrowthInput['problems'] {
  if (!Array.isArray(raw)) return []
  const out: GrowthInput['problems'] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const o = p as { code?: unknown; title?: unknown; manualTask?: { how?: unknown } | null }
    const code = str(o.code)
    const title = str(o.title)
    if (!code || !title) continue
    out.push({ code, title, how: str(o.manualTask?.how) })
  }
  return out
}

function readGrowthOpportunities(raw: unknown): GrowthInput['opportunities'] {
  if (!Array.isArray(raw)) return []
  const out: GrowthInput['opportunities'] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const o = p as { code?: unknown; title?: unknown }
    const code = str(o.code)
    const title = str(o.title)
    if (code && title) out.push({ code, title })
  }
  return out
}

async function loadGrowth(clientId: string): Promise<GrowthInput | null> {
  const { data, error } = await supabaseAdmin
    .from('ads_growth_states')
    .select('date, payload')
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`读经营视图失败：${error.message}`)
  if (!data) return null // 今天还没巡察，不是读不到
  const row = data as { date: string; payload: Record<string, unknown> | null }
  const payload = row.payload ?? {}
  const goal = (payload.goal ?? null) as { title?: unknown; pace?: { reason?: unknown } | null } | null
  return {
    date: row.date,
    goalTitle: str(goal?.title),
    paceReason: str(goal?.pace?.reason),
    problems: readGrowthProblems(payload.problems),
    opportunities: readGrowthOpportunities(payload.opportunities),
  }
}

// ── 推广计划：阶段日期（倒计时用）+ 它挂的目标标题（判断目标进度对不对得上）──────
async function loadGoalTitle(clientId: string, goalId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('goals')
    .select('title')
    .eq('id', goalId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`读计划目标失败：${error.message}`)
  return str((data as { title?: unknown } | null)?.title)
}

async function loadPlan(clientId: string): Promise<PlanInput | null> {
  const { data, error } = await supabaseAdmin
    .from('marketing_plans')
    .select('plan_data, status, updated_at')
    .eq('client_id', clientId)
    .in('status', ['draft', 'approved'])
    .order('updated_at', { ascending: false })
    .limit(10)
  if (error) throw new Error(`读推广计划失败：${error.message}`)
  for (const row of (data ?? []) as Array<{ plan_data: unknown; status: string; updated_at: string | null }>) {
    const spec = readPromoSpec(row.plan_data)
    if (!spec) continue
    return {
      status: row.status === 'approved' ? 'approved' : 'draft',
      phases: spec.phases.map(p => ({ name: p.name, startDate: p.start_date, endDate: p.end_date })),
      goalTitle: await loadGoalTitle(clientId, spec.goal_id),
      recordUpdatedDay: row.updated_at ? nzDay(row.updated_at) : null,
    }
  }
  return null
}

// ── 素材池：已批准几条 ──────────────────────────────────────────────────────
async function loadApprovedCreatives(clientId: string): Promise<number | null> {
  const loaded = await loadAdStrategyConfigWithSource(clientId)
  // 读失败时 config 是一份空池子的默认值，不能当成「0 条」
  if (loaded.source === 'fallback') return null
  return loaded.config.creative_pool.filter(e => e.status === 'approved').length
}

// ── 每个账户自己的数据日（账户小结用）────────────────────────────────────────
async function loadAccountDataDays(clientId: string, accounts: AccountInput[]): Promise<Record<string, string | null>> {
  const entries = await Promise.all(accounts.map(async a => {
    const { data, error } = await supabaseAdmin
      .from('ad_daily_insights')
      .select('insight_date')
      .eq('client_id', clientId)
      .eq('ad_account_id', a.adAccountId)
      .order('insight_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`读账户数据日失败：${error.message}`)
    return [a.adAccountId, str((data as { insight_date?: unknown } | null)?.insight_date)] as const
  }))
  return Object.fromEntries(entries)
}

// ── 实际已经在跑的最早日子（判断计划记录是不是过时了）────────────────────────
interface SnapLiteRow {
  entity_id: string
  campaign_id: string | null
  effective_status: string | null
  capture_reason: string | null
  captured_at: string
}

async function loadSnapRows(clientId: string, level: 'adset' | 'campaign', ids: string[], now: Date): Promise<SnapRowLite[]> {
  const rows = await fetchAll<SnapLiteRow>((from, to) =>
    supabaseAdmin
      .from('ad_entity_snapshots')
      .select('entity_id, campaign_id, effective_status, capture_reason, captured_at')
      .eq('client_id', clientId)
      .eq('level', level)
      .in('ad_account_id', ids)
      .gte('captured_at', isoDaysAgo(now, 30))
      .order('captured_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )
  return rows.map(r => ({
    entityId: r.entity_id,
    campaignId: level === 'campaign' ? r.entity_id : r.campaign_id,
    effectiveStatus: r.effective_status,
    captureReason: r.capture_reason,
    capturedAt: r.captured_at,
  }))
}

async function loadRunningSince(clientId: string, now: Date, accounts: AccountInput[]): Promise<string | null> {
  const ids = accounts.filter(a => unusableAccountNote(a.statusCode) === null).map(a => a.adAccountId)
  if (ids.length === 0) return null
  const [adsets, campaigns] = await Promise.all([
    loadSnapRows(clientId, 'adset', ids, now),
    loadSnapRows(clientId, 'campaign', ids, now),
  ])
  return computeRunningSince(adsets, campaigns)
}

export async function loadWarMapInput(clientId: string, now: Date = new Date()): Promise<WarMapInput> {
  const accounts = await loadAccounts(clientId, now)
  const usableIds = accounts.filter(a => unusableAccountNote(a.statusCode) === null).map(a => a.adAccountId)
  const [aud, adsets, clocks, growth, plan, creativePoolApproved, accountDataDays, runningSince] = await Promise.all([
    loadAudiences(clientId, now),
    loadAdsets(clientId, now),
    loadClocks(clientId, accounts.length === 0 ? null : usableIds),
    loadGrowth(clientId),
    loadPlan(clientId),
    loadApprovedCreatives(clientId),
    loadAccountDataDays(clientId, accounts),
    loadRunningSince(clientId, now, accounts),
  ])
  const campaigns = await loadCampaigns(clientId, clocks.dataDay)
  return {
    now: now.toISOString(),
    accounts,
    audiences: aud.audiences,
    audienceHistory: aud.history,
    adsets,
    campaigns,
    clocks,
    growth,
    plan,
    runningSince,
    accountDataDays,
    creativePoolApproved,
  }
}
