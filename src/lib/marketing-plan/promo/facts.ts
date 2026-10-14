/**
 * 推广计划的事实读取（只读）：把数据库里的东西读成 gates / reconcile 要的形状。
 *
 * 规则：任何一项读失败都返回 null（= 没读到），绝不当成 0 / 空列表 / 通过。
 * 复用：广告设置 parseCreativePool、账户时区 accountDayKey、行业剧本选择。
 * 所有读取都带 client_id（目标 / 广告账户额外校验归属同一客户）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { accountDayKey } from '@/lib/ads-strategy/account-timezone'
import { parseCreativePool } from '@/lib/ads-strategy/config'
import type { AccountCapFacts } from './budget-caps'
import type { AccountSnapshotFact, GateFacts } from './gates'
import { resolvePromoPlaybook, type PromoPlaybook } from './playbooks'
import { addDays, reconcileWindow, type GoalFact, type ReconcileFacts } from './reconcile'
import { allAdsSteps, type ManualCheck, type PromoSpec } from './spec'

export interface LoadedPromoFacts {
  playbook: PromoPlaybook
  today: string
  timezone_known: boolean
  gate: GateFacts
  recon: ReconcileFacts
}

interface SnapshotRow {
  ad_account_id: string
  account_status: number | null
  currency: string | null
  timezone_name: string | null
  captured_at: string | null
}

async function loadIndustry(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('clients').select('industry').eq('id', clientId).maybeSingle()
  return (data as { industry?: string | null } | null)?.industry ?? null
}

/** 该客户名下的广告账户（含账户级日上限）。读失败 = null。 */
export async function loadOwnedAccounts(clientId: string): Promise<{ id: string; cap: number | null }[] | null> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id, daily_budget_cap_cents')
    .eq('client_id', clientId)
  if (error) return null
  return ((data ?? []) as { ad_account_id: string; daily_budget_cap_cents: number | null }[])
    .map(r => ({ id: r.ad_account_id, cap: r.daily_budget_cap_cents ?? null }))
}

/** 每个账户最新的账户级快照。某个账户读失败 = 该账户没有记录（调用方按灰处理）。 */
async function loadSnapshots(ids: string[]): Promise<Record<string, SnapshotRow>> {
  const out: Record<string, SnapshotRow> = {}
  await Promise.all(ids.map(async id => {
    const { data, error } = await supabaseAdmin
      .from('ad_entity_snapshots')
      .select('ad_account_id, account_status, currency, timezone_name, captured_at')
      .eq('ad_account_id', id)
      .eq('level', 'account')
      .order('captured_at', { ascending: false })
      .limit(1)
    const row = (data as SnapshotRow[] | null)?.[0]
    if (!error && row) out[id] = row
  }))
  return out
}

async function loadStrategyConfig(clientId: string): Promise<GateFacts['config']> {
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('daily_budget_cap_cents, primary_result, creative_pool')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) return null
  const row = data as { daily_budget_cap_cents?: number | null; primary_result?: string | null; creative_pool?: unknown } | null
  const cap = row?.daily_budget_cap_cents
  return {
    daily_budget_cap_cents: typeof cap === 'number' && cap > 0 ? cap : null,
    primary_result: row?.primary_result ?? null,
    creative_pool: parseCreativePool(row?.creative_pool).map(p => ({ ref: p.ref, status: p.status })),
  }
}

/** 每日计划从 today 起「连续」排了几天（遇到第一个空档就停）；一天都没排 = 0；读失败 = null。 */
async function loadDailyPlanCoverage(clientId: string, today: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('social_plans')
    .select('plan_data')
    .eq('client_id', clientId)
    .contains('plan_data', { plan_kind: 'campaign_daily_v1' })
  if (error) return null
  const plannedDays = new Set<string>()
  for (const row of (data ?? []) as { plan_data: { days?: { date: string; slots?: Record<string, string> }[] } }[]) {
    for (const d of row.plan_data?.days ?? []) {
      if (Object.values(d.slots ?? {}).some(v => v === 'PLANNED')) plannedDays.add(d.date)
    }
  }
  let run = 0
  while (plannedDays.has(addDays(today, run))) run++
  return run
}

/** 目标：必须属于同一客户，否则当作读不到。 */
export async function loadGoal(clientId: string, goalId: string): Promise<GoalFact | null> {
  const { data, error } = await supabaseAdmin
    .from('goals')
    .select('status, target_value, baseline_value, period_start, period_end, current_value, current_value_fetched_at')
    .eq('id', goalId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return null
  const g = data as Record<string, unknown>
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    status: String(g.status),
    target_value: num(g.target_value),
    baseline_value: num(g.baseline_value),
    period_start: String(g.period_start),
    period_end: String(g.period_end),
    current_value: num(g.current_value),
    current_value_fetched_at: (g.current_value_fetched_at as string | null) ?? null,
  }
}

