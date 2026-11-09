/**
 * 蒸馏成本闸（L56-P1.R5，对应契约步骤 3「成本闸」与 L6c 接口）。
 * 只放上限常量、最坏用量估算与额度预留/结算的薄封装；不写计数、不读库、不外呼。
 */

import type { Result } from '@/lib/agent-learning/contracts'
import type { BudgetLedger } from '@/lib/agent-learning/budget/types'
import { periodKeys, safeReserve, safeSettle } from '@/lib/agent-learning/budget/reserve'
import { worstCaseUsd, type DeepSeekPrice } from '@/lib/agent-learning/llm/deepseek-client'

/** 每天最多处理的内容条数（硬上限） */
export const DISTILL_DAILY_ITEM_CAP = 30

/** 每天蒸馏花费硬上限（美元），Ray 2026-10-25 定 */
export const DISTILL_DAILY_USD_CAP = 0.2

/** 每条内容送入蒸馏的最大输入 token 数（超出截断，不分段重试） */
export const DISTILL_MAX_INPUT_TOKENS = 8000

/** 每条内容蒸馏输出的最大 token 数（max_tokens） */
export const DISTILL_MAX_OUTPUT_TOKENS = 1500

/** 额度预留失败的机器可读原因 */
export type DistillReserveFailure =
  | 'daily_item_cap'
  | 'daily_cost_cap'
  | 'budget_ledger_unavailable'
  | 'duplicate_reservation'
  | 'invalid_request'

/** UTC 口径的蒸馏账本 key：日条数与日美元（与 2.7 的 period_key 取值一致） */
export function distillPeriodKeys(now: Date): { itemsDay: string; usdDay: string } {
  const { day } = periodKeys('distill', now)
  return {
    itemsDay: `distill:items:day:${day}`,
    usdDay: `distill:usd:day:${day}`,
  }
}

/** 按最坏用量估算一次蒸馏的美元花费（纯函数，转调 llm 包的 worstCaseUsd） */
export function estimateWorstCaseUsd(
  est: { maxInputTokens: number; maxOutputTokens: number },
  price: DeepSeekPrice,
): number {
  return worstCaseUsd(price, est.maxInputTokens, est.maxOutputTokens)
}

/** 预留入参是否合法：有限且 > 0；不合法时不得调用账本 */
function isValidWorstCase(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * 为一次蒸馏一次性预留 日条数（1 条）与 日美元（最坏用量），全有或全无。
 * 入参不合法 → invalid_request 且不调用账本；账本报错 → budget_ledger_unavailable；
 * 条数上限被拒 → daily_item_cap；美元上限被拒 → daily_cost_cap；
 * 重复预留 ID → duplicate_reservation（零外呼）。
 */
export async function reserveDistillBudget(
  ledger: BudgetLedger,
  reservationId: string,
  worstCase: number,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: DistillReserveFailure }> {
  if (!isValidWorstCase(worstCase)) {
    return { ok: false, reason: 'invalid_request' }
  }

  const keys = distillPeriodKeys(now)
  const reserved = await safeReserve(ledger, reservationId, 'distill', [
    { periodKey: keys.itemsDay, unit: 'items', cap: DISTILL_DAILY_ITEM_CAP, amount: 1 },
    { periodKey: keys.usdDay, unit: 'usd', cap: DISTILL_DAILY_USD_CAP, amount: worstCase },
  ])

  if (!reserved.ok) return { ok: false, reason: 'budget_ledger_unavailable' }

  const outcome = reserved.value
  if (outcome.ok) return { ok: true }
  if (outcome.reason === 'duplicate_reservation') {
    return { ok: false, reason: 'duplicate_reservation' }
  }
  if (outcome.deniedKey === keys.itemsDay) return { ok: false, reason: 'daily_item_cap' }
  if (outcome.deniedKey === keys.usdDay) return { ok: false, reason: 'daily_cost_cap' }
  return { ok: false, reason: 'budget_ledger_unavailable' }
}

/**
 * 按实际花费结算：条数记实际 1 条，美元记响应算出的实际值。
 * 必须与预留用同一个 `now`，否则日 key 不同、结算对不上原 hold。
 */
export async function settleDistillBudget(
  ledger: BudgetLedger,
  reservationId: string,
  actualUsd: number,
  now: Date,
): Promise<Result<void>> {
  const keys = distillPeriodKeys(now)
  return safeSettle(ledger, reservationId, [
    { periodKey: keys.itemsDay, actual: 1 },
    { periodKey: keys.usdDay, actual: actualUsd },
  ])
}
