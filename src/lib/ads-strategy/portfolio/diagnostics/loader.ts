/**
 * 诊断输入加载器（IO）。只读库；只在 D1 预筛命中时调 Meta **只读**接口拉按小时花费（不入库）。
 *
 * 🔴 共用账户（§14 M9）：快照里本来就只有账户级；日数据即使老同步写了两份，这里也不喂给实体级诊断
 *    （run.ts 对 shared 账户只跑 D1/D7，D1 用的是账户合计）。
 * 非共用账户额外加载广告层日数据（D2/D10）；广告层 `parent_id` 是**广告系列** id，不是广告组 id。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { fetchHourlyAdsetSpend, type GraphHourlySpendRow } from '@/lib/meta/entity-settings'
import { findSharedAdAccounts, getClientAdAccountIds } from '@/lib/meta/client-ad-accounts'
import { loadAdStrategyConfigWithSource, type AdStrategyConfig } from '@/lib/ads-strategy/config'
import type { EntitySnapshotRow } from '../snapshot'
import { loadOutcomeConfig } from '../outcome-config'
import { buildAccountContext, localDayEndUtc, shiftDate } from './context'
import { scopeAccountToClient } from './ownership'
import { d1NeedsHourly } from './d1-delivery-stall'
import type { AccountInput, AdPageSighting, AudienceCountPoint, CaptureCoverage, DailyRow, DiagnosisInput, HourlyRow, SettingChange } from './types'
import { D1_REPEAT_LOOKBACK_DAYS } from './thresholds'

const PAGE = 1000
const HISTORY_DAYS = 28

/**
 * 🔴 #1299（Meta 企业验证）通过、私信 Webhook 真正收到生产来源之前恒为 false（§14 M2）。
 * 改成 true 必须单独 PR 并附 Webhook 生产收信证据。
 */
export const MESSAGING_REFERRAL_AVAILABLE = false

/** "14:00:00 - 14:59:59" → 14 */
export function hourlyRowsFromGraph(rows: GraphHourlySpendRow[]): HourlyRow[] {
  return rows.map(r => ({
    adset_id: r.adset_id ?? null,
    campaign_id: r.campaign_id ?? null,
    hour: Number((r.hourly_stats_aggregated_by_advertiser_time_zone ?? '').slice(0, 2)),
    spend: Number(r.spend ?? 0),
  })).filter(r => Number.isInteger(r.hour))
}

/** 关键字段（不比 targeting_summary —— 它正是被加字段污染的那个）。 */
const KEY_FIELDS = [
  'status', 'daily_budget_minor', 'lifetime_budget_minor', 'bid_strategy', 'optimization_goal',
  'destination_type', 'included_audience_ids', 'excluded_audience_ids', 'creative_video_ids', 'creative_page_id',
  'audience_rule_object_ids', 'audience_rule_events', 'audience_retention_days',
] as const

function keyFieldsChanged(prev: EntitySnapshotRow, row: EntitySnapshotRow): boolean {
  return KEY_FIELDS.some(f => JSON.stringify(prev[f]) !== JSON.stringify(row[f]))
}

/** 窗口里找不到前一行时，只有 Meta 修改时间落在抓取时刻前 2 天内才认。 */
function changedWithoutPrev(row: EntitySnapshotRow): boolean {
  if (!row.source_updated_time) return false
  return Date.parse(row.captured_at) - Date.parse(row.source_updated_time) <= 2 * 86_400_000
}

function isRealChange(prev: EntitySnapshotRow | null, row: EntitySnapshotRow): boolean {
  if (!prev) return changedWithoutPrev(row)
  if (prev.source_updated_time && row.source_updated_time) {
    return prev.source_updated_time !== row.source_updated_time
  }
  return keyFieldsChanged(prev, row)
}

/**
 * 从近 35 天快照里抽「真改过」的设置变更（D2/D10 的学习期剔除用）。
 * 🔴 快照的 changed 不等于 Meta 那边真改了：我们自己加字段、两个写入程序序列化不一致都会记成 changed
 *    （2026-09-26 魏征生产核实：9/15 后约一半 changed 行 Meta 修改时间没动）。所以：
 *    - 前后两行都有 source_updated_time → 只认它变了（Meta 的修改时间是权威）；
 *    - 任一缺 → 退回比关键字段（状态、预算、出价、优化目标、去向、受众 id、素材视频、创意主页、受众收人规则与保留期），不比 targeting_summary（它正是被加字段污染的那个）；
 *    - 窗口里找不到前一行 → 只有 source_updated_time 落在抓取时刻前 2 天内才认。
 * 变更时刻优先用 source_updated_time，没有才用 captured_at。
 */
