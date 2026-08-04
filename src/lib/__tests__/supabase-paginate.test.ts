/**
 * 分页拉全。
 *
 * 这份测试守的是一个真实事故：Supabase 单次查询硬顶 1000 行，`.limit(20000)`
 * 被静默砍掉且不报错。CTS 库里 1271 条触点只回了 1000 条，被丢掉的恰恰是最老的
 * 记录 —— 一位客户六月说过「下个月左右走」，系统完全看不见，他被永远压在培育里。
 */

import { describe, expect, it } from 'vitest'
import { fetchAll } from '../supabase-paginate'

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
