/**
 * 额度预留封装（L56-P1.R3，对应契约 2.7 与 7.7「额度预留封装规格」）。
 * 铁律：先预留、后结算；预留被拒或账本不可用一律零外呼（fail-closed）；
 * 结果未知（run 抛错 / 结算失败）保留占用，不自动释放。
 */

import { randomUUID } from 'node:crypto'
import type { Result } from '@/lib/agent-learning/contracts'
import type {
  BudgetItem,
  BudgetLedger,
  BudgetPurpose,
  ReserveOutcome,
  RpcFn,
  SettleActual,
} from './types'

/** 预留 SQL 函数名（与 2.7 一致，不得改名） */
export const RESERVE_RPC = 'agent_learning_budget_reserve'

/** 结算 SQL 函数名（与 2.7 一致，不得改名） */
export const SETTLE_RPC = 'agent_learning_budget_settle'

/** 账本不可用的统一失败返回；不回显底层错误信息 */
function unavailable<T>(): Result<T> {
  return { ok: false, error: 'budget_ledger_unavailable', code: 'db_error' }
}

/** 判断是否为普通对象（排除 null 与数组） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 判断非空字符串（去空白后仍非空） */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** 判断有限且 >= 0 的数字（cap / amount 的校验口径） */
function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** 调 rpc：抛错、error 非 null、返回形状不对都归一成 undefined，由调用方按不可用处理 */
async function callRpc(rpc: RpcFn, fn: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await rpc(fn, args)
    if (!res || res.error !== null) return undefined
    return res.data
  } catch {
    return undefined
  }
}

/** 严格解析 reserve 的返回数据；任何不认识/不完整/自相矛盾的形状都算「账本不可用」 */
function parseReserveOutcome(data: unknown): Result<ReserveOutcome> {
  if (!isPlainObject(data)) return unavailable<ReserveOutcome>()
  if (data.ok === true) {
    // 只有 {ok:true, claimed:true} 才是批准；缺 claimed 一律当不可用
    if (data.claimed === true) return { ok: true, value: { ok: true, claimed: true } }
    return unavailable<ReserveOutcome>()
  }
  if (data.ok !== false) return unavailable<ReserveOutcome>()
  // 重放同一 reservation_id：原样映射为拒绝，绝不当成功
  if (data.reason === 'duplicate_reservation') {
    const holdStatus = data.hold_status
    if (holdStatus === 'held' || holdStatus === 'settled') {
      return { ok: true, value: { ok: false, reason: 'duplicate_reservation', holdStatus } }
    }
    return unavailable<ReserveOutcome>()
  }
  if (isNonEmptyString(data.denied_key)) {
    return { ok: true, value: { ok: false, reason: 'cap_exceeded', deniedKey: data.denied_key } }
  }
  return unavailable<ReserveOutcome>()
}

/** 严格解析 settle 的返回数据；重复结算视为成功（不二次扣减），未知预留视为 not_found */
function parseSettleOutcome(data: unknown): Result<void> {
  if (!isPlainObject(data)) return unavailable<void>()
  if (data.ok === true) return { ok: true, value: undefined }
  if (data.ok === false && data.reason === 'unknown_reservation') {
    return { ok: false, error: 'unknown_reservation', code: 'not_found' }
  }
  return unavailable<void>()
}

/** 校验预留入参：id 非空、items 非空、cap / amount 都是有限非负数 */
function isValidReserveInput(reservationId: string, items: BudgetItem[]): boolean {
  if (!isNonEmptyString(reservationId)) return false
  if (!Array.isArray(items) || items.length === 0) return false
  return items.every((item) => isFiniteNonNegative(item.cap) && isFiniteNonNegative(item.amount))
}

/** 生成一次独立外呼的预留 ID：一个 ID 只对应一次外呼，重试必须重新生成 */
export function newAttemptId(scope: 'distill' | 'x', unitId: string, attempt: number): string {
  return `${scope}:${unitId}:${attempt}:${randomUUID()}`
}

/**
 * 算出 UTC 口径的日 / 月标识。
 * 口径：UTC 自然日 / UTC 自然月（不按新西兰时间），day = 'YYYYMMDD'，month = 'YYYYMM'，补零。
 * scope 只用于声明口径（蒸馏与 X 读帖共用同一套 UTC 日历），不参与格式化。
 */
export function periodKeys(scope: 'distill' | 'x', now: Date): { day: string; month: string } {
  if (scope !== 'distill' && scope !== 'x') throw new Error('unknown_budget_scope')
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  return { day: `${year}${month}${day}`, month: `${year}${month}` }
}

