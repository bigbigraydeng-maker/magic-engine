/**
 * `signups_count`（报名/预订数）的取数来源。
 *
 * 🔴 这个指标一度被接到广告留资上——「33 个报名」的目标会拿留资数去填，数字漂亮但名不符实。
 * 现在读 `me_sale_outcomes` 的 purchase 行（由客户 CRM 表「阶段=已订金」经同步流水线写入）。
 * 一条都没有时必须返回 `unknown` 而不是 0：「还没成交」和「没人填阶段」在库里长得一样，
 * 报 0 等于替客户断言生意没做成（2026-09-24 实测：613 条 lead、0 条 purchase，
 * 同期 CRM 表 1599 行只有 1 行填了阶段——是后者）。
 */

import { describe, it, expect } from 'vitest'
import { autoFetchMetricValue } from '../auto-fetch'

type Client = Parameters<typeof autoFetchMetricValue>[0]

interface FakeDbOpts {
  goal?: { period_start: string; period_end: string } | null
  goalError?: string
  count?: number | null
  countError?: string
}

/**
 * 手搓的 SupabaseClient 替身。`autoFetchMetricValue` 把 client 当第一个参数收，
 * 所以直接传 stub 即可，不需要 vi.mock 整个 supabase 模块。
 *
 * 要支持两条链，两条都是被 **直接 await** 的：
 *   1. from('goals').select(...).eq(...).eq(...).limit(2) → { data: rows[], error }
 *   2. from('me_sale_outcomes').select(...).eq(...).eq(...).is(...).neq(...).gte(...).lte(...)
 *      → { count, error }
 *
 * 做法：一个可链式调用的对象，select/eq/is/neq/gte/lte/limit 都返回它自己；
 * 它的 then 按**表**返回结果（不按调用次序）。
 */
function fakeDb(opts: FakeDbOpts): Client {
  const goalResult = opts.goalError
    ? { data: null, error: { message: opts.goalError } }
    : { data: opts.goal ? [opts.goal] : [], error: null }

  const countResult = opts.countError
    ? { count: null, error: { message: opts.countError } }
    : { count: opts.count ?? null, error: null }

  function makeChain(table: string) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      neq: () => chain,
      gte: () => chain,
      lte: () => chain,
      limit: () => chain,
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(table === 'goals' ? goalResult : countResult).then(onFulfilled, onRejected),
    }
    return chain
  }

  return {
    from: (table: string) => {
      if (table === 'goals' || table === 'me_sale_outcomes') return makeChain(table)
      throw new Error(`unexpected table in test stub: ${table}`)
    },
  } as unknown as Client
}

const PERIOD = { period_start: '2026-09-01', period_end: '2026-09-30' }

describe('autoFetchMetricValue — signups_count (报名/预订数)', () => {
  it('有 3 条 purchase → ok:true value:3，来源 me_sale_outcomes，snapshot_date 等于目标期末', async () => {
    const db = fakeDb({ goal: PERIOD, count: 3 })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result).toMatchObject({
      ok: true,
      value: 3,
      source: 'me_sale_outcomes',
      snapshot_date: PERIOD.period_end,
    })
  })

  it('0 条 purchase → unknown，reason 同时提到「还没成交」和「没人填阶段」两种可能', async () => {
    const db = fakeDb({ goal: PERIOD, count: 0 })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result.ok).toBe(false)
    // noData：数据源正常只是没记录 —— 定时任务据此不把整次运行判成失败
    expect(result).toMatchObject({ unknown: true, noData: true })
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toContain('还没成交')
    expect(result.reason).toContain('阶段')

    // 🔴 回归：绝不允许把「没记录」当成 0 报出去。
    expect(result).not.toMatchObject({ ok: true, value: 0 })
  })

  it('count 为 null（PostgREST 没回计数）→ 同样 unknown，不当 0', async () => {
    const db = fakeDb({ goal: PERIOD, count: null })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ unknown: true })

    // 🔴 回归：null 计数不是 0。
    expect(result).not.toMatchObject({ ok: true, value: 0 })
  })

  it('没有生效中的目标 → unknown，reason 含 no active goal', async () => {
    const db = fakeDb({ goal: null })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ unknown: true })
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toContain('no active goal')
  })

  it('读 me_sale_outcomes 报错 → unknown，reason 是那条错误消息', async () => {
    const db = fakeDb({ goal: PERIOD, countError: 'permission denied for table me_sale_outcomes' })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ unknown: true })
    // 查询报错是故障，不能被当成「只是没数据」
    expect(result).not.toHaveProperty('noData')
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toBe('permission denied for table me_sale_outcomes')
  })
})
