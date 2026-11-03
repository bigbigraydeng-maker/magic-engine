/**
 * 额度预留账本的类型定义（L56-P1.R3）。
 * 只放类型与接口，不含任何实现；本文件不 import supabase / inngest / SDK。
 */

import type { Result } from '@/lib/agent-learning/contracts'

/** 账本计量的单位：美元 / 条数 / 读帖数，与 2.7 的 unit 列取值一致 */
export type BudgetUnit = 'usd' | 'items' | 'reads'

/** 外呼用途：蒸馏或 X 读帖；只放用途，不放内容 */
export type BudgetPurpose = 'distill' | 'x_read'

/** 单条预留项：某个 period_key 上要预留多少（cap 由调用方代码常量传入，函数取较小者） */
export interface BudgetItem {
  periodKey: string
  unit: BudgetUnit
  cap: number
  amount: number
}

/**
 * 预留结果（业务结论，不是调用成败）：
 * - 认出成功：本次外呼被独占批准
 * - cap_exceeded：某个 key 余额不够，该 key 在 deniedKey 里
 * - duplicate_reservation：同一个 reservation_id 被重放，不得当成功
 */
export type ReserveOutcome =
  | { ok: true; claimed: true }
  | { ok: false; reason: 'cap_exceeded'; deniedKey: string }
  | { ok: false; reason: 'duplicate_reservation'; holdStatus: 'held' | 'settled' }

/** 单条结算项：某个 period_key 上实际用了多少 */
export interface SettleActual {
  periodKey: string
  actual: number
}

/**
 * 账本接口：生产实现是对 2.7 两个 SQL 函数的 rpc 调用；测试用 fake-ledger。
 * 两个方法都不抛错，失败一律走 Result 的失败分支（fail-closed）。
 */
export interface BudgetLedger {
  reserve(reservationId: string, purpose: BudgetPurpose, items: BudgetItem[]): Promise<Result<ReserveOutcome>>
  settle(reservationId: string, actuals: SettleActual[]): Promise<Result<void>>
}

/** rpc 调用的最小形状：与 supabase 的 rpc 返回兼容，便于注入替身 */
export type RpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>