/**
 * 用注入的 rpc 造一个账本实现。
 * reserve：参数名按 2.7 转成 p_reservation_id / p_purpose / p_items（period_key / unit / cap / amount）。
 * settle：参数名按 2.7 转成 p_reservation_id / p_actuals（period_key / actual）。
 * rpc 抛错、返回 error、或返回形状不合规，一律 budget_ledger_unavailable（零外呼）。
 */
export function createRpcLedger(rpc: RpcFn): BudgetLedger {
  return {
    reserve: async (reservationId, purpose, items) => {
      if (!isValidReserveInput(reservationId, items)) {
        return { ok: false, error: 'invalid_budget_request', code: 'validation' }
      }
      const data = await callRpc(rpc, RESERVE_RPC, {
        p_reservation_id: reservationId,
        p_purpose: purpose,
        p_items: items.map((item) => ({
          period_key: item.periodKey,
          unit: item.unit,
          cap: item.cap,
          amount: item.amount,
        })),
      })
      return parseReserveOutcome(data)
    },
    settle: async (reservationId, actuals) => {
      const data = await callRpc(rpc, SETTLE_RPC, {
        p_reservation_id: reservationId,
        p_actuals: actuals.map((a) => ({ period_key: a.periodKey, actual: a.actual })),
      })
      return parseSettleOutcome(data)
    },
  }
}

/** 调账本预留：账本实现抛异常也按「账本不可用」处理，绝不向上抛（fail-closed） */
export async function safeReserve(
  ledger: BudgetLedger,
  reservationId: string,
  purpose: BudgetPurpose,
  items: BudgetItem[],
): Promise<Result<ReserveOutcome>> {
  let result: Result<ReserveOutcome>
  try {
    result = await ledger.reserve(reservationId, purpose, items)
  } catch {
    return unavailable<ReserveOutcome>()
  }
  if (!result.ok) return result
  // 注入的账本实现不一定经过 createRpcLedger 的校验：在共用边界再验一次形状，
  // 只有 {ok:true, claimed:true} 才算批准；缺 claimed 或形状不认识一律当账本不可用（零外呼）
  return isValidReserveOutcome(result.value) ? result : unavailable<ReserveOutcome>()
}

/** ReserveOutcome 运行时形状校验（类型可以被替身绕过，运行时不行） */
function isValidReserveOutcome(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (value.ok === true) return value.claimed === true
  if (value.ok !== false) return false
  if (value.reason === 'cap_exceeded') return isNonEmptyString(value.deniedKey)
  if (value.reason === 'duplicate_reservation') return value.holdStatus === 'held' || value.holdStatus === 'settled'
  return false
}

/** 调账本结算：抛异常按「账本不可用」返回，hold 保持占用 */
export async function safeSettle(ledger: BudgetLedger, reservationId: string, actuals: SettleActual[]): Promise<Result<void>> {
  try {
    return await ledger.settle(reservationId, actuals)
  } catch {
    return unavailable<void>()
  }
}

/**
 * 只在拿到 {ok:true, claimed:true} 时调用一次 run，然后按实际值结算。
 * - 账本报错：零外呼，budget_ledger_unavailable
 * - cap_exceeded：零外呼，gate_blocked
 * - duplicate_reservation：零外呼，conflict（重放不得当通行证）
 * - run 抛错：不结算，hold 保持占用
 * - 结算失败：不吞错，hold 保持占用
 */
export async function withReservation<T>(
  ledger: BudgetLedger,
  spec: { id: string; purpose: BudgetPurpose; items: BudgetItem[] },
  run: () => Promise<{ value: T; actuals: SettleActual[] }>,
): Promise<Result<T>> {
  const reserved = await safeReserve(ledger, spec.id, spec.purpose, spec.items)
  if (!reserved.ok) return { ok: false, error: 'budget_ledger_unavailable', code: 'db_error' }

  const outcome = reserved.value
  if (!outcome.ok) {
    if (outcome.reason === 'cap_exceeded') {
      return { ok: false, error: `budget_cap_exceeded:${outcome.deniedKey}`, code: 'gate_blocked' }
    }
    return { ok: false, error: `duplicate_reservation:${outcome.holdStatus}`, code: 'conflict' }
  }

  let out: { value: T; actuals: SettleActual[] }
  try {
    out = await run()
  } catch {
    return { ok: false, error: 'run_failed_hold_kept', code: 'db_error' }
  }

  const settled = await safeSettle(ledger, spec.id, out.actuals)
  if (!settled.ok) return { ok: false, error: `settle_failed:${settled.error}`, code: 'db_error' }

  return { ok: true, value: out.value }
}
