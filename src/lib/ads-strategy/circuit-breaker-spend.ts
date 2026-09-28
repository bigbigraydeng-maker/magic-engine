/**
 * 熔断器运行时调用方的取数层：把 `ad_daily_insights` 的真实花费按天汇总成
 * `evaluateCircuitBreaker` 要的形状（WP3 熔断器运行时调用方）。
 *
 * 按 `level = 'campaign'` 过滤再汇总——跟 `goal-context.ts` /
 * `evaluate.ts` / `own-ad-activity.ts` 同一惯例：`ad_daily_insights` 每天每
 * 客户在 campaign/adset/ad 三个粒度各有一批行，campaign 级别一天一账户内
 * 所有系列的花费之和就是账户当日花费；混进 adset 或 ad 级别会把同一笔花费
 * 再数一遍。
 *
 * `spend` 列是账户币种主单位（美元/纽元，非整数），本模块只在离开这层时
 * 转一次分（× 100 四舍五入），跟 `medianCostPerResultCents` 同一换算方式。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailySpendEntry } from './circuit-breaker'
import { fetchAll } from '@/lib/supabase-paginate'

const DAY_MS = 86_400_000

interface AdDailyInsightSpendRow {
  insight_date: string
  entity_id: string
  spend: number | null
}

export interface ClientDailySpendCents {
  readonly todayTotalSpendCents: number
  /** 严格早于 evaluationDate 的最近 N 天（不含 evaluationDate 本身）。 */
  readonly recentDailySpend: readonly DailySpendEntry[]
}

/** 'YYYY-MM-DD' 往前推 n 天（UTC 整天，跟 goal-context.ts 的 isoDayMinus 同实现）。 */
function isoDayMinus(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * 读 `evaluationDate` 当天 + 之前 `lookbackDays` 天的账户合计花费（分）。
 *
 * 读失败返回 null（调用方按「读不到 = 不动」处理，不当 0 用——0 会被
 * `evaluateCircuitBreaker` 当"今天没花钱"，跟"读不到"是两回事）。
 *
 * 🔴 Codex P2 复审：走 `fetchAll` 分页，不能裸查——PostgREST 单次硬顶 1000 行
 * （`supabase-paginate.ts`），账户大、系列多的客户 8 天窗口内的 campaign 行
 * 数一旦过顶就会被静默截断，且没有稳定排序时被丢的行不可预测，可能正好
 * 丢当天数据、低估花费从而漏触发熔断。`.order(insight_date).order(entity_id)`
 * 跟 `diagnostics/loader.ts` 同一套稳定排序，配 `fetchAll` 的 `.range()` 用。
 */
export async function fetchClientDailySpendCents(
  sb: SupabaseClient,
  clientId: string,
  evaluationDate: string,
  lookbackDays: number,
): Promise<ClientDailySpendCents | null> {
  const since = isoDayMinus(evaluationDate, lookbackDays)

  let rows: AdDailyInsightSpendRow[]
  try {
    rows = await fetchAll<AdDailyInsightSpendRow>((from, to) =>
      sb
        .from('ad_daily_insights')
        .select('insight_date, entity_id, spend')
        .eq('client_id', clientId)
        .eq('level', 'campaign')
        .gte('insight_date', since)
        .lte('insight_date', evaluationDate)
        .order('insight_date', { ascending: true })
        .order('entity_id', { ascending: true })
        .range(from, to),
    )
  } catch {
    return null
  }

  const spendByDay = new Map<string, number>()
  for (const row of rows) {
    spendByDay.set(row.insight_date, (spendByDay.get(row.insight_date) ?? 0) + (row.spend ?? 0))
  }

  const toCents = (dollars: number): number => Math.round(dollars * 100)

  const recentDailySpend: DailySpendEntry[] = []
  for (const [date, dollars] of spendByDay) {
    if (date === evaluationDate) continue
    recentDailySpend.push({ date, totalSpendCents: toCents(dollars) })
  }

  return {
    todayTotalSpendCents: toCents(spendByDay.get(evaluationDate) ?? 0),
    recentDailySpend,
  }
}
