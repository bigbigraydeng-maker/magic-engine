/**
 * `event-window.ts` 边界测试：按精确时间判，不按取整后的天数。
 * 2026-09-19 CTS 事故就出在 7.0–7.99 天这一段——取整后是「7」，被当成没过期。
 */
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_SAFETY_MARGIN_MS,
  DAY_MS,
  approvalCutoffIso,
  isPastEventWindow,
  isTooLateToApprove,
} from '../event-window'

const NOW = new Date('2026-09-26T17:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

describe('isPastEventWindow（发送前最终把关，零余量）', () => {
  it('6.99 天 → 还在窗口内', () => {
    expect(isPastEventWindow(ago(6.99 * DAY_MS), NOW)).toBe(false)
  })
  it('正好 7.0 天 → 还在窗口内（平台拒收的是「超过」7 天）', () => {
    expect(isPastEventWindow(ago(7 * DAY_MS), NOW)).toBe(false)
  })
  it('7.0 天多 1 毫秒 → 已过期', () => {
    expect(isPastEventWindow(ago(7 * DAY_MS + 1), NOW)).toBe(true)
  })
  it('🔴 7.01 天 → 已过期（旧的取整口径会把它算成「7 天、没过期」）', () => {
    expect(isPastEventWindow(ago(7.01 * DAY_MS), NOW)).toBe(true)
    expect(Math.floor(7.01) > 7).toBe(false) // 旧口径的漏洞本身
  })
  it('7.99 天 → 已过期', () => {
    expect(isPastEventWindow(ago(7.99 * DAY_MS), NOW)).toBe(true)
  })
  it('窗口天数可传入（发送前把关用 writer 自己的 maxEventAgeDays）', () => {
    expect(isPastEventWindow(ago(3.5 * DAY_MS), NOW, 3)).toBe(true)
    expect(isPastEventWindow(ago(2.5 * DAY_MS), NOW, 3)).toBe(false)
  })
})

describe('isTooLateToApprove（AI 批准前，留 1 小时余量）', () => {
  it('6.9 天 → 还来得及批', () => {
    expect(isTooLateToApprove(ago(6.9 * DAY_MS), NOW)).toBe(false)
  })
  it('正好差 1 小时到 7 天 → 还来得及批', () => {
    expect(isTooLateToApprove(ago(7 * DAY_MS - APPROVAL_SAFETY_MARGIN_MS), NOW)).toBe(false)
  })
  it('差不到 1 小时到 7 天 → 来不及批', () => {
    expect(isTooLateToApprove(ago(7 * DAY_MS - APPROVAL_SAFETY_MARGIN_MS + 1), NOW)).toBe(true)
  })
  it('6.99 天（差约 14 分钟）→ 来不及批', () => {
    expect(isTooLateToApprove(ago(6.99 * DAY_MS), NOW)).toBe(true)
  })
  it('7.0 天、7.01 天 → 来不及批', () => {
    expect(isTooLateToApprove(ago(7 * DAY_MS), NOW)).toBe(true)
    expect(isTooLateToApprove(ago(7.01 * DAY_MS), NOW)).toBe(true)
  })
})

describe('approvalCutoffIso（数据库查询版分界线）', () => {
  it('跟 isTooLateToApprove 同一条线：早于分界线 ⇔ 来不及批', () => {
    const cutoff = approvalCutoffIso(NOW)
    const cutoffMs = Date.parse(cutoff)
    for (const occurredMs of [cutoffMs - 1, cutoffMs, cutoffMs + 1]) {
      const iso = new Date(occurredMs).toISOString()
      expect(occurredMs < cutoffMs).toBe(isTooLateToApprove(iso, NOW))
    }
  })
})
