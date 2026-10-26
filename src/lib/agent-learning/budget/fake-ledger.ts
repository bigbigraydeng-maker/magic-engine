/**
 * 内存版额度预留账本（L56-P1.R4）。
 * 与 2.7 的两个 SQL 函数同语义，供 L6c/L6d 的测试复用：
 * - reserve 是 async，但**检查与扣减之间没有 await**（全部同步完成），所以 Promise.all 并发安全；
 * - 全有或全无（任一 key 余额不够则一行都不改）；
 * - 同一 reservation_id 只能认领一次，重复（含结算后重放）一律 duplicate_reservation；
 * - 结算按实际值，重复结算不二次扣减，实际超过预留也如实记入 spent；
 * - failNext 只会生效一次，用来模拟「账本不可用 → 零外呼」。
 * 本文件不 import supabase / inngest / SDK。
 */

import type { Result } from '@/lib/agent-learning/contracts'
import type { BudgetItem, BudgetLedger, BudgetPurpose, ReserveOutcome, SettleActual } from './types'

/** 账本行快照（读出来的是副本，改它不会影响账本） */
export interface FakeRow {
  periodKey: string
  cap: number
  reserved: number
  spent: number
}

/** 预留占用快照（读出来的是副本） */
export interface FakeHold {
  reservationId: string
  periodKey: string
  amount: number
  status: 'held' | 'settled'
  actual: number | null
  purpose: BudgetPurpose
}

/** 测试用账本：除 BudgetLedger 外还暴露内部状态与一次性的失败注入 */
export interface FakeLedger extends BudgetLedger {
  rows(): FakeRow[]
  row(periodKey: string): FakeRow | undefined
  holds(): FakeHold[]
  reserveCalls: number
  settleCalls: number
  failNext(kind: 'reserve' | 'settle', mode: 'error' | 'throw'): void
}

/** 按 period_key 升序比较（与 2.7 的固定加锁顺序同口径） */
function comparePeriodKey(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/** 造一个内存账本；每次调用互相独立 */
export function createFakeLedger(): FakeLedger {
  const rowMap = new Map<string, FakeRow>()
  const holdList: FakeHold[] = []
  let reserveCalls = 0
  let settleCalls = 0
  let nextReserveFailure: 'error' | 'throw' | null = null
  let nextSettleFailure: 'error' | 'throw' | null = null

  async function reserve(
    reservationId: string,
    purpose: BudgetPurpose,
    items: BudgetItem[],
  ): Promise<Result<ReserveOutcome>> {
    reserveCalls += 1

    if (nextReserveFailure !== null) {
      const mode = nextReserveFailure
      nextReserveFailure = null
      if (mode === 'throw') throw new Error('fake_ledger_throw')
      return { ok: false, error: 'fake_ledger_error', code: 'db_error' }
    }

    // 同一 reservation_id 只能认领一次：重放一律拒绝，绝不当第二张通行证
    const existing = holdList.find((hold) => hold.reservationId === reservationId)
    if (existing !== undefined) {
      return {
        ok: true,
        value: { ok: false, reason: 'duplicate_reservation', holdStatus: existing.status },
      }
    }

    // 固定顺序，防死锁（与 SQL 函数同口径）
    const sorted = [...items].sort((left, right) => comparePeriodKey(left.periodKey, right.periodKey))

    // 先算不落库：任一行不够就整笔拒绝，且一行都不改
    const planned: Array<{ item: BudgetItem; cap: number }> = []
    const plannedByKey = new Map<string, number>()

    for (const item of sorted) {
      const stored = rowMap.get(item.periodKey)
      const effectiveCap = stored === undefined ? item.cap : Math.min(item.cap, stored.cap)
      const storedUsed = stored === undefined ? 0 : stored.reserved + stored.spent
      const plannedUsed = plannedByKey.get(item.periodKey) ?? 0
      if (storedUsed + plannedUsed + item.amount > effectiveCap) {
        return { ok: true, value: { ok: false, reason: 'cap_exceeded', deniedKey: item.periodKey } }
      }
      plannedByKey.set(item.periodKey, plannedUsed + item.amount)
      planned.push({ item, cap: effectiveCap })
    }

    // 全部满足才落库：建行、把较小 cap 写回、加占用、写 hold
    for (const entry of planned) {
      const stored = rowMap.get(entry.item.periodKey)
      if (stored === undefined) {
        rowMap.set(entry.item.periodKey, {
          periodKey: entry.item.periodKey,
          cap: entry.cap,
          reserved: entry.item.amount,
          spent: 0,
        })
      } else {
        stored.cap = entry.cap
        stored.reserved += entry.item.amount
      }
      holdList.push({
        reservationId,
        periodKey: entry.item.periodKey,
        amount: entry.item.amount,
        status: 'held',
        actual: null,
        purpose,
      })
    }

    return { ok: true, value: { ok: true, claimed: true } }
  }

  async function settle(reservationId: string, actuals: SettleActual[]): Promise<Result<void>> {
    settleCalls += 1

    if (nextSettleFailure !== null) {
      const mode = nextSettleFailure
      nextSettleFailure = null
      if (mode === 'throw') throw new Error('fake_ledger_throw')
      return { ok: false, error: 'fake_ledger_error', code: 'db_error' }
    }

    const related = holdList.filter((hold) => hold.reservationId === reservationId)
    if (related.length === 0) {
      return { ok: false, error: 'unknown_reservation', code: 'not_found' }
    }

    const held = related.filter((hold) => hold.status === 'held')
    // 重复结算：成功但不二次扣减
    if (held.length === 0) return { ok: true, value: undefined }

    for (const hold of held) {
      const match = actuals.find((entry) => entry.periodKey === hold.periodKey)
      const actual = match === undefined ? hold.amount : match.actual
      const row = rowMap.get(hold.periodKey)
      if (row !== undefined) {
        row.reserved -= hold.amount
        row.spent += actual
      }
      hold.status = 'settled'
      hold.actual = actual
    }

    return { ok: true, value: undefined }
  }

  return {
    reserve,
    settle,
    rows: () =>
      [...rowMap.values()].map((row) => ({ ...row })).sort((left, right) => comparePeriodKey(left.periodKey, right.periodKey)),
    row: (periodKey: string) => {
      const stored = rowMap.get(periodKey)
      return stored === undefined ? undefined : { ...stored }
    },
    holds: () => holdList.map((hold) => ({ ...hold })),
    get reserveCalls() {
      return reserveCalls
    },
    get settleCalls() {
      return settleCalls
    },
    failNext(kind: 'reserve' | 'settle', mode: 'error' | 'throw') {
      if (kind === 'reserve') {
        nextReserveFailure = mode
      } else {
        nextSettleFailure = mode
      }
    },
  }
}
