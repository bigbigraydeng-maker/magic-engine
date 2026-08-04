import { describe, it, expect } from 'vitest'
import { fetchOwnAdActivity, isCurrentlyAdvertising, ACTIVE_SPEND_WINDOW_DAYS } from './own-ad-activity'

function fakeSupabase(rows: unknown[] | null, error = false) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.select = self
  chain.eq = self
  chain.gte = () => Promise.resolve({ data: error ? null : rows, error: error ? { message: 'boom' } : null })
  return { from: () => chain } as never
}

describe('fetchOwnAdActivity —— 「查不到」和「没在投」是两件事', () => {
  it('🔴 查询出错 → hasOwnData=false，**绝不假装成「没在投」**', async () => {
    const a = await fetchOwnAdActivity(fakeSupabase(null, true), 'c1')
    expect(a.hasOwnData).toBe(false)
    expect(isCurrentlyAdvertising(a)).toBe(false)
  })

  it('🔴 一行数据都没有 → 同样是「不知道」，不是「没投」', async () => {
    const a = await fetchOwnAdActivity(fakeSupabase([]), 'c1')
    expect(a.hasOwnData).toBe(false)
  })

  it('有真实花费 → 断定在投', async () => {
    // CTS 2026-08-05 的真实形状：两个系列，合计 NZ$211、上万曝光
    const a = await fetchOwnAdActivity(
      fakeSupabase([
        { insight_date: '2026-08-03', spend: 114.19, impressions: 3871 },
        { insight_date: '2026-08-02', spend: 96.88, impressions: 6183 },
      ]),
      'c1',
    )
    expect(a.hasOwnData).toBe(true)
    expect(a.spend).toBeCloseTo(211.07)
    expect(a.impressions).toBe(10054)
    expect(a.latestDate).toBe('2026-08-03')
    expect(isCurrentlyAdvertising(a)).toBe(true)
  })

  it('🔴 有曝光但零花费 → 不算在投。可能是自然触达或历史残留', async () => {
    const a = await fetchOwnAdActivity(
      fakeSupabase([{ insight_date: '2026-08-03', spend: 0, impressions: 5000 }]),
      'c1',
    )
    expect(a.hasOwnData).toBe(true)
    expect(isCurrentlyAdvertising(a)).toBe(false)
  })

  it('花费字段为 null 不炸', async () => {
    const a = await fetchOwnAdActivity(
      fakeSupabase([{ insight_date: '2026-08-03', spend: null, impressions: null }]),
      'c1',
    )
    expect(a.spend).toBe(0)
    expect(isCurrentlyAdvertising(a)).toBe(false)
  })

  it('窗口是 14 天 —— 给足周末停投和周期性排期的余量', () => {
    expect(ACTIVE_SPEND_WINDOW_DAYS).toBe(14)
  })
})
