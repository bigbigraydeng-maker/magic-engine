/**
 * X 读帖闸测试草稿（L56-P1.R6；落位前先放这里，稍后整体移入 __tests__）。
 * 覆盖契约 V20 之外的 T12、T13、T14、T16、T17 与常量 / key / 外推花费。
 * 只用 fake ledger 与 vi.fn 假外呼，不发真实 X 请求。
 */

import { describe, it, expect, vi } from 'vitest'
import { createFakeLedger } from '@/lib/agent-learning/budget/fake-ledger'
import { newAttemptId } from '@/lib/agent-learning/budget/reserve'
import {
  X_DAILY_READ_CAP,
  X_MONTHLY_READ_CAP,
  X_MONTHLY_USD_CAP,
  X_PRICE_PER_READ_USD,
  X_FIRST_BATCH_HANDLES,
  isFirstBatchHandle,
  xPeriodKeys,
  reserveXBudget,
  settleXBudget,
  projectMonthlyCostUsd,
  shouldStopForProjectedCost,
} from '@/lib/agent-learning/collect/x-limits'

/** 固定时钟：UTC 2026-10-25 03:00 */
const NOW = new Date('2026-10-25T03:00:00Z')

describe('x-limits 常量与首批名册', () => {
  it('硬上限与单价是契约里的数值', () => {
    expect(X_DAILY_READ_CAP).toBe(40)
    expect(X_MONTHLY_READ_CAP).toBe(900)
    expect(X_MONTHLY_USD_CAP).toBe(5)
    expect(X_PRICE_PER_READ_USD).toBe(0.005)
  })

  it('首批只读 10 个号', () => {
    expect(X_FIRST_BATCH_HANDLES).toHaveLength(10)
  })
})

describe('isFirstBatchHandle（T16）', () => {
  it('大小写、前导 @、首尾空白都不影响判定', () => {
    expect(isFirstBatchHandle('@GlennGabe')).toBe(true)
    expect(isFirstBatchHandle(' jonloomer ')).toBe(true)
  })

  it('名册外账号一律不通过', () => {
    expect(isFirstBatchHandle('rustybrick')).toBe(false)
    expect(isFirstBatchHandle('@randfish')).toBe(false)
  })

  it('清单里每个号都通过（含带 @ 的写法）', () => {
    for (const handle of X_FIRST_BATCH_HANDLES) {
      expect(isFirstBatchHandle(handle)).toBe(true)
      expect(isFirstBatchHandle(`@${handle}`)).toBe(true)
    }
  })
})

describe('xPeriodKeys', () => {
  it('按 UTC 给出日 / 月 / 月美元三个 key', () => {
    expect(xPeriodKeys(NOW)).toEqual({
      readsDay: 'x:reads:day:20261025',
      readsMonth: 'x:reads:month:202610',
      usdMonth: 'x:usd:month:202610',
    })
  })
})

describe('reserveXBudget 日上限（T12）', () => {
  it('4 批各 10 帖全部获批，第 5 批被日上限拒绝且零外呼', async () => {
    const ledger = createFakeLedger()
    const callX = vi.fn()
    const results: Array<Awaited<ReturnType<typeof reserveXBudget>>> = []

    for (let batch = 0; batch < 4; batch += 1) {
      const reservationId = newAttemptId('x', 'daily-batch', batch + 1)
      const reserved = await reserveXBudget(ledger, reservationId, { maxResults: 10 }, NOW)
      results.push(reserved)
      if (reserved.ok) callX()
    }

    expect(results.every((r) => r.ok)).toBe(true)
    expect(callX).toHaveBeenCalledTimes(4)
    expect(ledger.row(xPeriodKeys(NOW).readsDay)?.reserved).toBe(40)

    const fifth = await reserveXBudget(ledger, newAttemptId('x', 'daily-batch', 5), { maxResults: 1 }, NOW)
    expect(fifth).toEqual({ ok: false, reason: 'x_daily_cap' })
    expect(callX).toHaveBeenCalledTimes(4)
  })
})

describe('reserveXBudget 月上限（T13，同时覆盖 T17 的全有或全无）', () => {
  it('月读帖满后再读被拒，且当日额度一行都不占用', async () => {
    const ledger = createFakeLedger()
    const callX = vi.fn()

    // 预填：1..23 日，每天预留并结算 39 帖 → 月 spent 897
    for (let dayOfMonth = 1; dayOfMonth <= 23; dayOfMonth += 1) {
      const day = new Date(Date.UTC(2026, 9, dayOfMonth, 3))
      const reservationId = newAttemptId('x', `prefill-${dayOfMonth}`, 1)
      const reserved = await reserveXBudget(ledger, reservationId, { maxResults: 39 }, day)
      expect(reserved.ok).toBe(true)
      if (reserved.ok) callX()
      const settled = await settleXBudget(ledger, reservationId, { reads: 39 }, day)
      expect(settled.ok).toBe(true)
    }

    const monthRow = ledger.row('x:reads:month:202610')
    expect(monthRow?.spent).toBe(897)
    expect(monthRow?.reserved).toBe(0)

    // 第 24 日再要 10 帖：日额度够，月额度不够 → 整笔被拒
    const day24 = new Date(Date.UTC(2026, 9, 24, 3))
    const denied = await reserveXBudget(ledger, newAttemptId('x', 'prefill-24', 1), { maxResults: 10 }, day24)
    expect(denied).toEqual({ ok: false, reason: 'x_monthly_cap' })
    expect(callX).toHaveBeenCalledTimes(23)

    // 全有或全无：第 24 日的日额度行没有被占用
    expect(ledger.row('x:reads:day:20261024')).toBeUndefined()
    expect(ledger.row('x:reads:month:202610')?.reserved).toBe(0)
  })
})

