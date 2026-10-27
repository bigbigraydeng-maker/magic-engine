/**
 * 每日花费账本（持久化版）：对 migration 20261027200000 的两个 SQL 函数做薄封装。
 * 预留是库里的单条条件 UPDATE，重启 / 多实例都不会超过上限。
 * 任何异常、错误、不认识的返回形状一律"账本不可用"，调用方零外呼（fail-closed）。
 * 日口径：UTC 自然日（与蒸馏账本一致）。
 * 没有复用 budget/reserve.ts：它绑定契约 2.7 的函数名、purpose 与 period_key 模型，L2 还没落地；
 * 这里只借用同样的"严格解析、异常即不可用"写法。
 */
import type { Result } from '@/lib/agent-learning/contracts'

export interface TrialSpendStore {
  reserve(day: string, amount: number, cap: number): Promise<Result<{ claimed: boolean }>>
  settle(day: string, reserved: number, actual: number): Promise<Result<void>>
}

export type RpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>

function unavailable<T>(): Result<T> {
  return { ok: false, error: 'budget_ledger_unavailable', code: 'db_error' }
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

async function call(rpc: RpcFn, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await rpc(fn, args)
    if (!res || res.error !== null) return null
    return typeof res.data === 'object' && res.data !== null && !Array.isArray(res.data)
      ? (res.data as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function createRpcTrialStore(rpc: RpcFn): TrialSpendStore {
  return {
    reserve: async (day, amount, cap) => {
      const d = await call(rpc, 'agent_learning_trial_reserve', { p_day: day, p_amount: amount, p_cap: cap })
      if (d?.ok === true && d.claimed === true) return { ok: true, value: { claimed: true } }
      if (d?.ok === false && d.reason === 'cap_exceeded') return { ok: true, value: { claimed: false } }
      return unavailable()
    },
    settle: async (day, reserved, actual) => {
      const d = await call(rpc, 'agent_learning_trial_settle', { p_day: day, p_reserved: reserved, p_actual: actual })
      return d?.ok === true ? { ok: true, value: undefined } : unavailable()
    },
  }
}

export async function reserveTrialBudget(
  store: TrialSpendStore,
  now: Date,
  amount: number,
  cap: number,
): Promise<Result<void>> {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'invalid_request', code: 'validation' }
  let res: Result<{ claimed: boolean }>
  try {
    res = await store.reserve(utcDay(now), amount, cap)
  } catch {
    return unavailable()
  }
  if (!res.ok) return unavailable()
  if (!res.value.claimed) return { ok: false, error: 'daily_budget_used_up', code: 'gate_blocked' }
  return { ok: true, value: undefined }
}

export async function settleTrialBudget(
  store: TrialSpendStore,
  now: Date,
  reserved: number,
  actual: number,
): Promise<Result<void>> {
  try {
    const res = await store.settle(utcDay(now), reserved, actual)
    return res.ok ? { ok: true, value: undefined } : unavailable()
  } catch {
    return unavailable()
  }
}
