/**
 * 熔断器运行时调用方的取数层：把 `ad_daily_insights` 的真实花费按账户、按天
 * 汇总成 `evaluateCircuitBreaker` 要的形状（WP3 熔断器运行时调用方）。
 *
 * 按 `level = 'campaign'` 过滤再汇总——跟 `goal-context.ts` /
 * `evaluate.ts` / `own-ad-activity.ts` 同一惯例：`ad_daily_insights` 每天每
 * 客户在 campaign/adset/ad 三个粒度各有一批行，campaign 级别一天一账户内
 * 所有系列的花费之和就是账户当日花费；混进 adset 或 ad 级别会把同一笔花费
 * 再数一遍。
 *
 * 🔴 Codex P1 复审：按账户分别判定，不按客户合计。多账户客户（如 CTS）把
 * 全部账户花费加成一条客户级日序列，会让单个账户的真实异常被其它账户的
 * 稳定花费稀释——账户 A 从 100 涨到 400（4x，该触发），账户 B 稳定 1000，
 * 客户合计只涨约 1.27x，判定为不触发。不同账户还可能用不同币种，直接相加
 * 的数字本身就没有意义。改成按 `ad_account_id` 分组，每个账户单独喂一次
 * `evaluateCircuitBreaker`，调用方（Inngest 函数）任一账户判定为 tripped
 * 就熔断整个客户——熔断动作本身（写 deny）目前仍是客户级（`client_automation_policies`
 * 按 `(client_id, action_key)` 存，没有账户维度），这是刻意的最小改动：
 * 判定按账户做对，安全动作保持已有粒度，不动 Kernel 策略表 schema。
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
  ad_account_id: string
  spend: number | null
}

export interface ClientDailySpendCents {
  readonly todayTotalSpendCents: number
  /** 严格早于 evaluationDate 的最近 N 天（不含 evaluationDate 本身）。 */
  readonly recentDailySpend: readonly DailySpendEntry[]
}

export interface AccountDailySpendCents extends ClientDailySpendCents {
  readonly adAccountId: string
}

/** 'YYYY-MM-DD' 往前推 n 天（UTC 整天，跟 goal-context.ts 的 isoDayMinus 同实现）。 */
function isoDayMinus(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * 读 `evaluationDate` 当天 + 之前 `lookbackDays` 天，按账户分别给出每日花费
 * （分）。返回顺序按 `ad_account_id` 字典序，便于测试断言。
 *
 * 读失败返回 null（调用方按「读不到 = 不动」处理，不当 0 用——0 会被
 * `evaluateCircuitBreaker` 当"今天没花钱"，跟"读不到"是两回事）。窗口内
 * 没有任何行（客户还没有花费数据）返回空数组，不是 null——这是"读到了，
 * 内容是空的"，跟"读不到"是两回事。
 *
 * 🔴 Codex P2 复审：走 `fetchAll` 分页，不能裸查——PostgREST 单次硬顶 1000 行
 * （`supabase-paginate.ts`），账户大、系列多的客户 8 天窗口内的 campaign 行
 * 数一旦过顶就会被静默截断，且没有稳定排序时被丢的行不可预测，可能正好
 * 丢当天数据、低估花费从而漏触发熔断。`.order(insight_date).order(entity_id)`
 * 跟 `diagnostics/loader.ts` 同一套稳定排序，配 `fetchAll` 的 `.range()` 用。
 */
export async function fetchClientDailySpendCentsByAccount(
  sb: SupabaseClient,
  clientId: string,
  evaluationDate: string,
  lookbackDays: number,
): Promise<AccountDailySpendCents[] | null> {
  const since = isoDayMinus(evaluationDate, lookbackDays)

  let rows: AdDailyInsightSpendRow[]
  try {
    rows = await fetchAll<AdDailyInsightSpendRow>((from, to) =>
      sb
        .from('ad_daily_insights')
        .select('insight_date, entity_id, ad_account_id, spend')
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

  const toCents = (dollars: number): number => Math.round(dollars * 100)

  // account_id -> date -> 分
  const spendByAccountDay = new Map<string, Map<string, number>>()
  for (const row of rows) {
    let byDay = spendByAccountDay.get(row.ad_account_id)
    if (!byDay) {
      byDay = new Map<string, number>()
      spendByAccountDay.set(row.ad_account_id, byDay)
    }
    byDay.set(row.insight_date, (byDay.get(row.insight_date) ?? 0) + (row.spend ?? 0))
  }

  const out: AccountDailySpendCents[] = []
  for (const adAccountId of [...spendByAccountDay.keys()].sort()) {
    const byDay = spendByAccountDay.get(adAccountId)!
    const recentDailySpend: DailySpendEntry[] = []
    for (const [date, dollars] of byDay) {
      if (date === evaluationDate) continue
      recentDailySpend.push({ date, totalSpendCents: toCents(dollars) })
    }
    out.push({
      adAccountId,
      todayTotalSpendCents: toCents(byDay.get(evaluationDate) ?? 0),
      recentDailySpend,
    })
  }
  return out
}
