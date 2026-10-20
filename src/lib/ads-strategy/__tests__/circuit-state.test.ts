/**
 * 熔断当前状态的派生态判定（WP3.1b，spec v2.2 §6.2）。
 *
 * ## 这份假件为什么要**真的执行过滤**
 *
 * 常见写法是让假件无条件返回准备好的行，只在内存里验业务逻辑。那样有两个东西测不到：
 *   ① 过滤条件写错了（比如 `.or()` 的条件串拼错、漏了 `kind` 过滤）
 *   ② **判据到底在 SQL 里还是在内存里** —— 而这恰好是本模块最要紧的性质：
 *      「可能还算熔断的 trip」必须由 SQL 挑出来，不能取最近 N 条再在内存里筛。
 *      取 N 条那种写法在安全闸上是 **fail-open**：一条未解的 sticky trip 掉到窗口外
 *      就被算成「没熔断」，而且静默（同 WP2 遗留 #1994 的 `limit(4000)`）。
 *
 * 所以下面这个假件实现了 PostgREST 这几个算子的真实语义（`eq` / `or` / `in`），
 * 并且**故意不实现 `limit`** —— 如果哪天有人把实现改回「取最近 N 条」，
 * 假件会直接报 `limit is not a function`，而不是默默放过。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readCircuitState, listActiveCircuitTrips, CIRCUIT_NON_STICKY_TTL_MS } from '../circuit-state'

const NOW = new Date('2026-09-27T12:00:00Z')
const CLIENT = 'c-1'
const ACCOUNT = 'act_1'

type Row = Record<string, unknown>

function trip(over: Row = {}): Row {
  return {
    id: 't1',
    client_id: CLIENT,
    ad_account_id: ACCOUNT,
    kind: 'trip',
    trip_event_id: null,
    reason: 'circuit:spend_spike',
    sticky: false,
    created_at: new Date(NOW.getTime() - 60_000).toISOString(),
    seq: 1,
    ...over,
  }
}

function release(tripId: string, over: Row = {}): Row {
  return {
    id: 'r1',
    client_id: CLIENT,
    ad_account_id: ACCOUNT,
    kind: 'release',
    trip_event_id: tripId,
    reason: 'PM 解除',
    sticky: false,
    created_at: NOW.toISOString(),
    seq: 2,
    actor: 'human:pm@x.y',
    ...over,
  }
}

interface FakeState {
  rows: Row[]
  error: string | null
  /** 每次查询用过的过滤条件，用例可以断言判据真的下到了查询里。 */
  calls: Array<{ eq: Array<[string, unknown]>; or: string | null; inIds: string[] | null }>
}

function makeFake(state: FakeState): SupabaseClient {
  const fake = {
    from(table: string) {
      if (table !== 'ads_circuit_events') {
        // 🔴 必须炸：写错表名在测试里不能长得跟「这张表是空的」一样。
        throw new Error('unexpected table: ' + table)
      }
      return {
        select() {
          const eqs: Array<[string, unknown]> = []
          let orExpr: string | null = null
          let inIds: string[] | null = null

          const settle = () => {
            state.calls.push({ eq: eqs, or: orExpr, inIds })
            if (state.error) return { data: null, error: { message: state.error } }

            let rows = state.rows
            // eq：逐条真过滤
            for (const [col, val] of eqs) rows = rows.filter((r) => r[col] === val)
            // or：只实现本模块用到的那一种 `sticky.eq.true,created_at.gt.<iso>`
            if (orExpr !== null) {
              const parts = orExpr.split(',')
              rows = rows.filter((r) =>
                parts.some((part) => {
                  const [col, op, ...rest] = part.split('.')
                  const raw = rest.join('.')
                  if (op === 'eq') return String(r[col]) === raw
                  if (op === 'gt') return String(r[col]) > raw
                  throw new Error('假件没实现的 or 算子: ' + part)
                }),
              )
            }
            if (inIds !== null) rows = rows.filter((r) => inIds!.includes(String(r.trip_event_id)))
            return { data: rows, error: null }
          }

          const chain = {
            eq(col: string, val: unknown) { eqs.push([col, val]); return chain },
            or(expr: string) { orExpr = expr; return chain },
            in(_col: string, ids: string[]) { inIds = ids; return chain },
            order() { return chain },
            then<T>(res: (v: ReturnType<typeof settle>) => T) { return Promise.resolve(settle()).then(res) },
          }
          return chain
        },
      }
    },
  }
  return fake as unknown as SupabaseClient
}

function state(over: Partial<FakeState> = {}): FakeState {
  return { rows: [], error: null, calls: [], ...over }
}

const read = (s: FakeState, now: Date = NOW) => readCircuitState(makeFake(s), CLIENT, ACCOUNT, now)

