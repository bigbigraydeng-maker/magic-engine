/**
 * `fetchClientDailySpendCentsByAccount`：按账户、按天汇总 `ad_daily_insights`
 * 真实花费，美元转分，today 从 recentDailySpend 里剔除（Codex P1 复审：按账户
 * 分别判定，不按客户合计，见 circuit-breaker-spend.ts 顶部说明）。
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchClientDailySpendCentsByAccount } from '../circuit-breaker-spend'

const CLIENT = 'client-uuid-spend-test'

interface Row {
  insight_date: string
  entity_id: string
  ad_account_id: string
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

describe('fetchClientDailySpendCentsByAccount', () => {
  it('按 insight_date 汇总多条同账户 campaign 行，美元转分', async () => {
    const sb = fakeSupabase([
      { insight_date: '2026-09-27', entity_id: 'c1', ad_account_id: 'act_1', spend: 10.5 },
      { insight_date: '2026-09-27', entity_id: 'c2', ad_account_id: 'act_1', spend: 5.25 }, // 同一天两个 campaign，应相加
      { insight_date: '2026-09-26', entity_id: 'c1', ad_account_id: 'act_1', spend: 20 },
    ])
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result).toHaveLength(1)
    expect(result?.[0].adAccountId).toBe('act_1')
    expect(result?.[0].todayTotalSpendCents).toBe(1575) // (10.5+5.25) * 100
    expect(result?.[0].recentDailySpend).toContainEqual({ date: '2026-09-26', totalSpendCents: 2000 })
  })

  it('🔴 Codex P1：多账户分开返回，互不混算——账户 A 花费不会被账户 B 稀释', async () => {
    const sb = fakeSupabase([
      { insight_date: '2026-09-27', entity_id: 'a1', ad_account_id: 'act_a', spend: 400 },
      { insight_date: '2026-09-27', entity_id: 'b1', ad_account_id: 'act_b', spend: 1000 },
    ])
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result).toHaveLength(2)
    const byAccount = new Map(result?.map((r) => [r.adAccountId, r.todayTotalSpendCents]))
    expect(byAccount.get('act_a')).toBe(40000) // $400，不掺账户 B 的 $1000
    expect(byAccount.get('act_b')).toBe(100000)
  })

  it('返回按 ad_account_id 字典序排列', async () => {
    const sb = fakeSupabase([
      { insight_date: '2026-09-27', entity_id: 'z1', ad_account_id: 'act_z', spend: 1 },
      { insight_date: '2026-09-27', entity_id: 'a1', ad_account_id: 'act_a', spend: 1 },
    ])
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result?.map((r) => r.adAccountId)).toEqual(['act_a', 'act_z'])
  })

  it('today 不出现在 recentDailySpend 里', async () => {
    const sb = fakeSupabase([{ insight_date: '2026-09-27', entity_id: 'c1', ad_account_id: 'act_1', spend: 100 }])
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result?.[0].recentDailySpend.some((e) => e.date === '2026-09-27')).toBe(false)
  })

  it('spend 为 null 当 0 处理', async () => {
    const sb = fakeSupabase([{ insight_date: '2026-09-26', entity_id: 'c1', ad_account_id: 'act_1', spend: null }])
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result?.[0].recentDailySpend).toContainEqual({ date: '2026-09-26', totalSpendCents: 0 })
  })

  it('窗口内无历史行 → 空数组（不是 null——"读到了，内容是空的"跟"读不到"是两回事）', async () => {
    const sb = fakeSupabase([])
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result).toEqual([])
  })

  it('读取失败 → null（调用方按"读不到=不动"处理，不当空数组用）', async () => {
    const sb = fakeSupabase([], 'boom')
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result).toBeNull()
  })

  it('🔴 超过 1000 行（PostgREST 单页硬顶）不能被静默截断——分页取全', async () => {
    // 1200 条今天同一账户的 campaign 行，每条 spend=1 美元；裸查会在 1000 条截断，
    // todayTotalSpendCents 会算成 100000（少 200 美元）而不是 120000。
    const rows: Row[] = Array.from({ length: 1200 }, (_, i) => ({
      insight_date: '2026-09-27',
      entity_id: `c${i}`,
      ad_account_id: 'act_1',
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

    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(calls).toBeGreaterThan(1) // 证明真的分了页，不是单次裸查
    expect(result?.[0].todayTotalSpendCents).toBe(120000) // 1200 * $1 * 100 分
  })
})
