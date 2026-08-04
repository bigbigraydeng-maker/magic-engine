/**
 * 「这个人最早从哪来的」。
 *
 * 这只是卡片上一个提示标记，但错了会误导判断 —— 老板拿它看「哪条获客渠道
 * 值钱」，标错就等于把钱投到错的渠道上。所以三件事必须钉住：
 *   ① 取的是**最早**那条，不是最近那条
 *   ② **不靠传进来的顺序** —— 靠顺序的实现会在第二个调用方那里静默出错
 *   ③ 认不出的渠道宁可不标，不瞎标一个
 */

import { describe, expect, it } from 'vitest'
import { firstSourceOf, FIRST_SOURCE_LABEL, type FirstSource } from '../first-source'

const tp = (channel: string, occurredAt: string) => ({ channel, occurredAt })

describe('取最早那条，不是最近那条', () => {
  it('三条往来 → 最早那条的渠道', () => {
    expect(
      firstSourceOf([
        tp('email', '2026-08-01T00:00:00Z'),
        tp('messenger', '2026-06-15T00:00:00Z'),
        tp('phone', '2026-07-01T00:00:00Z'),
      ]),
    ).toBe('messenger')
  })

  /**
   * today 路由拿到的是**倒序**数组（最近的在前）。写成「取第一条」会在那里
   * 正好错成「最近来源」—— 而且看起来完全正常，因为大多数人最近和最早
   * 恰好是同一个渠道。
   */
  it('倒序传进来 → 结果一样', () => {
    const asc = [tp('messenger', '2026-06-15T00:00:00Z'), tp('email', '2026-08-01T00:00:00Z')]
    expect(firstSourceOf(asc)).toBe('messenger')
    expect(firstSourceOf([...asc].reverse())).toBe('messenger')
  })

  it('只有一条 → 就是它', () => {
    expect(firstSourceOf([tp('meta_lead_form', '2026-06-15T00:00:00Z')])).toBe('meta_lead_form')
  })
})

describe('认不出来的不瞎标', () => {
  it('一条往来都没有 → null', () => {
    expect(firstSourceOf([])).toBeNull()
  })

  /** 将来新增渠道时，宁可卡片上不显示，也不要标一个错的。 */
  it('全是没见过的渠道 → null', () => {
    expect(firstSourceOf([tp('whatsapp', '2026-06-01T00:00:00Z'), tp('sms', '2026-06-02T00:00:00Z')])).toBeNull()
  })

  it('混着没见过的渠道 → 只在认识的里面挑最早的', () => {
    expect(
      firstSourceOf([
        tp('whatsapp', '2026-05-01T00:00:00Z'), // 更早，但不认识
        tp('email', '2026-06-01T00:00:00Z'),
        tp('phone', '2026-07-01T00:00:00Z'),
      ]),
    ).toBe('email')
  })
})

describe('脏时间不能冒充最早', () => {
  /** 一条时间解析不出来的记录排到最后，不让它把首次来源顶掉。 */
  it('时间是垃圾字符串 → 不当成最早', () => {
    expect(
      firstSourceOf([tp('phone', '不是时间'), tp('messenger', '2026-06-15T00:00:00Z')]),
    ).toBe('messenger')
  })

  it('全都是脏时间 → 仍然给出一个认识的渠道，不返回 null', () => {
    expect(firstSourceOf([tp('email', 'xxx')])).toBe('email')
  })
})

describe('标记文案', () => {
  it('四个渠道都有图标和名字', () => {
    for (const k of ['messenger', 'meta_lead_form', 'email', 'phone'] as FirstSource[]) {
      expect(FIRST_SOURCE_LABEL[k].icon).not.toBe('')
      expect(FIRST_SOURCE_LABEL[k].label.trim()).not.toBe('')
    }
  })
})