export function realSettingChanges(rows: readonly EntitySnapshotRow[]): SettingChange[] {
  const byEntity = new Map<string, EntitySnapshotRow[]>()
  for (const r of rows) {
    const key = `${r.level}:${r.entity_id}`
    const list = byEntity.get(key)
    if (list) list.push(r)
    else byEntity.set(key, [r])
  }

  const out: SettingChange[] = []
  for (const list of byEntity.values()) {
    list.sort((a, b) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0))
    for (let i = 0; i < list.length; i++) {
      const row = list[i]
      if (row.capture_reason !== 'changed' && row.capture_reason !== 'kernel_post') continue
      let prev: EntitySnapshotRow | null = null
      for (let j = i - 1; j >= 0; j--) {
        if (list[j].capture_reason !== 'disappeared') { prev = list[j]; break }
      }
      if (!isRealChange(prev, row)) continue
      out.push({ level: row.level, entity_id: row.entity_id, captured_at: row.source_updated_time ?? row.captured_at })
    }
  }
  return out
}

/** 截至某时刻，每个实体最新一行快照（去掉「消失」的实体）。 */
export function latestSnapshotsAsOf(rows: EntitySnapshotRow[], asOfMs: number): EntitySnapshotRow[] {
  const latest = new Map<string, EntitySnapshotRow>()
  for (const r of rows) {
    if (Date.parse(r.captured_at) > asOfMs) continue
    const key = `${r.level}:${r.entity_id}`
    const prev = latest.get(key)
    if (!prev || r.captured_at > prev.captured_at) latest.set(key, r)
  }
  return Array.from(latest.values()).filter(r => r.capture_reason !== 'disappeared')
}

/**
 * 窗口内出现过的广告，每条取最后一行非「消失」快照（含后来被归档/删除的）。
 * D11 算供血花费用：被归档的供血广告窗口内花过的钱也要算上（2026-09-27 魏征）。
 */
export function latestAdRowsEver(rows: readonly EntitySnapshotRow[]): EntitySnapshotRow[] {
  const latest = new Map<string, EntitySnapshotRow>()
  for (const r of rows) {
    if (r.level !== 'ad' || r.capture_reason === 'disappeared') continue
    const prev = latest.get(r.entity_id)
    if (!prev || r.captured_at > prev.captured_at) latest.set(r.entity_id, r)
  }
  return Array.from(latest.values())
}

/** 近 35 天每条广告挂过的每个创意主页（非「消失」行，按 广告×广告组×主页 去重）。 */
export function adPageSightings(rows: readonly EntitySnapshotRow[]): AdPageSighting[] {
  const seen = new Map<string, AdPageSighting>()
  for (const r of rows) {
    if (r.level !== 'ad' || r.capture_reason === 'disappeared') continue
    const key = `${r.entity_id}|${r.adset_id ?? ''}|${r.creative_page_id ?? ''}`
    if (!seen.has(key)) seen.set(key, { entity_id: r.entity_id, adset_id: r.adset_id, creative_page_id: r.creative_page_id })
  }
  return Array.from(seen.values())
}

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}

/** 广告层近 28 天日数据（D2/D10）。二级排序 + 按 (entity_id, insight_date) 去重：跨页顺序不唯一时既不重也不漏。 */
async function loadAdDaily(clientId: string, adAccountId: string, date: string): Promise<DailyRow[]> {
  const rows = await readAll<DailyRow>((a, b) => supabaseAdmin.from('ad_daily_insights')
    .select('level, entity_id, parent_id, insight_date, spend, impressions, reach, clicks, leads, messaging_conversations, video_thruplays, actions, frequency_7d')
    .eq('client_id', clientId).eq('ad_account_id', adAccountId).eq('level', 'ad')
    .gte('insight_date', shiftDate(date, -HISTORY_DAYS + 1)).lte('insight_date', date)
    .order('insight_date', { ascending: true }).order('entity_id', { ascending: true }).range(a, b))

  const byKey = new Map<string, DailyRow>()
  for (const r of rows) {
    byKey.set(`${r.entity_id}|${r.insight_date}`, {
      ...r,
      spend: Number(r.spend),
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      frequency_7d: r.frequency_7d === null || r.frequency_7d === undefined ? null : Number(r.frequency_7d),
    })
  }
  return Array.from(byKey.values())
}

