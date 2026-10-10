/**
 * 预算锁配置（ads IMPACT 阶段 2，设计 §4.1 硬前置第 2 条 / §7 L4 / §14 M4）。
 *
 * 存在既有 `ad_strategy_configs` 的新列里（migration 20260915230000）。
 *
 * 🔴 M4 条款，也是本文件存在的唯一理由：**缺行按锁定处理，不许沿用**
 * `src/lib/ads-strategy/config.ts` 的 fail-open 模式（那是给只读诊断引擎用的——
 * 丢数据比误开更糟）。这里保护的是「会不会真的动钱」，方向相反：
 *   - 没有配置行（`no_row`）→ locked:true
 *   - 读失败（`read_error`）→ locked:true
 *   - 只有明确读到一行、且该行 `budget_locked` 列显式为 false，locked 才能是 false
 * 脏值（负数、超出 0-100 的百分比）只让那个具体字段回落成「未设置」，
 * 不连带把 locked 的判定路径带坏——两条判断线互相独立。
 *
 * 本模块只负责「读得到、读不到都安全」，不接入任何真正的预算执行逻辑
 * （挪预算一次性执行是后续 PR 的事，会来消费这个读函数）。
 */

import { supabaseAdmin } from '@/lib/supabase'

export type BudgetPolicySource = 'row' | 'no_row' | 'read_error'

export interface BudgetPolicy {
  locked: boolean
  totalDailyCapMinor: number | null
  perUnitDailyChangeCapPct: number | null
}

export interface LoadedBudgetPolicy {
  policy: BudgetPolicy
  source: BudgetPolicySource
  error?: string
}

const COLUMNS = 'budget_locked, total_daily_cap_minor, per_unit_daily_change_cap_pct'

/** 设计 §4.3「单次 ≤20%」——单个预算单位当日累计变动上限的系统兜底值。唯一定义处，别处复用不复制数字。 */
export const DEFAULT_PER_UNIT_DAILY_CHANGE_CAP_PCT = 20

/** 缺行 / 读失败时的安全默认：锁定，两个具体上限项都是「未设置」。 */
export function lockedBudgetPolicy(): BudgetPolicy {
  return { locked: true, totalDailyCapMinor: null, perUnitDailyChangeCapPct: null }
}

/**
 * 从一行库数据解析。非法值按未配置处理（不信任库里被手改过的脏值），
 * 但脏值只影响它自己那个字段——不影响 locked 的判定路径。
 *
 * locked 的判定刻意不对称：只有显式 `=== false` 才解锁；`true`、`null`、`undefined`、
 * 任何非布尔脏值，一律按锁定处理。这不是"猜"，是保护动钱这件事的默认方向。
 */
export function parseBudgetPolicyRow(row: Record<string, unknown>): BudgetPolicy {
  const totalRaw = row.total_daily_cap_minor
  const total = totalRaw === null || totalRaw === undefined ? NaN : Number(totalRaw)
  const totalDailyCapMinor = Number.isFinite(total) && Number.isInteger(total) && total > 0 ? total : null

  const pctRaw = row.per_unit_daily_change_cap_pct
  const pct = pctRaw === null || pctRaw === undefined ? NaN : Number(pctRaw)
  const perUnitDailyChangeCapPct = Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : null

  const locked = row.budget_locked !== false

  return { locked, totalDailyCapMinor, perUnitDailyChangeCapPct }
}

export async function loadBudgetPolicy(clientId: string): Promise<LoadedBudgetPolicy> {
  try {
    const { data, error } = await supabaseAdmin
      .from('ad_strategy_configs')
      .select(COLUMNS)
      .eq('client_id', clientId)
      .maybeSingle()
    if (error) return { policy: lockedBudgetPolicy(), source: 'read_error', error: error.message }
    if (!data) return { policy: lockedBudgetPolicy(), source: 'no_row' }
    return { policy: parseBudgetPolicyRow(data as Record<string, unknown>), source: 'row' }
  } catch (err) {
    return { policy: lockedBudgetPolicy(), source: 'read_error', error: err instanceof Error ? err.message : String(err) }
  }
}
