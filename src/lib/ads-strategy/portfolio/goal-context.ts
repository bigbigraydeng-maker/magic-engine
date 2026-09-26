/**
 * 日报"目标进度"段的取数（spec 2026-09-24 §3 G1/G2/G10）。尽力而为，任何一步拿不到 → null（日报写"没有生效中的目标"或"未判"），绝不抛、绝不把缺数当 0。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { listActiveGoals } from '@/lib/strategy/goals'
import { autoFetchMetricValue } from '@/lib/strategy/auto-fetch'
import { loadAdStrategyConfig } from '../config'
import { computeGoalPace } from '../goal-pace'
import type { DigestGoalContext } from './internal-digest'
import type { GoalRow } from '@/types/strategy'

const DAY_MS = 86_400_000
export const MEDIAN_WINDOW_DAYS = 7
export const MIN_MEDIAN_DAYS = 3

/**
 * Goal metrics that autoFetchMetricValue can fill from ad_daily_insights via the
 * outcome ladder (leads_count falls back to the ads 'lead' step; messaging_started
 * is the ads 'messaging_started' step). Keep in sync with the switch in
 * src/lib/strategy/auto-fetch.ts. signups_count is NOT here: it reads real
 * bookings from me_sale_outcomes, which ads cannot move day to day.
 */
export const ADS_ATTRIBUTABLE_METRIC_KEYS: ReadonlySet<string> = new Set(['leads_count', 'messaging_started'])

/**
 * With several active goals, prefer the newest one the ads can measure; if none
 * qualifies, fall back to the newest. `goals` must be ordered newest first
 * (listActiveGoals does that).
 */
export function pickDigestGoal(goals: readonly GoalRow[]): GoalRow | null {
  return goals.find(g => ADS_ATTRIBUTABLE_METRIC_KEYS.has(g.primary_metric_key)) ?? goals[0] ?? null
}

/**
 * 「这次要动钱的动作挂哪个目标」—— **fail closed** 版本（WP3.1b）。
 *
 * 跟 `listActiveGoals` 的区别就一条，但是关键的一条：`listActiveGoals` 读失败时
 * `console.error` 之后返回 `[]`，也就是把「查不到」和「没有目标」压成同一个答案。
 * 日报里这么做没关系（写一句「没有生效中的目标」），但**会动客户钱**的路径上不行：
 * 一次数据库抖动会被读成「这个客户没有目标」，进而被读成某个确定的结论。
 *
 * 所以这里三种情况分开回答：
 *   · `{ goal }`            —— 找到了该挂的目标
 *   · `{ none: true }`      —— 确实没有生效中的目标（spec §6 第 5 条：不出动作）
 *   · `{ unreadable: msg }` —— 读不出来，调用方必须当成「不知道」，不许当成「没有」
 */
export async function resolveAdsGoalOrFail(
  supabase: SupabaseClient,
  clientId: string,
): Promise<
  | { readonly goal: GoalRow }
  | { readonly none: true }
  | { readonly unreadable: string }
> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) return { unreadable: error.message }
  const goal = pickDigestGoal((data ?? []) as GoalRow[])
  return goal ? { goal } : { none: true }
}

interface AdDailyInsightRow {
  insight_date: string
  spend: number | null
  results: number | null
}

/** 'YYYY-MM-DD' 往前推 n 天（UTC 整天）。 */
function isoDayMinus(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS
  return new Date(ms).toISOString().slice(0, 10)
}

/** 整数中位数：排序后取中间，偶数个取两中值平均，四舍五入到整数。 */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(median)
}

/**
 * 近 7 天每结果成本中位数（分）。按天汇总 spend/results 再算每天成本，
 * 少于 3 个可用天 → null（样本太薄，中位数不可信）。
 */
export async function medianCostPerResultCents(
  clientId: string,
  insightDate: string,
): Promise<number | null> {
  // ≤ 7 天 × 系列数，远低于 PostgREST 1000 行上限，无需分页。
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('insight_date, spend, results')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .gte('insight_date', isoDayMinus(insightDate, MEDIAN_WINDOW_DAYS - 1))
    .lte('insight_date', insightDate)

  if (error || !data) return null

  const rows = data as AdDailyInsightRow[]
  const spendByDay = new Map<string, number>()
  const resultsByDay = new Map<string, number>()
  for (const row of rows) {
    spendByDay.set(row.insight_date, (spendByDay.get(row.insight_date) ?? 0) + (row.spend ?? 0))
    resultsByDay.set(row.insight_date, (resultsByDay.get(row.insight_date) ?? 0) + (row.results ?? 0))
  }

  const perDayCents: number[] = []
  for (const [day, dayResults] of resultsByDay) {
    if (dayResults <= 0) continue
    const daySpend = spendByDay.get(day) ?? 0
    // spend 是账户币种主单位，cap 是分，这里统一成分。
    perDayCents.push(Math.round((daySpend * 100) / dayResults))
  }

  if (perDayCents.length < MIN_MEDIAN_DAYS) return null
  return medianOf(perDayCents)
}

/** 目标期内的整天数（含首尾），与 goal-pace.ts 同一口径。 */
function dayIndexAndTotal(periodStart: string, periodEnd: string, today: string): { dayIndex: number; totalDays: number } {
  const start = Date.parse(`${periodStart}T00:00:00Z`)
  const end = Date.parse(`${periodEnd}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  const clamped = Math.min(now, end)
  const dayIndex = Math.max(1, Math.floor((clamped - start) / DAY_MS) + 1)
  const totalDays = Math.floor((end - start) / DAY_MS) + 1
  return { dayIndex, totalDays }
}

export async function buildDigestGoalContext(
  clientId: string,
  insightDate: string,
): Promise<DigestGoalContext | null> {
  try {
    const goal = pickDigestGoal(await listActiveGoals(supabaseAdmin, clientId))
    if (!goal) return null

    const fetched = await autoFetchMetricValue(supabaseAdmin, clientId, goal.primary_metric_key, {
      goalPeriod: { period_start: goal.period_start, period_end: goal.period_end },
    })
    // unknown / 任何失败 → null（不是 0）。
    const actualToDate = fetched.ok ? fetched.value : null

    const config = await loadAdStrategyConfig(clientId)
    const medianCostPerResultCents7d = await medianCostPerResultCents(clientId, insightDate)

    const pace = computeGoalPace({
      targetValue: goal.target_value,
      baselineValue: goal.baseline_value,
      periodStart: goal.period_start,
      periodEnd: goal.period_end,
      today: insightDate,
      actualToDate,
      dailyCapCents: config.daily_budget_cap_cents,
      medianCostPerResultCents7d,
    })

    const { dayIndex, totalDays } = dayIndexAndTotal(goal.period_start, goal.period_end, insightDate)

    return {
      title: goal.title,
      label: goal.primary_metric_label,
      target: goal.target_value,
      dayIndex,
      totalDays,
      pace,
    }
  } catch (err) {
    console.warn('[ads-strategy] goal context failed', err instanceof Error ? err.message : String(err))
    return null
  }
}