describe('派生态 · 基本情况', () => {
  it('没有任何行 → 不算熔断', async () => {
    const v = await read(state())
    expect(v).toEqual({ tripped: false, reason: null, sticky: false, openTripCount: 0, queryError: null })
  })

  it('一条 1 分钟前的非 sticky trip、没有 release → 算熔断', async () => {
    const v = await read(state({ rows: [trip()] }))
    expect(v.tripped).toBe(true)
    expect(v.reason).toBe('circuit:spend_spike')
    expect(v.sticky).toBe(false)
    expect(v.openTripCount).toBe(1)
    expect(v.queryError).toBeNull()
  })

  it('同一条 trip 有对应 release → 不算熔断', async () => {
    const v = await read(state({ rows: [trip(), release('t1')] }))
    expect(v.tripped).toBe(false)
  })
})

describe('派生态 · 24 小时自然过期 vs sticky 免疫', () => {
  const old = new Date(NOW.getTime() - CIRCUIT_NON_STICKY_TTL_MS - 60 * 60_000).toISOString()

  it('🔴 非 sticky trip 是 25 小时前的、没有 release → 不算熔断（时间自然过期，不需要任何 release 行）', async () => {
    const v = await read(state({ rows: [trip({ created_at: old })] }))
    expect(v.tripped).toBe(false)
  })

  it('🔴 sticky trip 是 25 小时前的、没有 release → 仍算熔断（sticky 对时间过期免疫）', async () => {
    const v = await read(state({ rows: [trip({ created_at: old, sticky: true })] }))
    expect(v.tripped).toBe(true)
    expect(v.sticky).toBe(true)
  })

  it('sticky trip 25 小时前 + 有对应 release → 不算熔断', async () => {
    const v = await read(state({ rows: [trip({ created_at: old, sticky: true }), release('t1')] }))
    expect(v.tripped).toBe(false)
  })
})

describe('派生态 · 多条 trip 各自独立判定', () => {
  const two = [
    trip({ id: 't1', reason: 'circuit:newest', created_at: new Date(NOW.getTime() - 60_000).toISOString(), seq: 2 }),
    trip({ id: 't2', reason: 'circuit:older', created_at: new Date(NOW.getTime() - 120_000).toISOString(), seq: 1 }),
  ]

  it('🔴 两条 trip、只有 t1 有 release → 仍算熔断（一条被解不代表另一条被解）', async () => {
    const v = await read(state({ rows: [...two, release('t1')] }))
    expect(v.tripped).toBe(true)
    expect(v.openTripCount).toBe(1)
    expect(v.reason).toBe('circuit:older')
  })

  it('两条未解、一条 sticky → sticky 为 true、计 2 条', async () => {
    const v = await read(state({ rows: [two[0], trip({ id: 't2', sticky: true, seq: 1 })] }))
    expect(v.sticky).toBe(true)
    expect(v.openTripCount).toBe(2)
  })

  it('reason 取最新那条未解 trip', async () => {
    const v = await read(state({ rows: two }))
    expect(v.reason).toBe('circuit:newest')
  })
})

describe('派生态 · 读不到就当熔断中，但前缀必须区分得开', () => {
  it('🔴 查询报错 → 算熔断（fail closed），但 reason 用 facts: 前缀不是 circuit:', async () => {
    const v = await read(state({ error: 'boom' }))
    expect(v.tripped).toBe(true)
    expect(v.reason).toBe('facts:circuit_query_failed')
    expect(v.reason?.startsWith('circuit:')).toBe(false)
    expect(v.queryError).toBe('boom')
  })
})

describe('派生态 · 判据必须下到查询里，不许取最近 N 条再内存筛', () => {
  it('🔴 第一段查询带了 client_id / ad_account_id / kind=trip 三个 eq，以及 sticky 或 24h 的 or', async () => {
    const s = state({ rows: [trip()] })
    await read(s)
    const first = s.calls[0]
    expect(first.eq).toEqual(
      expect.arrayContaining([['client_id', CLIENT], ['ad_account_id', ACCOUNT], ['kind', 'trip']]),
    )
    expect(first.or, 'sticky 与 24h 窗口必须在查询里，不是在内存里').toContain('sticky.eq.true')
    expect(first.or).toContain('created_at.gt.')
  })

  it('🔴 第二段查询只查这几条 trip 的 release，用 in 限定（结果集有界）', async () => {
    const s = state({ rows: [trip()] })
    await read(s)
    expect(s.calls).toHaveLength(2)
    expect(s.calls[1].eq).toEqual(expect.arrayContaining([['kind', 'release']]))
    expect(s.calls[1].inIds).toEqual(['t1'])
  })

  it('🔴 没有候选 trip 时不发第二段查询（省一次往返，也证明短路真的短路了）', async () => {
    const s = state({ rows: [] })
    await read(s)
    expect(s.calls).toHaveLength(1)
  })
})

