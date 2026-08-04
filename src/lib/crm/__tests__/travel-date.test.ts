/**
 * 出行时间解析。
 *
 * 用例不是编的 —— 全部是 2026-07 从 CTS 库里抽出来的真实原话全集
 * （19 个人说过的 11 种说法）。这份解析决定一个人什么时候被捞回销售名单，
 * 错了就是在错误的时间打扰客户，或者干脆错过他。
 */

import { describe, expect, it } from 'vitest'
import { resolveTravelDate, isDueToWake, LEAD_DAYS } from '../travel-date'

/** 这些话都是 2026 年 7 月说的。「明年」= 2027，全靠这个基准。 */
const SAID = new Date('2026-07-20T00:00:00Z')

const month = (iso: string | null) => (iso ? iso.slice(0, 7) : null)

describe('CTS 真实原话（库里抽的全集）', () => {
  it('明年三月 → 2027-03', () => {
    expect(month(resolveTravelDate('明年三月', SAID))).toBe('2027-03')
  })

  it('2027 年三月 → 2027-03（写了年份也认中文月）', () => {
    expect(month(resolveTravelDate('2027 年三月', SAID))).toBe('2027-03')
  })

  it('明年 → 2027 年初（只说年份就保守取年头，宁可早联系）', () => {
    expect(month(resolveTravelDate('明年', SAID))).toBe('2027-01')
  })

  it('明年初 → 2027-01', () => {
    expect(month(resolveTravelDate('明年初', SAID))).toBe('2027-01')
  })

  it('next year → 2027 年初', () => {
    expect(month(resolveTravelDate('next year', SAID))).toBe('2027-01')
  })

  it('2027 年底 → 2027-11（年底按 11 月，留出跟进时间）', () => {
    expect(month(resolveTravelDate('2027 年底', SAID))).toBe('2027-11')
  })

  it('2026 年 11 月 → 2026-11', () => {
    expect(month(resolveTravelDate('2026 年 11 月', SAID))).toBe('2026-11')
  })

  it('2027 年 5 月 → 2027-05', () => {
    expect(month(resolveTravelDate('2027 年 5 月', SAID))).toBe('2027-05')
  })

  it('2027/2028 → 取头一年 2027', () => {
    expect(month(resolveTravelDate('2027/2028', SAID))).toBe('2027-01')
  })

  it('2026-10-15 → 2026-10（已经是标准日期）', () => {
    expect(month(resolveTravelDate('2026-10-15', SAID))).toBe('2026-10')
  })

  it('下个月左右 → 说话那个月的下一个月', () => {
    expect(month(resolveTravelDate('下个月左右', SAID))).toBe('2026-08')
  })
})

describe('一律相对「说话那一刻」算', () => {
  it('同一句「明年三月」，2026 年说和 2027 年说不是同一年', () => {
    const a = resolveTravelDate('明年三月', new Date('2026-07-20T00:00:00Z'))
    const b = resolveTravelDate('明年三月', new Date('2027-07-20T00:00:00Z'))
    expect(month(a)).toBe('2027-03')
    expect(month(b)).toBe('2028-03')
  })

  it('只说月份没说年 → 取下一个还没到的那个月', () => {
    // 7 月说「三月」，指的是明年三月（今年的已经过了）
    expect(month(resolveTravelDate('三月', SAID))).toBe('2027-03')
    // 7 月说「11 月」，指的是今年的
    expect(month(resolveTravelDate('11 月', SAID))).toBe('2026-11')
  })

  it('两个月后 / 三周后', () => {
    expect(month(resolveTravelDate('两个月后', SAID))).toBe('2026-09')
    expect(month(resolveTravelDate('3 周后', SAID))).toBe('2026-08')
  })
})

describe('认不出来就说认不出来', () => {
  it.each(['', '   ', '看情况', '还没定', 'sometime'])('「%s」→ null', (v) => {
    expect(resolveTravelDate(v, SAID)).toBeNull()
  })

  it('null / undefined 不炸', () => {
    expect(resolveTravelDate(null, SAID)).toBeNull()
    expect(resolveTravelDate(undefined, SAID)).toBeNull()
  })

  /**
   * 这条是这份文件的重点：猜一个日期出来，比承认不知道更糟 ——
   * 它会让人在错误的时间被捞回名单，销售打过去客户一脸茫然。
   */
  it('说不清的话绝不猜一个日期出来', () => {
    expect(resolveTravelDate('等我想想', SAID)).toBeNull()
    expect(resolveTravelDate('明天再说', SAID)).toBeNull()
  })
})

describe('什么时候该把人捞回名单', () => {
  const NOW = new Date('2026-07-20T00:00:00Z')

  it('出行前 60 天开始跟', () => {
    expect(LEAD_DAYS).toBe(60)
  })

  it('还早 —— 不打扰', () => {
    expect(isDueToWake('2027-03-01T00:00:00Z', NOW)).toBe(false)
  })

  it('到跟进窗口了 —— 捞回来', () => {
    // 2026-09-01 出行，提前 60 天 = 2026-07-03 就该开始跟，现在 7-20 早过了
    expect(isDueToWake('2026-09-01T00:00:00Z', NOW)).toBe(true)
  })

  it('出行时间已经过去 —— 也算到期（该问问走得怎么样）', () => {
    expect(isDueToWake('2026-05-01T00:00:00Z', NOW)).toBe(true)
  })

  it('没有出行时间的人不受影响', () => {
    expect(isDueToWake(null, NOW)).toBe(false)
    expect(isDueToWake('说不清', NOW)).toBe(false)
  })
})