interface InsightsRead {
  spend: Record<string, Record<string, number>> | null
  results: number | null
  as_of: string | null
}

async function loadInsights(clientId: string, accountIds: string[], win: { start: string; end: string }): Promise<InsightsRead> {
  if (accountIds.length === 0) return { spend: {}, results: 0, as_of: null }
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('ad_account_id, insight_date, spend, results, fetched_at')
    .eq('client_id', clientId)
    .eq('level', 'campaign') // 三层各有一行，只取一层，免得花费重复算
    .in('ad_account_id', accountIds)
    .gte('insight_date', win.start)
    .lte('insight_date', win.end)
  if (error) return { spend: null, results: null, as_of: null }
  // Meta 零花费日不返回行：整个窗口一行都没有，可能是真零也可能是取数断档，证明不了覆盖就按「看不清」
  if ((data ?? []).length === 0) return { spend: null, results: null, as_of: null }
  const spend: Record<string, Record<string, number>> = {}
  let results = 0
  let asOf: string | null = null
  for (const r of (data ?? []) as { ad_account_id: string; insight_date: string; spend: number | string | null; results: number | null; fetched_at: string | null }[]) {
    const cents = Math.round(Number(r.spend ?? 0) * 100)
    spend[r.ad_account_id] ??= {}
    spend[r.ad_account_id][r.insight_date] = (spend[r.ad_account_id][r.insight_date] ?? 0) + cents
    results += r.results ?? 0
    if (r.fetched_at && (asOf === null || r.fetched_at > asOf)) asOf = r.fetched_at
  }
  return { spend, results, as_of: asOf }
}

async function loadPublishedCount(clientId: string, win: { start: string; end: string }): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('content_posts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'published')
    .gte('published_at', `${win.start}T00:00:00Z`)
    .lt('published_at', `${addDays(win.end, 1)}T00:00:00Z`)
  return error ? null : (count ?? 0)
}

/** 「今天」：全部广告账户时区都已知 → 取其中最早的一个本地日期；任一未知 → UTC 日期并标 timezone_known=false。 */
export function resolveToday(timezones: (string | null)[], now: Date): { today: string; known: boolean } {
  if (timezones.length === 0) return { today: accountDayKey(null, now), known: true }
  if (timezones.some(t => t === null)) return { today: accountDayKey(null, now), known: false }
  const days = (timezones as string[]).map(tz => accountDayKey(tz, now)).sort()
  return { today: days[0], known: true }
}

export async function loadPromoFacts(
  clientId: string,
  spec: PromoSpec,
  manualChecks: readonly ManualCheck[],
  now: Date = new Date(),
): Promise<LoadedPromoFacts> {
  const playbook = resolvePromoPlaybook(await loadIndustry(clientId).catch(() => null))
  const planAccountIds = [...new Set(allAdsSteps(spec).map(s => s.step.settings.ad_account_id))]

  const owned = await loadOwnedAccounts(clientId)
  const snapshots = await loadSnapshots(planAccountIds)
  const { today, known } = resolveToday(planAccountIds.map(id => snapshots[id]?.timezone_name ?? null), now)
  const win = reconcileWindow(today, playbook.insightsUnstableDays)

  const [config, coverage, goal, insights, published] = await Promise.all([
    loadStrategyConfig(clientId),
    loadDailyPlanCoverage(clientId, today),
    loadGoal(clientId, spec.goal_id),
    loadInsights(clientId, planAccountIds, win),
    loadPublishedCount(clientId, win),
  ])

  const ownedSet = new Map((owned ?? []).map(a => [a.id, a]))
  const accounts: AccountCapFacts[] = planAccountIds.map(id => ({
    ad_account_id: id,
    currency: snapshots[id]?.currency ?? null,
    daily_cap_cents: ownedSet.get(id)?.cap ?? null,
    // 账户列表读失败（owned=null）时按"不属于"处理——宁可挡住也不放行
    owned_by_client: owned !== null && ownedSet.has(id),
  }))
  const snapFacts: Record<string, AccountSnapshotFact> = {}
  for (const id of planAccountIds) {
    const s = snapshots[id]
    if (s) snapFacts[id] = { account_status: s.account_status, captured_at: s.captured_at }
  }

  return {
    playbook, today, timezone_known: known,
    gate: {
      today, now, playbook, accounts, snapshots: snapFacts, config,
      daily_plan_coverage_days: coverage,
      manual_checks: [...manualChecks],
    },
    recon: {
      spend_cents_by_account_day: insights.spend,
      meta_results: insights.results,
      goal,
      content_published: published,
      insights_as_of: insights.as_of,
      timezone_known: known,
    },
  }
}
