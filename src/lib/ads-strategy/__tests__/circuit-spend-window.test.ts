import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SPEND_WINDOW_ROW_LIMIT,
  readSpendWindow,
} from '../circuit-spend-window'

// ---------------------------------------------------------------------------
// 顶层 helper：自带，不假设别处有。
// ---------------------------------------------------------------------------

/**
 * 🔴 字段名和类型跟 `ad_daily_insights` 真实列一致（已核 migration）。
 *
 * 带索引签名是为了让假件的 `eq/gte/lte` 能按列名取值而
 * **不用任何类型强转** —— fixture 里出现两步强转
 * （`as Record<string, unknown>` 之类）就是在把「假件形状跟真表不一致」
 * 这个问题遮掉，而那正是假件最容易错的地方。
 */
interface FakeRow {
  readonly client_id: string
  readonly ad_account_id: string
  readonly level: string
  readonly insight_date: string
  readonly spend: number | null
  readonly [column: string]: string | number | null
}

/**
 * 真实后端不写 `.limit()` 时自己的默认上限（PostgREST = 1000）。
 * 比 `SPEND_WINDOW_ROW_LIMIT` 小，所以一旦代码忘了显式设上限，
 * 「行数 === SPEND_WINDOW_ROW_LIMIT」这个截断判据就**永远不成立**。
 */
const POSTGREST_DEFAULT_CAP = 1000

interface FakeQueryResult {
  readonly data: readonly FakeRow[] | null
  readonly error: { readonly message: string } | null
}

/**
 * 一个真的按过滤条件筛行的假 supabase。
 * eq / gte / lte / limit 都生效 —— 无条件返回固定数组的假件会让
 * "没过滤粒度 / 没过滤账户 / 没检测截断" 这三类错法全变绿。
 */
function makeFakeSupabase(
  rows: readonly FakeRow[],
  opts: { readonly failWith?: string } = {},
): SupabaseClient {
  const filters: Array<(row: FakeRow) => boolean> = []
  let limit: number | null = null

  const builder = {
    select() {
      return builder
    },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value)
      return builder
    },
    gte(column: string, value: unknown) {
      filters.push((row) => String(row[column]) >= String(value))
      return builder
    },
    lte(column: string, value: unknown) {
      filters.push((row) => String(row[column]) <= String(value))
      return builder
    },
    limit(n: number) {
      limit = n
      return builder
    },
    then(
      resolve: (result: FakeQueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      if (opts.failWith !== undefined) {
        return Promise.resolve({ data: null, error: { message: opts.failWith } })
          .then(resolve, reject)
      }
      let matched = rows.filter((row) => filters.every((f) => f(row)))
      // 🔴 **不调 `.limit()` 时也要截** —— 真实后端（PostgREST）默认最多给
      //    `POSTGREST_DEFAULT_CAP` 行，**超出时静默截断、不报错**。
      //    假件要是「没设上限就全给」，那么把代码里的 `.limit()` 删掉
      //    测试仍然是绿的 —— 而现实里删掉它就再也检不出截断（行数永远到
      //    不了 2000），于是“少了几天的花费”看起来就是“那几天没花钱”。
      //    这一条是变异 S8 测出来补的：假件不模拟后端的隐式默认上限，
      //    就会把一个真 fail-open 漏成绿的。
      matched = matched.slice(0, limit ?? POSTGREST_DEFAULT_CAP)
      return Promise.resolve({ data: matched, error: null }).then(
        resolve,
        reject,
      )
    },
  }

  return {
    from() {
      return builder
    },
  } as unknown as SupabaseClient
}

const CLIENT = 'client-1'
const ACCOUNT = 'acct-1'
const TARGET = '2026-09-26'

function row(
  overrides: Partial<FakeRow> & { readonly insight_date: string },
): FakeRow {
  return {
    client_id: CLIENT,
    ad_account_id: ACCOUNT,
    level: 'campaign',
    spend: 0,
    ...overrides,
  }
}

