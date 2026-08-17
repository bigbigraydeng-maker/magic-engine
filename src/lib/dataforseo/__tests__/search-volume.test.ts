import { describe, it, expect } from 'vitest'
import { deriveTrajectory } from '../search-volume'
import type { MonthlySearchPoint } from '../search-volume'

/** 造 n 个月的点，volumes 按时间升序给（最后一个是最近的月）。 */
function points(volumes: readonly number[]): MonthlySearchPoint[] {
  return volumes.map((searchVolume, i) => ({
    year: 2026,
    month: i + 1,
    searchVolume,
  }))
}

describe('deriveTrajectory', () => {
  it('近 3 月比前 3 月高 10% 以上 → rising', () => {
    expect(deriveTrajectory(points([100, 100, 100, 130, 130, 130]))).toBe('rising')
  })

  it('低 10% 以上 → declining', () => {
    expect(deriveTrajectory(points([200, 200, 200, 100, 100, 100]))).toBe('declining')
  })

  it('±10% 以内 → flat', () => {
    expect(deriveTrajectory(points([100, 100, 100, 105, 105, 105]))).toBe('flat')
  })

  it('🔴 点数不足 6 个 → null，不许折中成 flat', () => {
    expect(deriveTrajectory(points([100, 100, 100, 100, 100]))).toBeNull()
    expect(deriveTrajectory([])).toBeNull()
  })

  it('🔴 前 3 月全 0（分母为 0）→ null，不许算成无穷大涨幅', () => {
    expect(deriveTrajectory(points([0, 0, 0, 500, 500, 500]))).toBeNull()
  })

  it('🔴 只看最后 6 个月，更早的历史不参与', () => {
    // 前半年暴涨过，但最近 6 个月是平的 —— 结果必须是 flat。
    const twelve = points([10, 10, 10, 900, 900, 900, 300, 300, 300, 300, 300, 300])
    expect(deriveTrajectory(twelve)).toBe('flat')
  })

  it('🔴 方向不许算反 —— 输入是时间升序，最后一个才是最近月', () => {
    const recentlyUp = points([50, 50, 50, 500, 500, 500])
    expect(deriveTrajectory(recentlyUp)).toBe('rising')
  })
})