describe('派生态 · 时间以传入的 now 为准，不看真实挂钟', () => {
  it('trip 在 9/1 00:00、now 传 9/1 01:00 → 只过了 1 小时，算熔断', async () => {
    const v = await read(
      state({ rows: [trip({ created_at: '2026-09-01T00:00:00.000Z' })] }),
      new Date('2026-09-01T01:00:00.000Z'),
    )
    expect(v.tripped).toBe(true)
  })
})

describe('listActiveCircuitTrips · 全表列出现在熔断中的 (客户, 账户)', () => {
  // now 默认用本文件的 NOW（trip 的 created_at 都是相对 NOW 造的）；不传的话会用真实时钟，过了 TTL 后「未解的 trip」会被当成已过期而全红
  async function list(s: FakeState, now: Date = NOW) {
    return listActiveCircuitTrips(makeFake(s), now)
  }

  it('没有任何 trip → 空数组', async () => {
    expect(await list(state({ rows: [] }))).toEqual([])
  })

  it('一条未解的 trip → 出现在结果里', async () => {
    const rows = await list(state({ rows: [trip()] }))
    expect(rows).toEqual([
      { clientId: CLIENT, adAccountId: ACCOUNT, reason: 'circuit:spend_spike', sticky: false, openTripCount: 1 },
    ])
  })

  it('已解除的 trip → 不出现', async () => {
    const rows = await list(state({ rows: [trip({ id: 't1' }), release('t1')] }))
    expect(rows).toEqual([])
  })

  it('🔴 两个不同账户各有一条 trip → 分成两组，互不混淆', async () => {
    const rows = await list(
      state({
        rows: [
          trip({ id: 't1', ad_account_id: 'act_1' }),
          trip({ id: 't2', ad_account_id: 'act_2', reason: 'circuit:client_daily_cap_exceeded' }),
        ],
      }),
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.adAccountId === 'act_1')?.reason).toBe('circuit:spend_spike')
    expect(rows.find((r) => r.adAccountId === 'act_2')?.reason).toBe('circuit:client_daily_cap_exceeded')
  })

  it('🔴 两个不同客户共用同一个 ad_account_id → 仍然分成两组（分组键必须带 client_id）', async () => {
    const rows = await list(
      state({
        rows: [
          trip({ id: 't1', client_id: 'c-1', ad_account_id: 'act_shared' }),
          trip({ id: 't2', client_id: 'c-2', ad_account_id: 'act_shared' }),
        ],
      }),
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.clientId).sort()).toEqual(['c-1', 'c-2'])
  })

  it('同一账户多条未解 trip → 合并成一组，reason 取最新那条、sticky 取任一为真', async () => {
    // 🔴 假件的 .order() 是空操作（同 readCircuitState 那组测试的约定），
    //    fixture 必须自己按 created_at DESC 排好——数组顺序就是"数据库已经排好序"
    //    这件事的替身，不是随便传。
    const rows = await list(
      state({
        rows: [
          trip({ id: 't2', sticky: true, reason: 'circuit:rollback_failed:run-1', created_at: '2026-09-27T11:00:00.000Z', seq: 2 }),
          trip({ id: 't1', sticky: false, created_at: '2026-09-27T10:00:00.000Z', seq: 1 }),
        ],
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('circuit:rollback_failed:run-1')
    expect(rows[0].sticky).toBe(true)
    expect(rows[0].openTripCount).toBe(2)
  })

  it('查第一段（trip）失败 → throw，不当成「没有熔断」', async () => {
    await expect(list(state({ rows: [], error: 'boom' }))).rejects.toThrow('boom')
  })

  it('查第二段（release）失败 → throw', async () => {
    // 让第一段有候选、但第二段查询本身要报错——用一个专门的假件変体
    let callCount = 0
    const fake = {
      from(table: string) {
        if (table !== 'ads_circuit_events') throw new Error('unexpected table: ' + table)
        return {
          select() {
            const chain = {
              eq() { return chain },
              or() { return chain },
              in() { return chain },
              order() { return chain },
              then<T>(res: (v: { data: unknown; error: { message: string } | null }) => T) {
                callCount += 1
                if (callCount === 1) return Promise.resolve({ data: [trip()], error: null }).then(res)
                return Promise.resolve({ data: null, error: { message: 'release 查询故意失败' } }).then(res)
              },
            }
            return chain
          },
        }
      },
    } as unknown as SupabaseClient
    await expect(listActiveCircuitTrips(fake)).rejects.toThrow('release 查询故意失败')
  })

  it('不按 client_id / ad_account_id 过滤 —— 一次查出全表候选', async () => {
    const s = state({ rows: [trip()] })
    await list(s)
    // 第一段查询不应该带 client_id / ad_account_id 这两个过滤键
    const firstCallCols = s.calls[0].eq.map(([col]) => col)
    expect(firstCallCols).not.toContain('client_id')
    expect(firstCallCols).not.toContain('ad_account_id')
  })
})
