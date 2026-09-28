/**
 * `fetchClientDailySpendCents`：按天汇总 `ad_daily_insights` 真实花费，
 * 美元转分，today 从 recentDailySpend 里剔除。
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchClientDailySpendCents } from '../circuit-breaker-spend'

const CLIENT = 'client-uuid-spend-test'

interface Row {
  insight_date: string
  entity_id: string
  spend: number | null
}

/** 单页返回全部行（用例都 ≤5 行，远低于 fetchAll 的 1000 页大小，一页就到底）。 */
function fakeSupabase(rows: Row[], errorMessage?: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    range: async (_from: number, _to: number) =>
      errorMessage ? { data: null, error: { message: errorMessage } } : { data: rows, error: null },
  }
  return {
    from: (table: string) => {
      if (table !== 'ad_daily_insights') throw new Error('unexpected table ' + table)
      return chain
    },
  } as unknown as SupabaseClient
}

describe('fetchClientDailySpendCents', () => {
  it('按 insight_date 汇总多条 campaign 行，美元转分', async () => {
    const sb = fakeSupabase([
      { insight_date: '2026-09-27', entity_id: 'c1', spend: 10.5 },
      { insight_date: '2026-09-27', entity_id: 'c2', spend: 5.25 }, // 同一天两个 campaign，应相加
      { insight_date: '2026-09-26', entity_id: 'c1', spend: 20 },
    ])
    const result = await fetchClientDailySpendCents(sb, CLIENT, '2026-09-27', 7)
    expect(result).not.toBeNull()
    expect(result?.todayTotalSpendCents).toBe(1575) // (10.5+5.25) * 100
    expect(result?.recentDailySpend).toContainEqual({ date: '2026-09-26', totalSpendCents: 2000 })
  })

  it('today 不出现在 recentDailySpend 里', async () => {
    const sb = fakeSupabase([{ insight_date: '2026-09-27', entity_id: 'c1', spend: 100 }])
    const result = await fetchClientDailySpendCents(sb, CLIENT, '2026-09-27', 7)
    expect(result?.recentDailySpend.some((e) => e.date === '2026-09-27')).toBe(false)
  })

  it('spend 为 null 当 0 处理', async () => {
    const sb = fakeSupabase([{ insight_date: '2026-09-26', entity_id: 'c1', spend: null }])
    const result = await fetchClientDailySpendCents(sb, CLIENT, '2026-09-27', 7)
    expect(result?.recentDailySpend).toContainEqual({ date: '2026-09-26', totalSpendCents: 0 })
  })

  it('无历史行也返回今天的合计（今天 0 元）', async () => {
    const sb = fakeSupabase([])
    const result = await fetchClientDailySpendCents(sb, CLIENT, '2026-09-27', 7)
    expect(result).toEqual({ todayTotalSpendCents: 0, recentDailySpend: [] })
  })

  it('读取失败 → null（调用方按"读不到=不动"处理，不当 0 用）', async () => {
    const sb = fakeSupabase([], 'boom')
    const result = await fetchClientDailySpendCents(sb, CLIENT, '2026-09-27', 7)
    expect(result).toBeNull()
  })

  it('🔴 超过 1000 行（PostgREST 单页硬顶）不能被静默截断——分页取全', async () => {
    // 1200 条今天的 campaign 行，每条 spend=1 美元；裸查会在 1000 条截断，
    // todayTotalSpendCents 会算成 100000（少 200 美元）而不是 120000。
    const rows: Row[] = Array.from({ length: 1200 }, (_, i) => ({
      insight_date: '2026-09-27',
      entity_id: `c${i}`,
      spend: 1,
    }))
    let calls = 0
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      range: async (from: number, to: number) => {
        calls += 1
        return { data: rows.slice(from, to + 1), error: null }
      },
    }
    const sb = { from: () => chain } as unknown as SupabaseClient

    const result = await fetchClientDailySpendCents(sb, CLIENT, '2026-09-27', 7)
    expect(calls).toBeGreaterThan(1) // 证明真的分了页，不是单次裸查
    expect(result?.todayTotalSpendCents).toBe(120000) // 1200 * $1 * 100 分
  })
})
