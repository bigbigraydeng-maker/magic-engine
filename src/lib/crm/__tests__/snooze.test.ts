/**
 * 「推迟几天」怎么算成一个具体时间。
 *
 * 由服务端算、不接受前端传时间点：这一页同时给新西兰和澳洲的人用，
 * 时区算错就是一个人早一天或晚一天回名单 —— 而且没人会发现。
 */

import { describe, expect, it } from 'vitest'
import { parseSnoozeDays } from '../snooze'

const NOW = new Date('2026-08-03T00:00:00Z')

describe('正常推迟', () => {
  it.each([
    [1, '2026-08-04T00:00:00.000Z'],
    [7, '2026-08-10T00:00:00.000Z'],
    [90, '2026-11-01T00:00:00.000Z'],
    [365, '2027-08-03T00:00:00.000Z'],
  ])('推迟 %s 天', (days, until) => {
    expect(parseSnoozeDays(days, NOW)).toEqual({ ok: true, until })
  })
})

describe('取消推迟', () => {
  it.each([[null], [0]])('%s → 放回名单', (days) => {
    expect(parseSnoozeDays(days, NOW)).toEqual({ ok: true, until: null })
  })
})

describe('不收的输入', () => {
  /**
   * 一年封顶不是怕数字大，是怕**打错**：手滑输成 3650，这个人就在十年里
   * 从名单上彻底消失，而且没有任何地方会提醒谁去看他。
   */
  it('超过一年 → 拒绝，并说清楚范围', () => {
    const r = parseSnoozeDays(366, NOW)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('365')
  })

  it.each([[-1], [0.5], [NaN], [Infinity], ['7'], [{}], [undefined], [true]])(
    '%s → 拒绝',
    (days) => {
      expect(parseSnoozeDays(days, NOW).ok).toBe(false)
    },
  )

  /** 拒绝的时候要说人话 —— 这句会直接显示给销售。 */
  it('拒绝的理由是人话，不是类型名', () => {
    const r = parseSnoozeDays('7', NOW)
    expect(r.ok === false && r.error).toContain('整数')
  })
})

describe('时间从传进来的 now 算，不看系统时钟', () => {
  it('同样的输入 + 同样的 now = 同样的结果', () => {
    const a = parseSnoozeDays(30, new Date('2026-01-01T09:30:00Z'))
    const b = parseSnoozeDays(30, new Date('2026-01-01T09:30:00Z'))
    expect(a).toEqual(b)
    expect(a).toEqual({ ok: true, until: '2026-01-31T09:30:00.000Z' })
  })
})
