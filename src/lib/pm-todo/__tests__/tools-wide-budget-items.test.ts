import { describe, expect, it, vi } from 'vitest'
import { pushToolsWideBudgetItems, toolsWideBudgetAlert, TOOLS_WIDE_BUDGET_WARN_PCT } from '../tools-wide-budget-items'
import { TOOLS_AI_CALLS_MONTHLY_CAP } from '@/lib/tools-lab/spend-cap'
import type { ManualItem } from '../manual-items'

describe('toolsWideBudgetAlert (pure function)', () => {
  it('still early: 0/2000 does not warn', () => {
    expect(toolsWideBudgetAlert(0, 2000)).toEqual({ level: 'none', pct: 0, count: 0 })
  })
  it('exactly 80% warns', () => {
    expect(toolsWideBudgetAlert(1600, 2000)).toEqual({ level: 'warn', pct: 80, count: 1600 })
  })
  it('just under 80% does not warn', () => {
    expect(toolsWideBudgetAlert(1589, 2000)).toEqual({ level: 'none', pct: 79, count: 1589 })
  })
  it('at the cap counts as full', () => {
    expect(toolsWideBudgetAlert(2000, 2000)).toEqual({ level: 'full', pct: 100, count: 2000 })
  })
  it('over the cap still counts as full (the RPC already refused new calls by then)', () => {
    expect(toolsWideBudgetAlert(2003, 2000)).toEqual({ level: 'full', pct: 100, count: 2003 })
  })
  it('cap of 0 counts as full, never divides by zero', () => {
    expect(toolsWideBudgetAlert(5, 0)).toEqual({ level: 'full', pct: 100, count: 5 })
  })
  it('negative cap also counts as full', () => {
    expect(toolsWideBudgetAlert(5, -1)).toEqual({ level: 'full', pct: 100, count: 5 })
  })
  it('the warn threshold is 80', () => {
    expect(TOOLS_WIDE_BUDGET_WARN_PCT).toBe(80)
  })
})

/**
 * 假的 `zhangqian_scan_rate_limits` 查询。
 *
 * 形状不是猜的：**已核实**生产侧 `pushToolsWideBudgetItems`（../tools-wide-budget-items.ts）对 supabase
 * 只用这一条链 —— `.from().select().eq().eq().eq().maybeSingle()`，止步于 `.maybeSingle()`。少一个方法
 * 这个假对象都不需要，多一个测试会当场炸（"the read failing" 那条用例已跑，见文件末）。
 */
function fakeSupabase(row: { count: number } | null, error: { message: string } | null = null) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({ data: row, error }))
  return { from: vi.fn(() => chain) } as unknown as Parameters<typeof pushToolsWideBudgetItems>[0]
}

async function run(row: { count: number } | null, error: { message: string } | null = null): Promise<ManualItem[]> {
  const items: ManualItem[] = []
  await pushToolsWideBudgetItems(fakeSupabase(row, error), items, new Date('2026-09-28T00:00:00Z'))
  return items
}

describe('pushToolsWideBudgetItems', () => {
  it('no row yet this month → treated as 0 used, no item', async () => {
    await expect(run(null)).resolves.toEqual([])
  })

  it('below 80% → no item', async () => {
    await expect(run({ count: 100 })).resolves.toEqual([])
  })

  it('at 80% → one item, names the current count and cap, decide lane', async () => {
    const items = await run({ count: Math.round(TOOLS_AI_CALLS_MONTHLY_CAP * 0.8) })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('tools_wide_budget_warning')
    expect(items[0].client_id).toBe('infra')
    expect(items[0].what).toContain(String(TOOLS_AI_CALLS_MONTHLY_CAP))
    expect(items[0].what).toContain('快用完')
  })

  it('at the cap → "used up" wording, not "getting close"', async () => {
    const items = await run({ count: TOOLS_AI_CALLS_MONTHLY_CAP })
    expect(items[0].what).toContain('用满了')
  })

  it('a read failure throws (caught by the caller in manual-items.ts, not swallowed here)', async () => {
    await expect(run(null, { message: 'down' })).rejects.toThrow('down')
  })
})
