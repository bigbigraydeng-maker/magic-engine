import { describe, it, expect } from 'vitest'
import { quotaAlert, QUOTA_WARN_PCT } from '../magic-bridge-quota-items'

describe('quotaAlert', () => {
  it('还早：0/30 不提醒', () => {
    expect(quotaAlert(0, 30)).toEqual({ level: 'none', pct: 0 })
  })

  it('还早：30% 不提醒', () => {
    expect(quotaAlert(9, 30)).toEqual({ level: 'none', pct: 30 })
  })

  it('刚好到 80% 就提醒', () => {
    expect(quotaAlert(24, 30)).toEqual({ level: 'warn', pct: 80 })
  })

  it('80% 以上（未满）提醒', () => {
    expect(quotaAlert(29.9, 30)).toEqual({ level: 'warn', pct: 100 })
  })

  it('刚好用满算 full', () => {
    expect(quotaAlert(30, 30)).toEqual({ level: 'full', pct: 100 })
  })

  it('超了也算 full', () => {
    expect(quotaAlert(31, 30)).toEqual({ level: 'full', pct: 103 })
  })

  it('上限为 0 直接算用满（pct=100），不除零', () => {
    expect(quotaAlert(0, 0)).toEqual({ level: 'full', pct: 100 })
  })

  it('上限为负也按用满处理', () => {
    expect(quotaAlert(5, -1)).toEqual({ level: 'full', pct: 100 })
  })

  it('提醒阈值是 80', () => {
    expect(QUOTA_WARN_PCT).toBe(80)
  })
})
