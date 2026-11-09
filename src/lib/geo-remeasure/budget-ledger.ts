/**
 * Magic Engine 2.0 · GEO 自动重测的每客户预算账本（Issue #1347）
 *
 * 🔴 **这是 preflightBudget 之前那一层。** WP04 的 preflightBudget 只在单次进程内存账工作，
 *    对「两入口并发各自满额」无能为力。本层提供**跨进程、原子**的额度来源：一次成功的
 *    reserve 才产出 plan.budgetUsd，绝不从 env / 硬编码来。子牙复审确认此分层非重复造闸。
 *
 * 🔴 **逐笔预留 + 幂等**（三审必改）：reserve/settle 都带 `reservationId`（= 批次身份）。
 *    重复调用是 no-op —— Inngest 会重试，双 settle 不会把花费灌两遍。
 * 🔴 **fail-closed**：没有预算行 = 拒绝，绝不自动建默认额度。
 * 🔴 判断+累加的原子性由数据库 RPC（FOR UPDATE + WHERE 判据）保证；本层不自己算余额。
 */

export type GeoBudgetReserveReason =
  | 'no_budget_row' | 'insufficient' | 'invalid_worst_case' | 'invalid_reservation_id' | 'reservation_mismatch' | 'already_settled' | 'reservation_expired'

export interface GeoBudgetReserveResult {
  readonly reserved: boolean
  readonly reason?: GeoBudgetReserveReason
  readonly remainingUsd?: number
  /** 该 reservationId 之前已预留过 → 本次是幂等回放，未重复累加。 */
  readonly idempotent?: boolean
}

export interface GeoBudgetSettleResult {
  readonly settled: boolean
  readonly reason?: string
  readonly chargedUsd?: number
  readonly idempotent?: boolean
}

/** 账本存储契约。真实实现走 Supabase RPC；测试用假件（内存两表，同一套判据）。 */
export interface GeoBudgetStore {
  reserve(
    reservationId: string,
    clientId: string,
    periodKey: string,
    worstCaseUsd: number,
  ): Promise<GeoBudgetReserveResult>
  settle(reservationId: string, actualUsd: number): Promise<GeoBudgetSettleResult>
}

/** 授权结果：授权时 `budgetUsd` 就是已预留的最坏成本，供下游 preflightBudget 使用。 */
export type GeoBudgetAuthorization =
  | { readonly authorized: true; readonly reservationId: string; readonly budgetUsd: number; readonly periodKey: string }
  | { readonly authorized: false; readonly reason: GeoBudgetReserveReason }

/**
 * YYYY-MM 预算窗口键。**UTC 月**（不是 NZ 月）—— 显式决定：两个入口（Inngest + 脚本）
 * 必须都用本 helper，保证打到同一行；用不同时钟各算 key 会打到不同窗口、绕过额度（子牙 #3）。
 * NZ 月界与 UTC 差 ~半天，对月度额度只是归属观感，不造成超支（每个 key 各自原子封顶）。
 */
export function geoBudgetPeriodKey(now: Date): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * 自动重测的唯一额度来源：原子预留成功 → 返回可用作 plan.budgetUsd 的授权额度。
 * 🔴 `budgetUsd` 恒等于本次预留的 worstCaseUsd。`reservationId` 必须由调用方给（= 批次身份），
 *    settle 时用**同一个** reservationId，保证 reserve↔settle 一一对应、可幂等、可回收。
 */
export async function resolveClientGeoBudget(
  store: GeoBudgetStore,
  args: { reservationId: string; clientId: string; periodKey: string; worstCaseUsd: number },
): Promise<GeoBudgetAuthorization> {
  if (!args.reservationId || args.reservationId.length === 0) {
    return { authorized: false, reason: 'invalid_reservation_id' }
  }
  if (!Number.isFinite(args.worstCaseUsd) || !(args.worstCaseUsd > 0)) {
    return { authorized: false, reason: 'invalid_worst_case' }
  }
  const r = await store.reserve(args.reservationId, args.clientId, args.periodKey, args.worstCaseUsd)
  if (!r.reserved) return { authorized: false, reason: r.reason ?? 'insufficient' }
  return { authorized: true, reservationId: args.reservationId, budgetUsd: args.worstCaseUsd, periodKey: args.periodKey }
}
