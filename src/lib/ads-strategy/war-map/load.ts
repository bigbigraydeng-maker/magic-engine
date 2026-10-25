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
import { canonicalAccountDigits } from '@/lib/meta/ad-account-binding'
import { loadAccountStatusRows, latestPerAccount } from '@/lib/ads-strategy/account-status'
import { loadLatestGoalPrescription } from '@/lib/marketing-plan/promo/goal-prescription'
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

interface BoundAccount { adAccountId: string; label: string | null }

/**
 * 账户清单以「绑定表」为准（读不到就抛错）；绑定表一行都没有时退回客户表上的旧单值列，和其它读取方一致。
 * hidden_from_ad_health = true 的账户只在广告健康页隐藏（PM 要求），不影响投放/预算/内核。
 * 注意：绑定表有行但全被隐藏时返回 []，不退回旧单值列 —— 那是「没绑定」才走的兜底。
 */
async function loadBoundAccounts(clientId: string): Promise<BoundAccount[]> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id, label, hidden_from_ad_health')
    .eq('client_id', clientId)
  if (error) throw new Error(`读绑定广告账户失败：${error.message}`)
  const rows = (data ?? []) as Array<{ ad_account_id: string; label: string | null; hidden_from_ad_health: boolean | null }>
  if (rows.length > 0) {
    return rows
      .filter(r => r.hidden_from_ad_health !== true)
      .map(r => ({ adAccountId: toActId(r.ad_account_id), label: r.label }))
  }
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients').select('meta_ad_account_id').eq('id', clientId).maybeSingle()
  if (clientErr) throw new Error(`读客户主广告账户失败：${clientErr.message}`)
  const legacy = str((client as { meta_ad_account_id?: unknown } | null)?.meta_ad_account_id)
  return legacy ? [{ adAccountId: toActId(legacy), label: null }] : []
}

/** 快照里存的是 act_ 形式；绑定表可能不带前缀，统一成 act_ 再比。 */
function toActId(raw: string): string {
  return `act_${canonicalAccountDigits(raw)}`
}

async function loadAccounts(clientId: string, now: Date): Promise<AccountInput[]> {
  const [bound, rows] = await Promise.all([
    loadBoundAccounts(clientId),
    loadAccountStatusRows(clientId, isoDaysAgo(now, 14)),
  ])
  const snap = new Map<string, (typeof rows)[number]>()
  for (const r of latestPerAccount(rows)) {
    if (r.capture_reason !== DISAPPEARED) snap.set(toActId(r.ad_account_id), r)
  }
  return bound.map(b => {
    const r = snap.get(b.adAccountId)
    // 绑了但没有快照：照样列出来（名字用标签），状态和读取时间都是 null，页面写「已绑定，暂无数据」
    return {
      adAccountId: r?.ad_account_id ?? b.adAccountId,
      name: r?.entity_name ?? b.label,
      statusCode: r?.account_status ?? null,
      capturedAt: r?.captured_at ?? null,
      timezoneName: r?.timezone_name ?? null,
    }
  })
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
    const [goalTitle, prescription] = await Promise.all([
      loadGoalTitle(clientId, spec.goal_id),
      loadLatestGoalPrescription(clientId, spec.goal_id),
    ])
    return {
      status: row.status === 'approved' ? 'approved' : 'draft',
      phases: spec.phases.map(p => ({ name: p.name, startDate: p.start_date, endDate: p.end_date })),
      goalTitle,
      recordUpdatedDay: row.updated_at ? nzDay(row.updated_at) : null,
      prescriptionLine: prescription?.line ?? null,
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
  // 账户清单是「哪些账户算数」的唯一来源：被隐藏的账户，它的池子/池子历史/系列频率也不能漏进来。
  // accounts 为空（没绑定）时不过滤，保持原行为。
  const visible = accounts.length > 0 ? new Set(accounts.map(a => toActId(a.adAccountId))) : null
  const audiences = visible ? aud.audiences.filter(a => visible.has(toActId(a.adAccountId))) : aud.audiences
  const audienceIds = visible ? new Set(audiences.map(a => a.id)) : null
  const audienceHistory = audienceIds ? aud.history.filter(h => audienceIds.has(h.audienceId)) : aud.history
  const visibleCampaigns = visible ? campaigns.filter(c => visible.has(toActId(c.adAccountId))) : campaigns
  return {
    now: now.toISOString(),
    accounts,
    audiences,
    audienceHistory,
    adsets,
    campaigns: visibleCampaigns,
    clocks,
    growth,
    plan,
    runningSince,
    accountDataDays,
    creativePoolApproved,
  }
}
