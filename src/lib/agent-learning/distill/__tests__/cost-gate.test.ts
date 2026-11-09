/**
 * 蒸馏成本闸测试草稿（L56-P1.R6；落位前先放这里，稍后整体移入 __tests__）。
 * 覆盖契约步骤 3「成本闸」与 T7、T17、T19 的调用方行为：预留被拒就零外呼。
 * 只用 fake ledger 与 vi.fn 假 LLM 调用，不发真实请求。
 */

import { describe, it, expect, vi } from 'vitest'
import { createFakeLedger } from '@/lib/agent-learning/budget/fake-ledger'
import { newAttemptId } from '@/lib/agent-learning/budget/reserve'
import {
  DISTILL_DAILY_ITEM_CAP,
  DISTILL_DAILY_USD_CAP,
  DISTILL_MAX_INPUT_TOKENS,
  DISTILL_MAX_OUTPUT_TOKENS,
  distillPeriodKeys,
  estimateWorstCaseUsd,
  reserveDistillBudget,
  settleDistillBudget,
} from '@/lib/agent-learning/distill/cost-gate'
import { DEEPSEEK_FLASH_PRICE } from '@/lib/agent-learning/llm/deepseek-client'

/** 固定时钟：UTC 2026-10-25 03:00 */
const NOW = new Date('2026-10-25T03:00:00Z')

/** 按最坏用量算一次蒸馏的美元花费（测试里多处复用） */
function worstCase(): number {
  return estimateWorstCaseUsd(
    { maxInputTokens: DISTILL_MAX_INPUT_TOKENS, maxOutputTokens: DISTILL_MAX_OUTPUT_TOKENS },
    DEEPSEEK_FLASH_PRICE,
  )
}

describe('cost-gate 常量与最坏用量', () => {
  it('硬上限是契约里的数值', () => {
    expect(DISTILL_DAILY_ITEM_CAP).toBe(30)
    expect(DISTILL_DAILY_USD_CAP).toBe(0.2)
    expect(DISTILL_MAX_INPUT_TOKENS).toBe(8000)
    expect(DISTILL_MAX_OUTPUT_TOKENS).toBe(1500)
  })

  it('8k 输入 + 1.5k 输出的最坏用量约 0.0042 美元', () => {
    expect(worstCase()).toBeCloseTo(0.0042)
  })

  it('蒸馏 key 按 UTC 日', () => {
    expect(distillPeriodKeys(NOW)).toEqual({
      itemsDay: 'distill:items:day:20261025',
      usdDay: 'distill:usd:day:20261025',
    })
  })
})

describe('每日条数上限（T7a）', () => {
  it('31 条里前 30 条获批，第 31 条 daily_item_cap 且零外呼', async () => {
    const ledger = createFakeLedger()
    const callLlm = vi.fn()
    const denials: string[] = []

    for (let attempt = 1; attempt <= 31; attempt += 1) {
      const reservationId = newAttemptId('distill', 't7a-item', attempt)
      const reserved = await reserveDistillBudget(ledger, reservationId, 0.001, NOW)
      if (reserved.ok) {
        callLlm()
      } else {
        denials.push(reserved.reason)
      }
    }

    expect(callLlm).toHaveBeenCalledTimes(30)
    expect(callLlm).toHaveBeenCalledTimes(DISTILL_DAILY_ITEM_CAP)
    expect(denials).toEqual(['daily_item_cap'])
    expect(ledger.reserveCalls).toBe(31)
  })
})

describe('每日花费上限（T7b）', () => {
  it('每条 0.05 美元时恰好 4 条获批，第 5 条 daily_cost_cap 且零外呼', async () => {
    const ledger = createFakeLedger()
    const callLlm = vi.fn()
    const denials: string[] = []

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const reservationId = newAttemptId('distill', 't7b-item', attempt)
      const reserved = await reserveDistillBudget(ledger, reservationId, 0.05, NOW)
      if (reserved.ok) {
        callLlm()
      } else {
        denials.push(reserved.reason)
      }
    }

    expect(callLlm).toHaveBeenCalledTimes(4)
    expect(denials).toEqual(['daily_cost_cap'])
    // 4 × 0.05 = 0.20 必须获批（浮点累加不能把它判成超额）
    expect(ledger.row(distillPeriodKeys(NOW).usdDay)?.reserved).toBeCloseTo(DISTILL_DAILY_USD_CAP)
  })
})

describe('并发超限（T17）', () => {
  it('10 路并发各 0.06 美元，恰好 3 路获批，其余 daily_cost_cap', async () => {
    const ledger = createFakeLedger()
    const callLlm = vi.fn()
    const pending: Array<ReturnType<typeof reserveDistillBudget>> = []

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      pending.push(reserveDistillBudget(ledger, newAttemptId('distill', 'concurrent', attempt), 0.06, NOW))
    }

    const results = await Promise.all(pending)
    for (const result of results) {
      if (result.ok) callLlm()
    }

    expect(callLlm).toHaveBeenCalledTimes(3)
    expect(results.filter((result) => result.ok)).toHaveLength(3)
    for (const result of results) {
      if (!result.ok) expect(result).toEqual({ ok: false, reason: 'daily_cost_cap' })
    }
  })
})

describe('settleDistillBudget 按实际结算', () => {
  it('按最坏值预留、按实际值结算：美元记实际，条数记 1', async () => {
    const ledger = createFakeLedger()
    const keys = distillPeriodKeys(NOW)
    const reservationId = newAttemptId('distill', 'settle-unit', 1)

    const reserved = await reserveDistillBudget(ledger, reservationId, worstCase(), NOW)
    expect(reserved.ok).toBe(true)

    const settled = await settleDistillBudget(ledger, reservationId, 0.001, NOW)
    expect(settled.ok).toBe(true)

    const usdRow = ledger.row(keys.usdDay)
    expect(usdRow?.spent).toBeCloseTo(0.001)
    expect(usdRow?.reserved).toBeCloseTo(0)

    const itemsRow = ledger.row(keys.itemsDay)
    expect(itemsRow?.spent).toBe(1)
    expect(itemsRow?.reserved).toBe(0)
  })
})

describe('reserveDistillBudget 入参校验与失败注入', () => {
  it('非法最坏用量直接 invalid_request，不调用账本', async () => {
    const ledger = createFakeLedger()

    for (const invalid of [0, Number.NaN, -1]) {
      const reserved = await reserveDistillBudget(ledger, newAttemptId('distill', 'invalid', 1), invalid, NOW)
      expect(reserved).toEqual({ ok: false, reason: 'invalid_request' })
    }

    expect(ledger.reserveCalls).toBe(0)
  })

  it('账本抛错按不可用处理（T19），零外呼', async () => {
    const ledger = createFakeLedger()
    const callLlm = vi.fn()
    ledger.failNext('reserve', 'throw')

    const reserved = await reserveDistillBudget(ledger, newAttemptId('distill', 'boom', 1), 0.001, NOW)
    if (reserved.ok) callLlm()

    expect(reserved).toEqual({ ok: false, reason: 'budget_ledger_unavailable' })
    expect(callLlm).toHaveBeenCalledTimes(0)
  })
})