async function loadAccount(clientId: string, adAccountId: string, shared: boolean, hiddenFromAdHealth: boolean, date: string, clientPageId: string | null, evaluatedAt: string): Promise<AccountInput> {
  const tzRow = await supabaseAdmin.from('ad_entity_snapshots').select('timezone_name, currency')
    .eq('client_id', clientId).eq('ad_account_id', adAccountId).eq('level', 'account')
    .order('captured_at', { ascending: false }).limit(1).maybeSingle()
  const timezone = (tzRow.data as { timezone_name: string | null } | null)?.timezone_name ?? null
  const currency = (tzRow.data as { currency: string | null } | null)?.currency ?? null
  const endMs = localDayEndUtc(date, timezone)

  // 🔴 单键排序（只按 captured_at）分页会漏数据：一轮抓取写入的所有实体共享同一个 captured_at，
  //    超过一页（1000 行）时同一时间戳内谁在前谁在后没保证，翻页边界可能落在同一时间戳里，导致
  //    range 查询重复或漏掉行——`adPageHistory` 直接决定归属，漏一条别家历史就会把 mixed_pages 判成 own
  //    （Codex 2026-09-27）。加 level/entity_id 兜底排序，形成稳定顺序。
  const snapshots = await readAll<EntitySnapshotRow>((a, b) => supabaseAdmin.from('ad_entity_snapshots').select('*')
    .eq('client_id', clientId).eq('ad_account_id', adAccountId)
    .gte('captured_at', new Date(endMs - 35 * 86_400_000).toISOString()).lte('captured_at', new Date(endMs).toISOString())
    .order('captured_at', { ascending: false }).order('level', { ascending: true }).order('entity_id', { ascending: true }).range(a, b))

  const daily = await readAll<DailyRow>((a, b) => supabaseAdmin.from('ad_daily_insights')
    .select('level, entity_id, parent_id, insight_date, spend, impressions, reach, clicks, leads, messaging_conversations, video_thruplays, actions, frequency_7d')
    .eq('client_id', clientId).eq('ad_account_id', adAccountId).in('level', ['campaign', 'adset'])
    .gte('insight_date', shiftDate(date, -HISTORY_DAYS + 1)).lte('insight_date', date)
    .order('insight_date', { ascending: true }).range(a, b))

  const [lastRow, captures] = await Promise.all([
    supabaseAdmin.from('ad_daily_insights').select('insight_date').eq('client_id', clientId).eq('ad_account_id', adAccountId)
      .order('insight_date', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('ad_snapshot_captures').select('level, complete, skipped_shared, error, captured_at')
      .eq('client_id', clientId).eq('ad_account_id', adAccountId).order('captured_at', { ascending: false }).limit(5),
  ])

  const settingChanges = realSettingChanges(snapshots)
  const audienceHistory: AudienceCountPoint[] = snapshots
    .filter(r => r.level === 'audience' && r.capture_reason !== 'disappeared')
    .map(r => ({ entity_id: r.entity_id, captured_at: r.captured_at, audience_count_lower: r.audience_count_lower }))

  const account: AccountInput = {
    adAccountId, shared, hiddenFromAdHealth, timezone, currency,
    snapshots: latestSnapshotsAsOf(snapshots, endMs),
    daily: daily.map(r => ({
      ...r,
      spend: Number(r.spend),
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      frequency_7d: r.frequency_7d === null || r.frequency_7d === undefined ? null : Number(r.frequency_7d),
    })),
    hourly: {},
    hourlyError: null,
    latestCaptures: (captures.data ?? []) as CaptureCoverage[],
    lastInsightDate: (lastRow.data as { insight_date: string } | null)?.insight_date ?? null,
    adDaily: shared ? undefined : await loadAdDaily(clientId, adAccountId, date),
    settingChanges,
    audienceHistory,
    recentAds: latestAdRowsEver(snapshots),
    adPageHistory: adPageSightings(snapshots),
  }

  // 预筛跟 D1 用同一口径（只看客户自己的广告组）：别人的花费掩盖客户掉量时也要拉小时数据
  if (d1NeedsHourly(buildAccountContext(scopeAccountToClient(account, clientPageId, date, evaluatedAt).account, date))) {
    const token = await getMetaTokenForClient(clientId)
    if (!token) {
      account.hourlyError = 'no Meta token'
    } else {
      for (let i = 0; i <= D1_REPEAT_LOOKBACK_DAYS; i++) {
        const day = shiftDate(date, -i)
        const res = await fetchHourlyAdsetSpend(adAccountId, token, day)
        if (!res.complete) { account.hourlyError = res.error?.message ?? 'hourly read incomplete'; break }
        account.hourly[day] = hourlyRowsFromGraph(res.rows)
      }
    }
  }
  return account
}

/** 客户登记的 Facebook 主页。读失败要抛（跟本文件其它读一样）——不能塌成「没登记」，那会报一条假的配置缺口。 */
async function loadClientPageId(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('clients').select('facebook_page_id').eq('id', clientId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { facebook_page_id: string | null } | null)?.facebook_page_id ?? null
}

/**
 * 客户的广告设置。读失败要抛（同上）——塌成默认值会让收件人检查拿着空列表跑，
 * 该报的「收件人混了外部邮箱」就静默漏掉了；「没有行」是新客户，照默认值走。
 */
async function loadStrategyConfig(clientId: string): Promise<AdStrategyConfig> {
  const { config, source, error } = await loadAdStrategyConfigWithSource(clientId)
  if (source === 'fallback') throw new Error(`ad_strategy_configs read failed: ${error ?? 'unknown error'}`)
  return config
}

/**
 * 后台标了「不在广告健康页显示」的账户（`client_meta_ad_accounts.hidden_from_ad_health`，PR 3012）。
 * 🔴 读失败**不能**当成「全都隐藏」——那会把真问题藏起来；失败就当没隐藏（fail visible），只打日志。
 * 账户号按本文件其它地方的口径去掉 `act_` 前缀再比。
 */
async function loadHiddenAdAccounts(clientId: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabaseAdmin.from('client_meta_ad_accounts')
      .select('ad_account_id, hidden_from_ad_health').eq('client_id', clientId)
    if (error) {
      console.warn(`[ads-diagnostics] client_meta_ad_accounts read failed, treating no account as hidden: ${error.message}`)
      return new Set()
    }
    const hidden = new Set<string>()
    for (const row of (data ?? []) as Array<{ ad_account_id: string | null; hidden_from_ad_health: boolean | null }>) {
      if (!row.hidden_from_ad_health || !row.ad_account_id) continue
      hidden.add(row.ad_account_id.replace(/^act_/, ''))
    }
    return hidden
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[ads-diagnostics] client_meta_ad_accounts read failed, treating no account as hidden: ${message}`)
    return new Set()
  }
}

/**
 * `known.digestRecipients`：调用方刚读过广告设置时把收件人传进来，这里就不再读第二遍——
 * 每日回拉已经读成功，诊断不该因为几秒后多余的一次重读失败而整天停跑、连带不发自动暂停事件（卫青复审）。
 * 没传才自己读，读失败照旧抛。
 */
export async function loadDiagnosisInput(
  clientId: string,
  date: string,
  evaluatedAt: string,
  known?: { digestRecipients: string[] },
): Promise<DiagnosisInput> {
  const accountIds = await getClientAdAccountIds(clientId)
  const { shared } = await findSharedAdAccounts(clientId, accountIds)
  const hidden = await loadHiddenAdAccounts(clientId)
  const clientPageId = await loadClientPageId(clientId)
  const accounts: AccountInput[] = []
  for (const id of accountIds) {
    const key = id.replace(/^act_/, '')
    accounts.push(await loadAccount(clientId, id, shared.has(key), hidden.has(key), date, clientPageId, evaluatedAt))
  }
  const [outcome, digestRecipients] = await Promise.all([
    loadOutcomeConfig(clientId),
    known ? known.digestRecipients : loadStrategyConfig(clientId).then(c => c.digest_recipients),
  ])
  return {
    clientId, date, evaluatedAt,
    outcome: outcome.config,
    outcomeConfigured: outcome.source === 'row' && outcome.config.primary !== null,
    messagingReferralAvailable: MESSAGING_REFERRAL_AVAILABLE,
    digestRecipients,
    clientPageId,
    accounts,
  }
}
