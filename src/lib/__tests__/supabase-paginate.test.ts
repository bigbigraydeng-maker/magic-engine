/**
 * 分页拉全。
 *
 * 这份测试守的是一个真实事故：Supabase 单次查询硬顶 1000 行，`.limit(20000)`
 * 被静默砍掉且不报错。CTS 库里 1271 条触点只回了 1000 条，被丢掉的恰恰是最老的
 * 记录 —— 一位客户六月说过「下个月左右走」，系统完全看不见，他被永远压在培育里。
 */

import { describe, expect, it } from 'vitest'
import { fetchAll, fetchAllBatched, fetchAllParallel } from '../supabase-paginate'

/** 假装一张有 n 行的表，每次最多回 1000 行（Supabase 的真实行为）。 */
function fakeTable(n: number, opts: { cap?: number } = {}) {
  const cap = opts.cap ?? 1000
  const calls: Array<[number, number]> = []
  const page = async (from: number, to: number) => {
    calls.push([from, to])
    const size = Math.min(to - from + 1, cap)
    const rows = Array.from({ length: Math.max(0, Math.min(size, n - from)) }, (_, i) => ({
      id: from + i,
    }))
    return { data: rows, error: null }
  }
  return { page, calls }
}

describe('把表真正读全', () => {
  it('刚好一页', async () => {
    const t = fakeTable(1000)
    const rows = await fetchAll(t.page)
    expect(rows).toHaveLength(1000)
  })

  /** 事故复现：1271 行，旧写法只拿 1000 行。 */
  it('超过一页 —— 1271 行必须一行不少（CTS 真实数字）', async () => {
    const t = fakeTable(1271)
    const rows = await fetchAll<{ id: number }>(t.page)
    expect(rows).toHaveLength(1271)
    // 最后一行也要在 —— 丢的就是尾巴
    expect(rows[rows.length - 1].id).toBe(1270)
  })

  it('空表不炸', async () => {
    const t = fakeTable(0)
    expect(await fetchAll(t.page)).toEqual([])
  })

  it('正好两页整（不多拉一次也不漏）', async () => {
    const t = fakeTable(2000)
    const rows = await fetchAll(t.page)
    expect(rows).toHaveLength(2000)
    // 2000 行 = 两满页 + 一次探底
    expect(t.calls.length).toBe(3)
  })

  it('分页区间连续，不重叠也不跳号', async () => {
    const t = fakeTable(2500)
    await fetchAll(t.page)
    expect(t.calls.slice(0, 3)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('报错就抛出来，绝不返回半份数据', async () => {
    await expect(
      fetchAll(async () => ({ data: null, error: { message: '连不上' } })),
    ).rejects.toThrow('连不上')
  })

  /**
   * 安全阀：宁可报错，也不要悄悄给出半份数据 —— 那正是这个函数要解决的病。
   */
  it('触到上限时抛错，而不是安静地少给', async () => {
    const t = fakeTable(10_000)
    await expect(fetchAll(t.page, 2000)).rejects.toThrow(/上限/)
  })
})

describe('有限并行分页', () => {
  it('完整返回多页数据，保持顺序且包括最后一页', async () => {
    const t = fakeTable(7668)
    const rows = await fetchAllBatched(t.page)
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 7668 }, (_, i) => i))
  })

  it('首个整页后并行读取最多三页，完成顺序不会影响结果顺序', async () => {
    const pending: Array<{ from: number; resolve: (value: { data: number[]; error: null }) => void }> = []
    const page = (from: number) => from === 0
      ? Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => i), error: null })
      : new Promise<{ data: number[]; error: null }>((resolve) => pending.push({ from, resolve }))
    const result = fetchAllBatched(page)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pending.map((p) => p.from)).toEqual([1000, 2000, 3000])
    pending[2].resolve({ data: [], error: null })
    pending[1].resolve({ data: [], error: null })
    pending[0].resolve({ data: [1000], error: null })
    expect(await result).toEqual([...Array.from({ length: 1000 }, (_, i) => i), 1000])
  })

  it('所需页面失败或者达到上限时拒绝返回不完整结果', async () => {
    await expect(fetchAllBatched(async (from) => from === 1000
      ? { data: null, error: { message: '读失败' } }
      : { data: Array.from({ length: 1000 }, (_, i) => from + i), error: null })).rejects.toThrow('读失败')
    await expect(fetchAllBatched(fakeTable(5000).page, 2000)).rejects.toThrow(/上限/)
  })
})

describe('先数总数、再把剩下的页一次读完', () => {
  type Row = { id: number }
  const key = (r: Row) => String(r.id)
  /** A table whose content can change between the first page and the later pages. */
  function movingTable(initial: number[], afterFirst?: (rows: number[]) => number[]) {
    let rows = initial
    const calls: Array<[number, number, boolean]> = []
    const page = async (from: number, to: number, withCount: boolean) => {
      calls.push([from, to, withCount])
      const result = { data: rows.slice(from, to + 1).map((id) => ({ id })), error: null, count: withCount ? rows.length : null }
      if (withCount && afterFirst) { rows = afterFirst(rows); afterFirst = undefined }
      return result
    }
    return { page, calls }
  }
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i)

  it('9329 行：一次带总数的首页 + 九页同时读，一行不少、顺序不变', async () => {
    const t = movingTable(ids(9329))
    const rows = await fetchAllParallel<Row>(t.page, key)
    expect(rows.map((r) => r.id)).toEqual(ids(9329))
    expect(t.calls).toHaveLength(10)
    expect(t.calls.filter((c) => c[2])).toEqual([[0, 999, true]])
  })

  it('不满一页只读一次；空表返回空', async () => {
    const small = movingTable(ids(610))
    expect(await fetchAllParallel<Row>(small.page, key)).toHaveLength(610)
    expect(small.calls).toHaveLength(1)
    expect(await fetchAllParallel<Row>(movingTable([]).page, key)).toEqual([])
  })

  it('正好整页（2000 行）不多读也不漏', async () => {
    const t = movingTable(ids(2000))
    expect(await fetchAllParallel<Row>(t.page, key)).toHaveLength(2000)
    expect(t.calls).toHaveLength(2)
  })

  it('两波之间插进新行：改走逐页读，结果仍是完整的新表', async () => {
    const t = movingTable(ids(2500), (rows) => [-1, ...rows])
    const rows = await fetchAllParallel<Row>(t.page, key)
    expect(rows.map((r) => r.id)).toEqual([-1, ...ids(2500)])
  })

  it('两波之间删掉一行：改走逐页读，不返回缺行的结果', async () => {
    const t = movingTable(ids(2500), (rows) => rows.filter((id) => id !== 5))
    const rows = await fetchAllParallel<Row>(t.page, key)
    expect(rows.map((r) => r.id)).toEqual(ids(2500).filter((id) => id !== 5))
  })

  it('拿不到总数就逐页读全', async () => {
    const t = fakeTable(2500)
    const rows = await fetchAllParallel<{ id: number }>((from, to) => t.page(from, to), (r) => String(r.id))
    expect(rows).toHaveLength(2500)
  })

  it('任何一页报错或超过上限都抛错，不给半份数据', async () => {
    const failing = async (from: number, _to: number, withCount: boolean) => from === 1000
      ? { data: null, error: { message: '读失败' }, count: null }
      : { data: ids(1000).map((i) => ({ id: from + i })), error: null, count: withCount ? 3000 : null }
    await expect(fetchAllParallel<Row>(failing, key)).rejects.toThrow('读失败')
    await expect(fetchAllParallel<Row>(movingTable(ids(5000)).page, key, 2000)).rejects.toThrow(/上限/)
  })
})
