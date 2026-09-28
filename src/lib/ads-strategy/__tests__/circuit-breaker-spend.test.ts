/**
 * `fetchClientDailySpendCentsByAccount`：按账户、按天汇总 `ad_daily_insights`
 * 真实花费，美元转分，today 从 recentDailySpend 里剔除（Codex P1 复审：按账户
 * 分别判定，不按客户合计，见 circuit-breaker-spend.ts 顶部说明）。
 *
 * 🔴 Codex P1 复审（round 11）：`findSharedAdAccounts` 用的是模块级
 * `supabaseAdmin`（不接受本文件其它函数那种可注入 `sb`），所以用 `vi.mock`
 * 换掉，不是靠假 `sb` 的 `.from()` 分支处理——跟 `live-rules.test.ts` 同一
 * 套路。默认"没有共用账户、查询不出错"，个别用例按需覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mockFindSharedAdAccounts = vi.fn()
vi.mock('@/lib/meta/client-ad-accounts', () => ({
  findSharedAdAccounts: (...args: unknown[]) => mockFindSharedAdAccounts(...args),
}))

import { fetchClientDailySpendCentsByAccount } from '../circuit-breaker-spend'

const CLIENT = 'client-uuid-spend-test'

beforeEach(() => {
  mockFindSharedAdAccounts.mockReset()
  mockFindSharedAdAccounts.mockResolvedValue({ shared: new Set<string>() })
})

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
    expect(result?.[0].adAccountId).toBe('1') // act_ 前缀已归一化剥离，见下方"前缀不一致"用例
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
    expect(byAccount.get('a')).toBe(40000) // $400，不掺账户 B 的 $1000
    expect(byAccount.get('b')).toBe(100000)
  })

  it('返回按归一化后的 ad_account_id 字典序排列', async () => {
    const sb = fakeSupabase([
      { insight_date: '2026-09-27', entity_id: 'z1', ad_account_id: 'act_z', spend: 1 },
      { insight_date: '2026-09-27', entity_id: 'a1', ad_account_id: 'act_a', spend: 1 },
    ])
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result?.map((r) => r.adAccountId)).toEqual(['a', 'z'])
  })

  it('🔴 Codex P1：同一账户历史行带 act_ 前缀、当天行不带（或反过来）——必须归并成一个账户，不能拆成两个', async () => {
    const sb = fakeSupabase([
      // 历史行带前缀，当天行不带——真实场景：client_meta_ad_accounts 不强制格式，
      // 同一账户不同时间写入的行前缀可能不一致（见 20260913000001_client_meta_ad_accounts.sql）。
      { insight_date: '2026-09-20', entity_id: 'c1', ad_account_id: 'act_42', spend: 100 },
      { insight_date: '2026-09-27', entity_id: 'c2', ad_account_id: '42', spend: 400 },
    ])
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result).toHaveLength(1) // 不是 2——两条行是同一个真实账户
    expect(result?.[0].adAccountId).toBe('42')
    expect(result?.[0].todayTotalSpendCents).toBe(40000) // 当天 $400 那行没有跟历史行拆开
    expect(result?.[0].recentDailySpend).toContainEqual({ date: '2026-09-20', totalSpendCents: 10000 }) // 历史 $100 那行也在同一账户的历史序列里
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

  it('🔴 Codex P1（round 11）：跨客户共用账户被排除，不参与这个客户的熔断判定', async () => {
    const sb = fakeSupabase([
      { insight_date: '2026-09-27', entity_id: 'a1', ad_account_id: 'act_a', spend: 400 }, // 独占账户
      { insight_date: '2026-09-27', entity_id: 'b1', ad_account_id: 'act_b', spend: 99999 }, // 共用账户，花费再离谱也不算这个客户的
    ])
    mockFindSharedAdAccounts.mockResolvedValue({ shared: new Set(['b']) })

    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result).toHaveLength(1)
    expect(result?.[0].adAccountId).toBe('a')
    expect(mockFindSharedAdAccounts).toHaveBeenCalledWith(CLIENT, expect.arrayContaining(['a', 'b']))
  })

  it('🔴 Codex P1（round 11）：查不出哪些账户共用 → fail closed 返回 null，不当"没有共用账户"处理', async () => {
    const sb = fakeSupabase([{ insight_date: '2026-09-27', entity_id: 'a1', ad_account_id: 'act_a', spend: 400 }])
    mockFindSharedAdAccounts.mockResolvedValue({ shared: new Set(), error: 'client_meta_ad_accounts unreachable' })

    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result).toBeNull()
  })

  it('全部账户都独占（没有共用）→ 照常返回全部', async () => {
    const sb = fakeSupabase([
      { insight_date: '2026-09-27', entity_id: 'a1', ad_account_id: 'act_a', spend: 400 },
      { insight_date: '2026-09-27', entity_id: 'b1', ad_account_id: 'act_b', spend: 1000 },
    ])
    const result = await fetchClientDailySpendCentsByAccount(sb, CLIENT, '2026-09-27', 7)
    expect(result?.map((r) => r.adAccountId).sort()).toEqual(['a', 'b'])
  })
})
