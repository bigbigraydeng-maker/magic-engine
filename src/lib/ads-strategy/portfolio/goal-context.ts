/**
 * 日报"目标进度"段的取数（spec 2026-09-24 §3 G1/G2/G10）。尽力而为，任何一步拿不到 → null（日报写"没有生效中的目标"或"未判"），绝不抛、绝不把缺数当 0。
 */
import { supabaseAdmin } from '@/lib/supabase'
import { listActiveGoals } from '@/lib/strategy/goals'
import { autoFetchMetricValue } from '@/lib/strategy/auto-fetch'
import { loadAdStrategyConfigWithSource } from '../config'
import { getTrackingClientConfig } from '@/lib/ads-tracking-preflight/client-config'
import { computeGoalPace, type GoalPace } from '../goal-pace'
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

interface AdDailyInsightRow {
  insight_date: string
  entity_id?: string | null
  spend: number | null
  results: number | null
  leads?: number | null
  messaging_conversations?: number | null
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

/** 成本按哪类结果算：线索目标只认 leads、私信目标只认 messaging_conversations，其余沿用合计 results。 */
export type CostMetric = 'results' | 'leads' | 'messaging'

export interface CostScope {
  metric?: CostMetric
  /** 只算这些系列（Meta campaign id）；不给 = 该客户全部系列 */
  campaignIds?: readonly string[]
}

export interface RecentCost {
  medianCents: number | null
  /** 样本日的平均日花费（分）；一个样本日都没有 = null */
  avgDailySpendCents: number | null
  /** 样本里有几天出了这类结果 */
  sampleDays: number
  /** 范围内最新有日报行的一天；一行都没有 = null */
  latestDate: string | null
}

const EMPTY_COST: RecentCost = { medianCents: null, avgDailySpendCents: null, sampleDays: 0, latestDate: null }

export function costMetricForGoal(primaryMetricKey: string): CostMetric {
  if (primaryMetricKey === 'leads_count') return 'leads'
  if (primaryMetricKey === 'messaging_started') return 'messaging'
  return 'results'
}

function rowCount(row: AdDailyInsightRow, metric: CostMetric): number {
  if (metric === 'leads') return row.leads ?? 0
  if (metric === 'messaging') return row.messaging_conversations ?? 0
  return row.results ?? 0
}

/**
 * 近 7 天同类结果的每结果成本（分）。线索 / 私信目标只拿「出了这类结果的系列行」的花费和数量，
 * 不让别的类型（如 WhatsApp 对话）的成本去除表单线索；按天汇总后少于 3 个可用天 → 中位数 null。
 */
export async function readRecentCost(
  clientId: string,
  insightDate: string,
  scope: CostScope = {},
): Promise<RecentCost> {
  const metric = scope.metric ?? 'results'
  // ≤ 7 天 × 系列数，远低于 PostgREST 1000 行上限，无需分页。
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('insight_date, entity_id, spend, results, leads, messaging_conversations')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .gte('insight_date', isoDayMinus(insightDate, MEDIAN_WINDOW_DAYS - 1))
    .lte('insight_date', insightDate)

  if (error || !data) return EMPTY_COST

  const wanted = scope.campaignIds ? new Set(scope.campaignIds) : null
  const rows = (data as AdDailyInsightRow[]).filter(r => !wanted || (r.entity_id != null && wanted.has(r.entity_id)))
  const spendByDay = new Map<string, number>()
  const countByDay = new Map<string, number>()
  let latestDate: string | null = null
  for (const row of rows) {
    if (latestDate === null || row.insight_date > latestDate) latestDate = row.insight_date
    const count = rowCount(row, metric)
    // 线索 / 私信：没出这类结果的系列行，花费不算进来（它可能在买别的结果）。
    if (metric !== 'results' && count <= 0) continue
    spendByDay.set(row.insight_date, (spendByDay.get(row.insight_date) ?? 0) + (row.spend ?? 0))
    countByDay.set(row.insight_date, (countByDay.get(row.insight_date) ?? 0) + count)
  }

  const perDayCents: number[] = []
  const spendCents: number[] = []
  for (const [day, dayCount] of countByDay) {
    if (dayCount <= 0) continue
    const daySpend = spendByDay.get(day) ?? 0
    // spend 是账户币种主单位，cap 是分，这里统一成分。
    perDayCents.push(Math.round((daySpend * 100) / dayCount))
    spendCents.push(daySpend * 100)
  }

  const avgDailySpendCents = spendCents.length === 0
    ? null
    : Math.round(spendCents.reduce((a, b) => a + b, 0) / spendCents.length)
  return {
    medianCents: perDayCents.length < MIN_MEDIAN_DAYS ? null : medianOf(perDayCents),
    avgDailySpendCents,
    sampleDays: perDayCents.length,
    latestDate,
  }
}

/** 近 7 天每结果成本中位数（分）；少于 3 个可用天 → null（样本太薄，中位数不可信）。 */
export async function medianCostPerResultCents(
  clientId: string,
  insightDate: string,
  scope: CostScope = {},
): Promise<number | null> {
  return (await readRecentCost(clientId, insightDate, scope)).medianCents
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

/**
 * 读不出日预算上限时，预算那一道判断（「按上限到不了目标」）等于没做。
 * 「落后」只靠线性节奏就能成立，照报；「按节奏走」要两道都过才算数，降成未判——
 * 不能拿缺数当"没问题"。
 */
export function withoutCapLens(pace: GoalPace): GoalPace {
  if (pace.verdict !== 'on_track') return pace
  return { ...pace, verdict: 'unknown', reason: '读不出广告设置（日预算上限），预算够不够到目标今天没判' }
}

/**
 * 同类结果的成本样本不够、而且目标期本身才刚开始（有数据的天数 < MIN_MEDIAN_DAYS）时，
 * 任何判断（含「落后」）都是拿几乎没有的数据下结论 → 一律「样本不足，未判」，不标红。
 * 目标期已经跑了几天、成本样本仍薄，则保留原判断（长期出不了结果本身就是信号）。
 */
export function withThinSampleGuard(pace: GoalPace, costMedian: number | null, dataDays: number | null): GoalPace {
  if (costMedian !== null || dataDays === null || dataDays >= MIN_MEDIAN_DAYS) return pace
  if (pace.verdict === 'unknown') return pace
  return {
    ...pace,
    verdict: 'unknown',
    reason: `样本不足，未判：同类结果有成本的天数不到 ${MIN_MEDIAN_DAYS} 天（目标期日报只有 ${dataDays} 天数据）`,
  }
}

/**
 * 实际值窗口的终点，和速度分母同一天。
 * 截止日为空、早于目标期开始、或不早于目标期末时不截。
 */
function clipGoalEndToDataThrough(
  periodStart: string,
  periodEnd: string,
  dataThrough: string | null,
): string {
  if (!dataThrough || dataThrough < periodStart || dataThrough >= periodEnd) return periodEnd
  return dataThrough
}

/** 目标对应的系列：线索目标 = 配置里的表单留资系列，私信目标 = WhatsApp 系列；没配置 = 不限系列（只按结果类型区分）。 */
function goalCampaignIds(clientId: string, metric: CostMetric): string[] | undefined {
  const kind = metric === 'leads' ? 'lead_form' : metric === 'messaging' ? 'whatsapp' : null
  if (!kind) return undefined
  const series = getTrackingClientConfig(clientId)?.objective_watch?.series ?? []
  const ids = series.filter(s => s.kind === kind).map(s => s.campaign_id)
  return ids.length > 0 ? ids : undefined
}

export async function buildDigestGoalContext(
  clientId: string,
  insightDate: string,
): Promise<DigestGoalContext | null> {
  try {
    const goal = pickDigestGoal(await listActiveGoals(supabaseAdmin, clientId))
    if (!goal) return null

    const { config, source, error: configError } = await loadAdStrategyConfigWithSource(clientId)
    const metric = costMetricForGoal(goal.primary_metric_key)
    const cost = await readRecentCost(clientId, insightDate, {
      metric,
      campaignIds: goalCampaignIds(clientId, metric),
    })
    const medianCostPerResultCents7d = cost.medianCents
    // 速度按有数据的最后一天算。实际值用同一个终点，不把截止日之后的数算进去。
    const dataThrough = cost.latestDate
    const fetched = await autoFetchMetricValue(supabaseAdmin, clientId, goal.primary_metric_key, {
      goalPeriod: {
        period_start: goal.period_start,
        period_end: clipGoalEndToDataThrough(goal.period_start, goal.period_end, dataThrough),
      },
    })
    // unknown / 任何失败 → null（不是 0）。
    const actualToDate = fetched.ok ? fetched.value : null
    const dataDays = dataThrough === null
      ? null
      : dayIndexAndTotal(goal.period_start, goal.period_end, dataThrough).dayIndex

    const computed = computeGoalPace({
      targetValue: goal.target_value,
      baselineValue: goal.baseline_value,
      periodStart: goal.period_start,
      periodEnd: goal.period_end,
      today: insightDate,
      actualToDate,
      dailyCapCents: config.daily_budget_cap_cents,
      medianCostPerResultCents7d,
      dataThrough,
      actualDailySpendCents: cost.avgDailySpendCents,
    })
    const capped = source === 'fallback' ? withoutCapLens(computed) : computed
    const pace = withThinSampleGuard(capped, medianCostPerResultCents7d, dataDays)
    if (source === 'fallback') {
      console.error(`[ads-strategy] goal context: ad_strategy_configs read failed for ${clientId}: ${configError ?? 'unknown error'}`)
    }

    const { dayIndex, totalDays } = dayIndexAndTotal(goal.period_start, goal.period_end, insightDate)

    return {
      title: goal.title,
      label: goal.primary_metric_label,
      target: goal.target_value,
      dayIndex,
      totalDays,
      pace,
      ...(source === 'fallback' ? { configReadError: configError ?? 'unknown error' } : {}),
    }
  } catch (err) {
    console.warn('[ads-strategy] goal context failed', err instanceof Error ? err.message : String(err))
    return null
  }
}
