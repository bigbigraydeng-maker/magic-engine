/**
 * L56-P1.R4 验收用例草稿（T17–T21，对应契约 2.7 / 7.7 / L6 验收用例）。
 * 暂时放在 budget/ 根目录，之后整体移到 budget/__tests__/reserve.test.ts。
 */

import { describe, it, expect, vi } from 'vitest'
import { createFakeLedger } from '@/lib/agent-learning/budget/fake-ledger'
import { createRpcLedger, newAttemptId, periodKeys, withReservation, RESERVE_RPC, SETTLE_RPC } from '@/lib/agent-learning/budget/reserve'
import type { BudgetItem, BudgetLedger, ReserveOutcome } from '@/lib/agent-learning/budget/types'
import type { Result } from '@/lib/agent-learning/contracts'

/** createRpcLedger 的入参形状（避免 import RpcFn，同时不出现 any） */
type RpcStub = Parameters<typeof createRpcLedger>[0]

/** 造一条预留项，省掉重复字面量 */
function budgetItem(periodKey: string, unit: BudgetItem['unit'], cap: number, amount: number): BudgetItem {
  return { periodKey, unit, cap, amount }
}

describe('额度预留账本（2.7）', () => {
  it('T17a: 并发 10 路只成功 cap 允许的 3 路，被拒的零外呼', async () => {
    const ledger = createFakeLedger()
    const key = 'distill:items:day:20261025'
    const items = [budgetItem(key, 'items', 3, 1)]
    const run = vi.fn(async () => ({ value: 'ok', actuals: [{ periodKey: key, actual: 1 }] }))

    const results = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        withReservation(ledger, { id: newAttemptId('distill', 'u1', index), purpose: 'distill', items }, run),
      ),
    )

    const succeeded = results.filter((result) => result.ok)
    const rejected = results.filter((result) => !result.ok)
    expect(succeeded).toHaveLength(3)
    expect(rejected).toHaveLength(7)

    for (const result of rejected) {
      if (!result.ok) {
        expect(result.code).toBe('gate_blocked')
        expect(result.error).toContain('budget_cap_exceeded')
      }
    }

    expect(run).toHaveBeenCalledTimes(3)

    const row = ledger.row(key)
    if (row === undefined) throw new Error('missing ledger row')
    expect(row.reserved + row.spent).toBe(3)
  })

  it('T17b: 多 key 全有或全无，日额度不被占用', async () => {
    const ledger = createFakeLedger()
    const dayKey = 'x:reads:day:20261025'
    const monthKey = 'x:reads:month:202610'

    // 先让日账本行存在（一笔已结算的读帖）
    const seedId = newAttemptId('x', 'seed', 1)
    const seeded = await ledger.reserve(seedId, 'x_read', [budgetItem(dayKey, 'reads', 40, 1)])
    if (!seeded.ok) throw new Error('seed reserve unavailable')
    if (!seeded.value.ok) throw new Error('seed reserve denied')
    const seedSettled = await ledger.settle(seedId, [{ periodKey: dayKey, actual: 1 }])
    expect(seedSettled.ok).toBe(true)

    const run = vi.fn(async () => ({ value: 'ok', actuals: [{ periodKey: dayKey, actual: 1 }] }))
    const result = await withReservation(
      ledger,
      {
        id: newAttemptId('x', 'u1', 1),
        purpose: 'x_read',
        items: [budgetItem(dayKey, 'reads', 40, 1), budgetItem(monthKey, 'reads', 0.5, 1)],
      },
      run,
    )

    if (result.ok) throw new Error('expected denial')
    expect(result.code).toBe('gate_blocked')
    expect(result.error).toContain(monthKey)
    expect(run).toHaveBeenCalledTimes(0)

    const dayRow = ledger.row(dayKey)
    if (dayRow === undefined) throw new Error('missing day row')
    expect(dayRow.reserved).toBe(0)
    expect(ledger.row(monthKey)).toBeUndefined()
  })

  it('T18: run 抛错 → 保留占用、不自动释放、后续预留看到已扣余量', async () => {
    const ledger = createFakeLedger()
    const key = 'distill:items:day:20261025'

    const throwingRun = vi.fn(async () => {
      throw new Error('boom')
    })
    const first = await withReservation(
      ledger,
      { id: newAttemptId('distill', 'u1', 1), purpose: 'distill', items: [budgetItem(key, 'items', 1, 1)] },
      throwingRun,
    )

    if (first.ok) throw new Error('expected run failure')
    expect(first.error).toBe('run_failed_hold_kept')

    const holds = ledger.holds()
    expect(holds).toHaveLength(1)
    const hold = holds[0]
    if (hold === undefined) throw new Error('missing hold')
    expect(hold.status).toBe('held')

    const row = ledger.row(key)
    if (row === undefined) throw new Error('missing ledger row')
    expect(row.reserved).toBe(1)
    expect(row.spent).toBe(0)

    const secondRun = vi.fn(async () => ({ value: 'ok', actuals: [{ periodKey: key, actual: 1 }] }))
    const second = await withReservation(
      ledger,
      { id: newAttemptId('distill', 'u1', 2), purpose: 'distill', items: [budgetItem(key, 'items', 1, 1)] },
      secondRun,
    )
    if (second.ok) throw new Error('expected cap denial')
    expect(second.error).toContain('cap_exceeded')
    expect(secondRun).toHaveBeenCalledTimes(0)
  })

  it('T19: 账本不可用一律零外呼，参数名按 2.7，重复预留被拒', async () => {
    const key = 'distill:usd:day:20261025'
    const items = [budgetItem(key, 'usd', 0.2, 0.1)]
    const run = vi.fn(async () => ({ value: 'ok', actuals: [{ periodKey: key, actual: 0.05 }] }))

    const rpcErrorReply = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: null,
      error: { message: 'x' },
    }))
    const rpcThrows = vi.fn(async (_fn: string, _args: Record<string, unknown>) => {
      throw new Error('rpc down')
    })
    const rpcMissingClaimed = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: { ok: true },
      error: null,
    }))
    const rpcWeird = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: 'weird', error: null }))

    const rpcs: RpcStub[] = [rpcErrorReply, rpcThrows, rpcMissingClaimed, rpcWeird]

    for (const rpc of rpcs) {
      const result = await withReservation(
        createRpcLedger(rpc),
        { id: newAttemptId('distill', 'u1', 1), purpose: 'distill', items },
        run,
      )
      if (result.ok) throw new Error('expected budget_ledger_unavailable')
      expect(result.error).toBe('budget_ledger_unavailable')
      expect(result.code).toBe('db_error')
    }
    expect(run).toHaveBeenCalledTimes(0)

    // 参数名与条目字段名按 2.7
    const call = rpcMissingClaimed.mock.calls[0]
    if (call === undefined) throw new Error('rpc not called')
    expect(call[0]).toBe(RESERVE_RPC)
    const args = call[1]
    expect(Object.keys(args).sort()).toEqual(['p_items', 'p_purpose', 'p_reservation_id'])
    expect(args.p_purpose).toBe('distill')
    expect(typeof args.p_reservation_id).toBe('string')
    expect(args.p_items).toEqual([{ period_key: key, unit: 'usd', cap: 0.2, amount: 0.1 }])

    // 重放同一 reservation_id：拒绝、零外呼
    const rpcDuplicate = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: { ok: false, reason: 'duplicate_reservation', hold_status: 'settled' },
      error: null,
    }))
    const duplicateRun = vi.fn(async () => ({ value: 'ok', actuals: [{ periodKey: key, actual: 0.05 }] }))
    const duplicate = await withReservation(
      createRpcLedger(rpcDuplicate),
      { id: newAttemptId('distill', 'u1', 1), purpose: 'distill', items },
      duplicateRun,
    )
    if (duplicate.ok) throw new Error('expected duplicate rejection')
    expect(duplicate.error).toBe('duplicate_reservation:settled')
    expect(duplicate.code).toBe('conflict')
    expect(duplicateRun).toHaveBeenCalledTimes(0)
  })

  it('T20: 按实际结算、重复结算不二次扣减、超额如实记账', async () => {
    const ledger = createFakeLedger()
    const key = 'x:reads:day:20261025'
    const id = newAttemptId('x', 'post-1', 1)

    const first = await withReservation(
      ledger,
      { id, purpose: 'x_read', items: [budgetItem(key, 'reads', 40, 10)] },
      async () => ({ value: 'done', actuals: [{ periodKey: key, actual: 4 }] }),
    )
    if (!first.ok) throw new Error('expected success')

    const row = ledger.row(key)
    if (row === undefined) throw new Error('missing ledger row')
    expect(row.reserved).toBe(0)
    expect(row.spent).toBe(4)

    const again = await ledger.settle(id, [{ periodKey: key, actual: 4 }])
    expect(again.ok).toBe(true)
    const afterReplay = ledger.row(key)
    if (afterReplay === undefined) throw new Error('missing ledger row')
    expect(afterReplay.spent).toBe(4)

    // 实际超过预留（也超过 cap）：如实记入 spent，后续预留被拒
    const overKey = 'x:reads:day:20261026'
    const over = await withReservation(
      ledger,
      { id: newAttemptId('x', 'post-2', 1), purpose: 'x_read', items: [budgetItem(overKey, 'reads', 5, 1)] },
      async () => ({ value: 'done', actuals: [{ periodKey: overKey, actual: 7 }] }),
    )
    if (!over.ok) throw new Error('expected success')

    const overRow = ledger.row(overKey)
    if (overRow === undefined) throw new Error('missing ledger row')
    expect(overRow.spent).toBe(7)
    expect(overRow.reserved).toBe(0)

    const deniedRun = vi.fn(async () => ({ value: 'nope', actuals: [{ periodKey: overKey, actual: 1 }] }))
    const denied = await withReservation(
      ledger,
      { id: newAttemptId('x', 'post-3', 1), purpose: 'x_read', items: [budgetItem(overKey, 'reads', 5, 1)] },
      deniedRun,
    )
    if (denied.ok) throw new Error('expected cap denial')
    expect(denied.error).toContain('cap_exceeded')
    expect(deniedRun).toHaveBeenCalledTimes(0)
  })

  it('T21: 同一预留 ID 只认领一次，结算后重放被拒，重试换新 ID 重新占用', async () => {
    const ledger = createFakeLedger()
    const key = 'distill:items:day:20261025'
    const items = [budgetItem(key, 'items', 3, 1)]
    const id = newAttemptId('distill', 'u1', 1)
    const run = vi.fn(async () => ({ value: 1, actuals: [{ periodKey: key, actual: 1 }] }))

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        withReservation(ledger, { id, purpose: 'distill', items }, run),
      ),
    )

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(run).toHaveBeenCalledTimes(1)
    for (const result of results) {
      if (!result.ok) expect(result.error).toMatch(/^duplicate_reservation:(held|settled)$/)
    }

    const spentBeforeReplay = ledger.row(key)?.spent ?? -1
    const replayRun = vi.fn(async () => ({ value: 1, actuals: [{ periodKey: key, actual: 1 }] }))
    const replay = await withReservation(ledger, { id, purpose: 'distill', items }, replayRun)
    if (replay.ok) throw new Error('expected replay rejection')
    expect(replay.error).toBe('duplicate_reservation:settled')
    expect(replayRun).toHaveBeenCalledTimes(0)
    expect(ledger.row(key)?.spent ?? -1).toBe(spentBeforeReplay)

    // 重试必须换新 ID，并重新占用额度
    const freshReserve = await ledger.reserve(newAttemptId('distill', 'u1', 2), 'distill', items)
    if (!freshReserve.ok) throw new Error('fresh reserve unavailable')
    if (!freshReserve.value.ok) throw new Error('fresh reserve denied')
    const freshRow = ledger.row(key)
    if (freshRow === undefined) throw new Error('missing ledger row')
    expect(freshRow.reserved).toBe(1)
  })

  it('failNext: 一次性的 error / throw 注入', async () => {
    const ledger = createFakeLedger()
    const key = 'distill:items:day:20261025'

    ledger.failNext('reserve', 'error')
    const first = await ledger.reserve('rid-1', 'distill', [budgetItem(key, 'items', 1, 1)])
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.error).toBe('fake_ledger_error')
    expect(ledger.reserveCalls).toBe(1)

    const second = await ledger.reserve('rid-2', 'distill', [budgetItem(key, 'items', 1, 1)])
    expect(second.ok).toBe(true)

    ledger.failNext('settle', 'throw')
    await expect(ledger.settle('rid-2', [])).rejects.toThrow('fake_ledger_throw')
    expect(ledger.settleCalls).toBe(1)
  })

  it('newAttemptId: 100 次互不相同且格式正确', () => {
    const ids = new Set<string>()
    for (let index = 0; index < 100; index += 1) ids.add(newAttemptId('distill', 'u1', 2))

    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(/^distill:u1:2:[0-9a-f-]{36}$/)
  })

  it('periodKeys: UTC 口径，不按新西兰时间', () => {
    const at = new Date('2026-10-24T23:30:00Z')
    expect(periodKeys('distill', at)).toEqual({ day: '20261024', month: '202610' })
    expect(periodKeys('x', at)).toEqual({ day: '20261024', month: '202610' })
  })

  it('createRpcLedger.settle: 调用 SETTLE_RPC 且参数名按 2.7', async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: { ok: true }, error: null }))
    const ledger = createRpcLedger(rpc)
    const periodKey = 'distill:usd:day:20261025'

    const settled = await ledger.settle('rid-settle', [{ periodKey, actual: 0.03 }])
    expect(settled.ok).toBe(true)

    const call = rpc.mock.calls[0]
    if (call === undefined) throw new Error('rpc not called')
    expect(call[0]).toBe(SETTLE_RPC)
    expect(call[1]).toEqual({
      p_reservation_id: 'rid-settle',
      p_actuals: [{ period_key: periodKey, actual: 0.03 }],
    })
  })
})

