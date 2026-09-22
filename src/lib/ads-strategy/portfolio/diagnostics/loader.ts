/**
 * 诊断输入加载器（IO）。只读库；只在 D1 预筛命中时调 Meta **只读**接口拉按小时花费（不入库）。
 *
 * 🔴 共用账户（§14 M9）：快照里本来就只有账户级；日数据即使老同步写了两份，这里也不喂给实体级诊断
 *    （run.ts 对 shared 账户只跑 D1/D7，D1 用的是账户合计）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { fetchHourlyAdsetSpend, type GraphHourlySpendRow } from '@/lib/meta/entity-settings'
import { findSharedAdAccounts, getClientAdAccountIds } from '@/lib/meta/client-ad-accounts'
import { loadAdStrategyConfig } from '@/lib/ads-strategy/config'
import type { EntitySnapshotRow } from '../snapshot'
import { loadOutcomeConfig } from '../outcome-config'
import { buildAccountContext, localDayEndUtc, shiftDate } from './context'
import { d1NeedsHourly } from './d1-delivery-stall'
import type { AccountInput, CaptureCoverage, DailyRow, DiagnosisInput, HourlyRow } from './types'
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

async function loadAccount(clientId: string, adAccountId: string, shared: boolean, date: string): Promise<AccountInput> {
  const tzRow = await supabaseAdmin.from('ad_entity_snapshots').select('timezone_name, currency')
    .eq('client_id', clientId).eq('ad_account_id', adAccountId).eq('level', 'account')
    .order('captured_at', { ascending: false }).limit(1).maybeSingle()
  const timezone = (tzRow.data as { timezone_name: string | null } | null)?.timezone_name ?? null
  const currency = (tzRow.data as { currency: string | null } | null)?.currency ?? null
  const endMs = localDayEndUtc(date, timezone)

  const snapshots = await readAll<EntitySnapshotRow>((a, b) => supabaseAdmin.from('ad_entity_snapshots').select('*')
    .eq('client_id', clientId).eq('ad_account_id', adAccountId)
    .gte('captured_at', new Date(endMs - 35 * 86_400_000).toISOString()).lte('captured_at', new Date(endMs).toISOString())
    .order('captured_at', { ascending: false }).range(a, b))

  const daily = await readAll<DailyRow>((a, b) => supabaseAdmin.from('ad_daily_insights')
    .select('level, entity_id, parent_id, insight_date, spend, impressions, reach, clicks, leads, messaging_conversations, video_thruplays, actions')
    .eq('client_id', clientId).eq('ad_account_id', adAccountId).in('level', ['campaign', 'adset'])
    .gte('insight_date', shiftDate(date, -HISTORY_DAYS + 1)).lte('insight_date', date)
    .order('insight_date', { ascending: true }).range(a, b))

  const [lastRow, captures] = await Promise.all([
    supabaseAdmin.from('ad_daily_insights').select('insight_date').eq('client_id', clientId).eq('ad_account_id', adAccountId)
      .order('insight_date', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('ad_snapshot_captures').select('level, complete, skipped_shared, error, captured_at')
      .eq('client_id', clientId).eq('ad_account_id', adAccountId).order('captured_at', { ascending: false }).limit(5),
  ])

  const account: AccountInput = {
    adAccountId, shared, timezone, currency,
    snapshots: latestSnapshotsAsOf(snapshots, endMs),
    daily: daily.map(r => ({ ...r, spend: Number(r.spend), impressions: Number(r.impressions), clicks: Number(r.clicks) })),
    hourly: {},
    hourlyError: null,
    latestCaptures: (captures.data ?? []) as CaptureCoverage[],
    lastInsightDate: (lastRow.data as { insight_date: string } | null)?.insight_date ?? null,
  }

  if (d1NeedsHourly(buildAccountContext(account, date))) {
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

export async function loadDiagnosisInput(clientId: string, date: string, evaluatedAt: string): Promise<DiagnosisInput> {
  const accountIds = await getClientAdAccountIds(clientId)
  const { shared } = await findSharedAdAccounts(clientId, accountIds)
  const accounts: AccountInput[] = []
  for (const id of accountIds) {
    accounts.push(await loadAccount(clientId, id, shared.has(id.replace(/^act_/, '')), date))
  }
  const [outcome, strategy] = await Promise.all([loadOutcomeConfig(clientId), loadAdStrategyConfig(clientId)])
  return {
    clientId, date, evaluatedAt,
    outcome: outcome.config,
    outcomeConfigured: outcome.source === 'row' && outcome.config.primary !== null,
    messagingReferralAvailable: MESSAGING_REFERRAL_AVAILABLE,
    digestRecipients: strategy.digest_recipients,
    accounts,
  }
}
