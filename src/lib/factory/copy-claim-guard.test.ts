/**
 * 编造断言硬闸测试 —— 用 2026-07-25 实测捕获的**真实编造样本**做用例。
 *
 * 背景:prompt 里已逐条写明「禁止编造政策/数字」,AI 依然吐出
 * 「Fifteen days」「convert to 30-day tourist visa」「Valid through December 2025」
 * (当时是 2026 年 7 月,该日期既是编的又已过期)。**prompt 是软约束,防不住。**
 * 客户照编错的签证天数行动 = 实质伤害,比编错价格更严重,所以必须有机器可验的闸。
 */

import { describe, expect, it } from 'vitest'
import { allowedClaimsFrom, hasInventedClaim } from './copy-generator'
import type { AdCopy } from './types'

const copyOf = (...lines: string[]): AdCopy => ({
  segments: lines.map((caption, i) => ({ role: i === 0 ? 'hook' : 'middle', caption })),
  endcard: { cta: 'Learn more', offer: [], url: 'https://example.com' },
}) as AdCopy

describe('hasInventedClaim — 真实编造样本(线上实测捕获)', () => {
  const noAllow = new Set<string>()

  it('🔴 拦「Fifteen days」(拼写出来的天数,原价格闸完全漏)', () => {
    expect(hasInventedClaim(copyOf('Fifteen days. No visa application.'), noAllow)).toBe(true)
  })

  it('🔴 拦「30-day tourist visa」(带连字符的天数)', () => {
    expect(hasInventedClaim(copyOf('convert to 30-day tourist visa in-country'), noAllow)).toBe(true)
  })

  it('🔴 拦「Valid through December 2025」(编造且已过期的日期)', () => {
    expect(hasInventedClaim(copyOf('Valid through December 2025.'), noAllow)).toBe(true)
  })

  it('🔴 拦「15-day visa-free entry」(第一轮实测的原句)', () => {
    expect(hasInventedClaim(copyOf('15-day visa-free entry'), noAllow)).toBe(true)
  })

  it('拦裸年份(2026 / 1928 这类断言)', () => {
    expect(hasInventedClaim(copyOf('Trusted since 1928'), noAllow)).toBe(true)
  })

  it('拦各种时间单位:周 / 月 / 小时 / 年', () => {
    for (const s of ['two weeks in China', '3 months ahead', '48 hours to confirm', 'five years running']) {
      expect(hasInventedClaim(copyOf(s), noAllow), s).toBe(true)
    }
  })
})

describe('hasInventedClaim — 不该误杀', () => {
  it('无时间/日期的正常文案放行', () => {
    expect(hasInventedClaim(
      copyOf('Planning made simple', 'We map the logistics', "Let's plan yours together"),
      new Set(),
    )).toBe(false)
  })

  it('🔴 品牌资料里写过的时长 → 放行(资料可溯源才是唯一标准)', () => {
    const allowed = allowedClaimsFrom('CTS has 25 years of Kiwi-led NZ operations.', null)
    expect(hasInventedClaim(copyOf('25 years of NZ operations'), allowed)).toBe(false)
    // 但资料里没有的另一个数字仍要拦
    expect(hasInventedClaim(copyOf('30 years of NZ operations'), allowed)).toBe(true)
  })

  it('连字符/空格写法差异不影响匹配(25-years ≡ 25 years)', () => {
    const allowed = allowedClaimsFrom('25 years of operations', null)
    expect(hasInventedClaim(copyOf('25-years of operations'), allowed)).toBe(false)
  })

  it('PM 人工录入的促销截止日 → 放行(可信来源)', () => {
    const allowed = allowedClaimsFrom('', { price_from: '$42', offer_expiry: 'December 2026' } as never)
    expect(hasInventedClaim(copyOf('Ends December 2026'), allowed)).toBe(false)
  })

  it('数字但非时间单位(如楼层/人数)不被本闸拦(交给价格闸/人工审)', () => {
    expect(hasInventedClaim(copyOf('Level 3 showroom'), new Set())).toBe(false)
  })
})

describe('allowedClaimsFrom — 白名单来源', () => {
  it('从品牌资料原文抽出时长与日期', () => {
    const a = allowedClaimsFrom('Founded 1999. Tours run 7 days. Peak season October 2026.', null)
    expect(a.has('7 days')).toBe(true)
    expect(a.has('1999')).toBe(true)
    expect(a.has('october 2026')).toBe(true)
  })

  it('空资料 → 空白名单(fail-closed:什么时间断言都不许编)', () => {
    expect(allowedClaimsFrom('', null).size).toBe(0)
  })
})