describe('reserveXBudget 费用保险丝（T14）', () => {
  it('月美元余量不足时返回 x_cost_cap 且零外呼', async () => {
    const ledger = createFakeLedger()
    const callX = vi.fn()
    const keys = xPeriodKeys(NOW)

    const prefill = await ledger.reserve('prefill-usd', 'x_read', [
      { periodKey: keys.usdMonth, unit: 'usd', cap: X_MONTHLY_USD_CAP, amount: 4.99 },
    ])
    expect(prefill.ok).toBe(true)

    const reserved = await reserveXBudget(ledger, newAttemptId('x', 'cost-cap', 1), { maxResults: 10 }, NOW)
    if (reserved.ok) callX()

    expect(reserved).toEqual({ ok: false, reason: 'x_cost_cap' })
    expect(callX).toHaveBeenCalledTimes(0)
    expect(ledger.row(keys.readsDay)).toBeUndefined()
  })
})

describe('reserveXBudget 入参校验与失败注入', () => {
  it('非法 maxResults 直接 invalid_request，不调用账本', async () => {
    const ledger = createFakeLedger()

    for (const maxResults of [0, 41, 1.5]) {
      const reserved = await reserveXBudget(ledger, newAttemptId('x', 'invalid', 1), { maxResults }, NOW)
      expect(reserved).toEqual({ ok: false, reason: 'invalid_request' })
    }

    expect(ledger.reserveCalls).toBe(0)
  })

  it('账本抛错或报错都按不可用处理，零外呼', async () => {
    const throwLedger = createFakeLedger()
    throwLedger.failNext('reserve', 'throw')
    const thrown = await reserveXBudget(throwLedger, newAttemptId('x', 'boom', 1), { maxResults: 5 }, NOW)
    expect(thrown).toEqual({ ok: false, reason: 'budget_ledger_unavailable' })

    const errorLedger = createFakeLedger()
    errorLedger.failNext('reserve', 'error')
    const errored = await reserveXBudget(errorLedger, newAttemptId('x', 'boom', 2), { maxResults: 5 }, NOW)
    expect(errored).toEqual({ ok: false, reason: 'budget_ledger_unavailable' })
  })

  it('同一预留 ID 重复调用返回 duplicate_reservation', async () => {
    const ledger = createFakeLedger()
    const reservationId = newAttemptId('x', 'duplicate-unit', 1)

    const first = await reserveXBudget(ledger, reservationId, { maxResults: 5 }, NOW)
    expect(first.ok).toBe(true)

    const second = await reserveXBudget(ledger, reservationId, { maxResults: 5 }, NOW)
    expect(second).toEqual({ ok: false, reason: 'duplicate_reservation' })
    expect(ledger.row(xPeriodKeys(NOW).readsDay)?.reserved).toBe(5)
  })
})

describe('settleXBudget 按实际结算', () => {
  it('预留 10 帖、实际 7 帖：日读数记 7，美元记 7 × 单价', async () => {
    const ledger = createFakeLedger()
    const keys = xPeriodKeys(NOW)
    const reservationId = newAttemptId('x', 'settle-unit', 1)

    const reserved = await reserveXBudget(ledger, reservationId, { maxResults: 10 }, NOW)
    expect(reserved.ok).toBe(true)

    const settled = await settleXBudget(ledger, reservationId, { reads: 7 }, NOW)
    expect(settled.ok).toBe(true)

    const dayRow = ledger.row(keys.readsDay)
    expect(dayRow?.spent).toBe(7)
    expect(dayRow?.reserved).toBe(0)

    const usdRow = ledger.row(keys.usdMonth)
    expect(usdRow?.spent).toBeCloseTo(7 * X_PRICE_PER_READ_USD)
    expect(usdRow?.reserved).toBe(0)
  })
})

describe('月度花费外推', () => {
  it('(2 + 0.5) / 10 × 31 ≈ 7.75，判定超 5 美元要停读', () => {
    const usage = { spentUsd: 2, reservedUsd: 0.5, dayOfMonth: 10, daysInMonth: 31 }
    expect(projectMonthlyCostUsd(usage)).toBeCloseTo(7.75)
    expect(shouldStopForProjectedCost(usage)).toBe(true)
  })

  it('(1 + 0) / 15 × 30 = 2，不触发停读', () => {
    const usage = { spentUsd: 1, reservedUsd: 0, dayOfMonth: 15, daysInMonth: 30 }
    expect(projectMonthlyCostUsd(usage)).toBeCloseTo(2)
    expect(shouldStopForProjectedCost(usage)).toBe(false)
  })
})

describe('并发超限（T17）', () => {
  it('10 路并发各要 10 帖，恰好 4 路获批，其余 x_daily_cap', async () => {
    const ledger = createFakeLedger()
    const callX = vi.fn()
    const pending: Array<ReturnType<typeof reserveXBudget>> = []

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      pending.push(reserveXBudget(ledger, newAttemptId('x', 'concurrent', attempt), { maxResults: 10 }, NOW))
    }

    const results = await Promise.all(pending)
    for (const result of results) {
      if (result.ok) callX()
    }

    expect(results.filter((result) => result.ok)).toHaveLength(4)
    expect(callX).toHaveBeenCalledTimes(4)
    for (const result of results) {
      if (!result.ok) expect(result).toEqual({ ok: false, reason: 'x_daily_cap' })
    }
    expect(ledger.row(xPeriodKeys(NOW).readsDay)?.reserved).toBe(X_DAILY_READ_CAP)
  })
})