function read(
  rows: readonly FakeRow[],
  opts: { readonly failWith?: string } = {},
) {
  return readSpendWindow(makeFakeSupabase(rows, opts), {
    clientId: CLIENT,
    adAccountId: ACCOUNT,
    targetDate: TARGET,
  })
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('readSpendWindow', () => {
  it('同一天有 campaign / adset / ad 三种粒度时只算 campaign 那一份', async () => {
    const result = await read([
      row({ insight_date: TARGET, level: 'campaign', spend: 10 }),
      row({ insight_date: TARGET, level: 'adset', spend: 10 }),
      row({ insight_date: TARGET, level: 'ad', spend: 10 }),
    ])
    // 只算 campaign 的 10 元 = 1000 分；不过滤会是 3000 分。
    expect(result.targetSpendCents).toBe(1000)
  })

  it('混有另一个账户同一天的花费时不计入', async () => {
    const result = await read([
      row({ insight_date: TARGET, spend: 10 }),
      row({ insight_date: TARGET, ad_account_id: 'acct-2', spend: 999 }),
    ])
    expect(result.targetSpendCents).toBe(1000)
  })

  it('混有另一个客户的花费时不计入', async () => {
    const result = await read([
      row({ insight_date: TARGET, spend: 10 }),
      row({ insight_date: TARGET, client_id: 'client-2', spend: 999 }),
    ])
    expect(result.targetSpendCents).toBe(1000)
  })

  it('返回行数恰好等于上限时 truncated 为 true', async () => {
    const rows = Array.from({ length: SPEND_WINDOW_ROW_LIMIT }, () =>
      row({ insight_date: TARGET, spend: 1 }),
    )
    const result = await read(rows)
    expect(result.truncated).toBe(true)
  })

  it('返回行数比上限少一行时 truncated 为 false', async () => {
    const rows = Array.from({ length: SPEND_WINDOW_ROW_LIMIT - 1 }, () =>
      row({ insight_date: TARGET, spend: 1 }),
    )
    const result = await read(rows)
    expect(result.truncated).toBe(false)
  })

  it('targetDate 当天没有行时 targetSpendCents 为 null（不是 0）', async () => {
    const result = await read([
      row({ insight_date: '2026-09-25', spend: 5 }),
    ])
    expect(result.targetSpendCents).toBeNull()
  })

  it('targetDate 当天有行但 spend 全是 null 时 targetSpendCents 为 0', async () => {
    const result = await read([
      row({ insight_date: TARGET, spend: null }),
      row({ insight_date: TARGET, spend: null }),
    ])
    expect(result.targetSpendCents).toBe(0)
  })

  it('窗口是 8 天：第 8 天前那天的行不出现在 previousDays 里', async () => {
    // 窗口起点 = TARGET - 7 = 2026-09-19；2026-09-18 在窗口外。
    const result = await read([
      row({ insight_date: '2026-09-18', spend: 1 }),
      row({ insight_date: '2026-09-19', spend: 2 }),
    ])
    expect(result.previousDays.map((p) => p.insightDate)).toEqual(['2026-09-19'])
  })

  it('同一天多条 campaign 行时金额相加后才转分', async () => {
    const result = await read([
      row({ insight_date: TARGET, spend: 0.005 }),
      row({ insight_date: TARGET, spend: 0.005 }),
      row({ insight_date: TARGET, spend: 0.005 }),
    ])
    // 正确：Math.round(0.015 * 100) = 2；逐行取整会得到 1+1+1 = 3。
    expect(result.targetSpendCents).toBe(2)
  })

  it('previousDays 按日期升序', async () => {
    const result = await read([
      row({ insight_date: '2026-09-21', spend: 1 }),
      row({ insight_date: '2026-09-19', spend: 1 }),
      row({ insight_date: '2026-09-20', spend: 1 }),
    ])
    expect(result.previousDays.map((p) => p.insightDate)).toEqual([
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
    ])
  })

  it('查询失败时 queryError 有值、targetSpendCents 为 null', async () => {
    const result = await read([], { failWith: 'boom' })
    expect(result.queryError).toBe('boom')
    expect(result.targetSpendCents).toBeNull()
    expect(result.previousDays).toEqual([])
    expect(result.truncated).toBe(false)
  })
})