describe('shared boundary rejects an approval without claimed:true (Codex P2)', () => {
  it('withReservation, reserveDistillBudget and reserveXBudget all make zero calls', async () => {
    const { reserveDistillBudget } = await import('@/lib/agent-learning/distill/cost-gate')
    const { reserveXBudget } = await import('@/lib/agent-learning/collect/x-limits')
    const { safeReserve } = await import('@/lib/agent-learning/budget/reserve')
    // 注入的账本绕过了 createRpcLedger 的校验，返回缺 claimed 的「批准」
    const missingClaimed: Result<ReserveOutcome> = JSON.parse('{"ok":true,"value":{"ok":true}}')
    const ledger: BudgetLedger = {
      reserve: async () => missingClaimed,
      settle: async () => ({ ok: true, value: undefined }),
    }
    const run = vi.fn(async () => ({ value: 1, actuals: [] }))
    const now = new Date('2026-10-25T03:00:00Z')

    const viaWrapper = await withReservation(ledger, { id: 'distill:u:1:x', purpose: 'distill', items: [{ periodKey: 'k', unit: 'usd', cap: 1, amount: 0.1 }] }, run)
    expect(viaWrapper.ok).toBe(false)
    if (viaWrapper.ok) throw new Error('expected failure')
    expect(viaWrapper.error).toBe('budget_ledger_unavailable')
    expect(run).not.toHaveBeenCalled()

    expect(await reserveDistillBudget(ledger, 'distill:u:1:y', 0.0042, now)).toEqual({ ok: false, reason: 'budget_ledger_unavailable' })
    expect(await reserveXBudget(ledger, 'x:u:1:z', { maxResults: 5 }, now)).toEqual({ ok: false, reason: 'budget_ledger_unavailable' })

    const direct = await safeReserve(ledger, 'distill:u:1:w', 'distill', [{ periodKey: 'k', unit: 'usd', cap: 1, amount: 0.1 }])
    expect(direct.ok).toBe(false)
  })
})
