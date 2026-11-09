/**
 * X 读帖闸（L56-P1.R5，对应契约「X 读帖闸」与 L6d 接口）。
 * 只放常量、纯函数与额度预留/结算的薄封装；不写计数，不碰 Supabase/Inngest。
 */

import type { Result } from '@/lib/agent-learning/contracts'
import type { BudgetLedger } from '@/lib/agent-learning/budget/types'
import { periodKeys, safeReserve, safeSettle } from '@/lib/agent-learning/budget/reserve'

/** 每天最多读帖数（硬上限，改数值须走 PR） */
export const X_DAILY_READ_CAP = 40

/** 每月最多读帖数（硬上限，约 900 × 0.005 美元 ≈ 4.5 美元/月） */
export const X_MONTHLY_READ_CAP = 900

/** 每月 X 读帖花费硬上限（美元） */
export const X_MONTHLY_USD_CAP = 5

/** 初值；PR 附官方价格页链接与取价日期，真实读帖前须 Ray 确认 */
export const X_PRICE_PER_READ_USD = 0.005

/** 首批只读的 10 个 X 号（Ray 2026-10-25 同意，其余专家走 RSS） */
export const X_FIRST_BATCH_HANDLES = [
  'glenngabe',
  'lilyraynyc',
  'aleyda',
  'Marie_Haynes',
  'jonloomer',
  'binghott',
  'Kevin_Indig',
  'VeryWellVersed',
  'simonw',
  'emollick',
] as const

/** 小写化的首批清单，供大小写不敏感比对（不导出） */
const FIRST_BATCH_LOWER = new Set<string>(X_FIRST_BATCH_HANDLES.map((h) => h.toLowerCase()))

/** 额度预留失败的机器可读原因 */
export type XReserveFailure =
  | 'x_daily_cap'
  | 'x_monthly_cap'
  | 'x_cost_cap'
  | 'budget_ledger_unavailable'
  | 'duplicate_reservation'
  | 'invalid_request'

/** 判断账号是否在首批 10 个号内：去首尾空白、去掉前导 @、大小写不敏感 */
export function isFirstBatchHandle(handle: string): boolean {
  const normalized = handle.trim().replace(/^@+/, '').toLowerCase()
  if (normalized.length === 0) return false
  return FIRST_BATCH_LOWER.has(normalized)
}

/** UTC 口径的 X 账本 key：日读帖、月读帖、月美元（与 2.7 的 period_key 取值一致） */
export function xPeriodKeys(now: Date): { readsDay: string; readsMonth: string; usdMonth: string } {
  const { day, month } = periodKeys('x', now)
  return {
    readsDay: `x:reads:day:${day}`,
    readsMonth: `x:reads:month:${month}`,
    usdMonth: `x:usd:month:${month}`,
  }
}

/** 预留入参是否合法：整数且 1..X_DAILY_READ_CAP；不合法时不得调用账本 */
function isValidMaxResults(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= X_DAILY_READ_CAP
}

/**
 * 为一次 X 读帖一次性预留 日读帖 / 月读帖 / 月美元 三项（全有或全无）。
 * 入参不合法 → invalid_request 且不调用账本；账本报错 → budget_ledger_unavailable；
 * 任一 cap 被拒按 deniedKey 映射为具体原因；重复预留 ID → duplicate_reservation（零外呼）。
 */
export async function reserveXBudget(
  ledger: BudgetLedger,
  reservationId: string,
  request: { maxResults: number },
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: XReserveFailure }> {
  const maxResults = request.maxResults
  if (!isValidMaxResults(maxResults)) {
    return { ok: false, reason: 'invalid_request' }
  }

  const keys = xPeriodKeys(now)
  const reserved = await safeReserve(ledger, reservationId, 'x_read', [
    { periodKey: keys.readsDay, unit: 'reads', cap: X_DAILY_READ_CAP, amount: maxResults },
    { periodKey: keys.readsMonth, unit: 'reads', cap: X_MONTHLY_READ_CAP, amount: maxResults },
    {
      periodKey: keys.usdMonth,
      unit: 'usd',
      cap: X_MONTHLY_USD_CAP,
      amount: maxResults * X_PRICE_PER_READ_USD,
    },
  ])

  if (!reserved.ok) return { ok: false, reason: 'budget_ledger_unavailable' }

  const outcome = reserved.value
  if (outcome.ok) return { ok: true }
  if (outcome.reason === 'duplicate_reservation') {
    return { ok: false, reason: 'duplicate_reservation' }
  }
  if (outcome.deniedKey === keys.readsDay) return { ok: false, reason: 'x_daily_cap' }
  if (outcome.deniedKey === keys.readsMonth) return { ok: false, reason: 'x_monthly_cap' }
  if (outcome.deniedKey === keys.usdMonth) return { ok: false, reason: 'x_cost_cap' }
  return { ok: false, reason: 'budget_ledger_unavailable' }
}

/**
 * 按实际返回的帖数结算（读数与美元都按实际值）。
 * 必须与预留用同一个 `now`，否则日/月 key 不同、结算对不上原 hold。
 */
export async function settleXBudget(
  ledger: BudgetLedger,
  reservationId: string,
  actual: { reads: number },
  now: Date,
): Promise<Result<void>> {
  const keys = xPeriodKeys(now)
  const usd = actual.reads * X_PRICE_PER_READ_USD
  return safeSettle(ledger, reservationId, [
    { periodKey: keys.readsDay, actual: actual.reads },
    { periodKey: keys.readsMonth, actual: actual.reads },
    { periodKey: keys.usdMonth, actual: usd },
  ])
}

/**
 * 按当月已过天数外推月度花费：(spent + reserved) / max(1, dayOfMonth) × daysInMonth。
 * 纯函数；账本是唯一事实源，不用 API 响应自报的数字。
 */
export function projectMonthlyCostUsd(usage: {
  spentUsd: number
  reservedUsd: number
  dayOfMonth: number
  daysInMonth: number
}): number {
  const divisor = Math.max(1, usage.dayOfMonth)
  return ((usage.spentUsd + usage.reservedUsd) / divisor) * usage.daysInMonth
}

/** 外推月度花费是否已超过 5 美元线：超过则应提前停读并告警 */
export function shouldStopForProjectedCost(usage: {
  spentUsd: number
  reservedUsd: number
  dayOfMonth: number
  daysInMonth: number
}): boolean {
  return projectMonthlyCostUsd(usage) > X_MONTHLY_USD_CAP
}
