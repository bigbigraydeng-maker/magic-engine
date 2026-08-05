/**
 * 假件自己也要被测 —— 一个会撒谎的假件比没有假件更糟。
 * 今天全仓的教训正是：假件配合着坏代码，测试全绿，生产静默失效。
 */

import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '../fake-supabase'

interface Row { data: unknown; error: { message: string } | null }

describe('fakeSupabase —— 三条护栏', () => {
  it('🔴 护栏一：查没建模的表要炸，而且要说清是哪张表', async () => {
    const sb = fakeSupabase({ clients: { rows: [] } })
    expect(() => sb.from('keywords')).toThrow(/表 'keywords' 没有建模/)
    // 报错里要列出已建模的表，让人一眼知道该加什么
    expect(() => sb.from('keywords')).toThrow(/clients/)
  })

  it('🔴 护栏二：过滤条件记得下来，能断言「有没有按客户过滤」', async () => {
    const sb = fakeSupabase({ blog_posts: { rows: [] } })
    await (sb.from('blog_posts') as { select: (c: string) => { eq: (a: string, b: unknown) => PromiseLike<Row> } })
      .select('id')
      .eq('client_id', 'c1')
    expect(sb.queries('blog_posts')[0].filters).toContainEqual(['eq', 'client_id', 'c1'])
  })

  it('🔴 护栏三：「查失败」和「真的没有」是两个不同的返回', async () => {
    const broken = fakeSupabase({ t: { error: 'db down' } })
    const empty = fakeSupabase({ t: { rows: [] } })

    const a = (await (broken.from('t') as { select: (c: string) => PromiseLike<Row> }).select('*')) as Row
    const b = (await (empty.from('t') as { select: (c: string) => PromiseLike<Row> }).select('*')) as Row

    expect(a.error?.message).toBe('db down')
    expect(a.data).toBeNull()
    expect(b.error).toBeNull()
    expect(b.data).toEqual([])
  })
})

describe('fakeSupabase —— 查询语义跟生产一致', () => {
  const rows = [
    { id: '1', client_id: 'c1', kw: 'a', vol: 200, kd: 30 },
    { id: '2', client_id: 'c1', kw: 'b', vol: 10, kd: 30 },
    { id: '3', client_id: 'c2', kw: 'c', vol: 500, kd: null },
  ]

  it('eq / gt 按预期过滤', async () => {
    const sb = fakeSupabase({ kw: { rows } })
    const r = (await (sb.from('kw') as never as {
      select: (c: string) => { eq: (a: string, b: unknown) => { gt: (a: string, b: number) => PromiseLike<Row> } }
    })
      .select('kw')
      .eq('client_id', 'c1')
      .gt('vol', 50)) as Row
    expect(r.data).toEqual([{ kw: 'a' }])
  })

  it('🔴 跟 NULL 比大小永远不成立 —— 跟 SQL 一致', async () => {
    const sb = fakeSupabase({ kw: { rows } })
    const r = (await (sb.from('kw') as never as {
      select: (c: string) => { lt: (a: string, b: number) => PromiseLike<Row> }
    })
      .select('kw')
      .lt('kd', 50)) as Row
    // id=3 的 kd 是 null，不该被 lt 选中
    expect(r.data).toEqual([{ kw: 'a' }, { kw: 'b' }])
  })

  it('🔴 少写一个别名，取到的就是 undefined —— 跟生产一样，别惯着', async () => {
    const sb = fakeSupabase({ kw: { rows: [{ search_volume: 200, keyword: 'x' }] } })
    const withAlias = (await (sb.from('kw') as never as { select: (c: string) => PromiseLike<Row> })
      .select('keyword, vol:search_volume')) as Row
    const without = (await (sb.from('kw') as never as { select: (c: string) => PromiseLike<Row> })
      .select('keyword, vol')) as Row
    expect((withAlias.data as Array<{ vol: unknown }>)[0].vol).toBe(200)
    expect((without.data as Array<{ vol: unknown }>)[0].vol).toBeUndefined()
  })

  it('🔴 排序方向真的生效 —— 写反了会取到最早那条而不是最新', async () => {
    const sb = fakeSupabase({ snap: { rows: [{ d: '2026-07-01' }, { d: '2026-08-01' }] } })
    const desc = (await (sb.from('snap') as never as {
      select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<Row> } }
    })
      .select('d')
      .order('d', { ascending: false })
      .limit(1)) as Row
    expect(desc.data).toEqual([{ d: '2026-08-01' }])
  })

  it('maybeSingle 没命中时给 null，不是抛', async () => {
    const sb = fakeSupabase({ t: { rows: [] } })
    const r = (await (sb.from('t') as never as {
      select: (c: string) => { maybeSingle: () => PromiseLike<Row> }
    })
      .select('*')
      .maybeSingle()) as Row
    expect(r.data).toBeNull()
    expect(r.error).toBeNull()
  })

  it('maybeSingle 遇到查询失败要把错误带出来，不能装成「没找到」', async () => {
    const sb = fakeSupabase({ t: { error: 'boom' } })
    const r = (await (sb.from('t') as never as {
      select: (c: string) => { maybeSingle: () => PromiseLike<Row> }
    })
      .select('*')
      .maybeSingle()) as Row
    expect(r.error?.message).toBe('boom')
  })
})
