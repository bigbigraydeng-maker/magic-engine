import { describe, it, expect } from 'vitest'
import { isSuspect, BASELINE_DRIFT_THRESHOLD } from './baseline-audit'

/**
 * 2026-08-03 真实事故：仪表盘显示 CTS 自然流量「掉了 39%」，
 * 实际是起点填成了总流量（525）、现值只算自然流量（320）；
 * 同一天真实自然流量 226 → 现在 320，是**涨了 42%**。
 *
 * 错的方向感会让人砍掉正在见效的动作 —— 错的数字比没有数字更危险。
 */
describe('isSuspect —— 起点与现值口径是否一致', () => {
  it('🔴 CTS 真实案例：起点 525(总流量) vs 回算 226(自然流量) → 判可疑', () => {
    expect(isSuspect(525, 226)).toBe(true)
  })

  it('🔴 Oztop 真实案例：起点 402 vs 回算 95 → 判可疑', () => {
    expect(isSuspect(402, 95)).toBe(true)
  })

  it('口径一致时不报 —— 小幅波动是正常的，天天误报等于没有告警', () => {
    expect(isSuspect(226, 226)).toBe(false)
    expect(isSuspect(240, 226)).toBe(false) // 差 6%
    expect(isSuspect(210, 226)).toBe(false) // 差 7%
  })

  it('刚好卡在阈值上不报，超过才报', () => {
    const base = 100
    expect(isSuspect(base * (1 + BASELINE_DRIFT_THRESHOLD), base)).toBe(false)
    expect(isSuspect(base * (1 + BASELINE_DRIFT_THRESHOLD) + 0.01, base)).toBe(true)
  })

  it('回算不出来时不报 —— 没有证据就不指控', () => {
    expect(isSuspect(525, null)).toBe(false)
    expect(isSuspect(525, 0)).toBe(false)
  })

  it('起点偏小也报（方向反过来同样是口径错）', () => {
    expect(isSuspect(50, 226)).toBe(true)
  })
})
