import { describe, expect, it } from 'vitest'
import { containsPriceClaim } from './price-claim'
import { canBackRealPrice } from '@/lib/assets/provenance'

describe('containsPriceClaim — 命中价格声明', () => {
  it.each([
    ['$29/m² 起', '货币前缀 + per-unit'],
    ['From A$1,299 per person', '千分位不被断开'],
    ['NZ$450 twin share', 'NZ$ 前缀'],
    ['Save 40% off this week', '百分比 + off'],
    ['Save 30% this month', '折扣词 + 百分比'],
    ['Only 99 dollars', '拼出来的 dollars'],
    ['Buy 2 for 1 this weekend', 'Buy X for Y 明确报价'],
    ['AUD 88 per m²', 'AUD 前缀'],
    ['SPC flooring 29/sqm installed', '裸单价'],
  ])('%s → 拦（%s）', (text) => {
    expect(containsPriceClaim(text)).toBe(true)
  })
})

describe('containsPriceClaim — 不是价格的正常文案照常放行', () => {
  it.each([
    ['Book your 2026 China tour with us today'],
    ['12 day itinerary through Yunnan'],
    ['Auckland showroom open 7 days'],
    ['We have been doing this for 25 years'],
    [''],
  ])('%s → 放行', (text) => {
    expect(containsPriceClaim(text)).toBe(false)
  })

  /**
   * 硬闸会挡住 FDE 交付,这几条是最常见的误伤源 —— 一旦被当价格拦掉,
   * 正常发帖当场瘫痪。锁死它们比多拦一条重要。
   */
  it.each([
    ['100% Kiwi owned and operated', '裸百分比不是报价'],
    ['100% authentic Sichuan cuisine', '裸百分比不是报价'],
    ['Top 10 for 2026 — where to go next', '裸 "X for Y" 是排行不是报价'],
    ['Open 7 days for walk-in customers', '"7 days for" 不是报价'],
  ])('%s → 放行（%s）', (text) => {
    expect(containsPriceClaim(text)).toBe(false)
  })

  it('空值不炸', () => {
    expect(containsPriceClaim(null)).toBe(false)
    expect(containsPriceClaim(undefined)).toBe(false)
  })

  it('同一段文字连续问两次结果一致（共用的 /g 正则不能残留 lastIndex）', () => {
    const text = 'From $199 per person'
    expect(containsPriceClaim(text)).toBe(true)
    expect(containsPriceClaim(text)).toBe(true)
    expect(containsPriceClaim(text)).toBe(true)
  })
})

/**
 * 闸的完整判定 = 有价格 且 这张图给不了真价背书。
 * 这里锁死「不带价格就不该被拦」——库里 83 张历史素材全是 unknown,一刀切会让发帖瘫痪。
 */
describe('交付闸判定（价格 × 来源）', () => {
  const blocked = (caption: string, source: string) =>
    containsPriceClaim(caption) && !canBackRealPrice(source)

  it('有价格 + 来源不明 → 拦', () => {
    expect(blocked('Spring sale $99', 'unknown')).toBe(true)
  })

  it('有价格 + 图库/AI 图 → 拦', () => {
    expect(blocked('Spring sale $99', 'stock')).toBe(true)
    expect(blocked('Spring sale $99', 'ai_generated')).toBe(true)
  })

  it('有价格 + 客户上传但未逐张确认 → 仍然拦', () => {
    expect(blocked('Spring sale $99', 'client_provided')).toBe(true)
  })

  it('有价格 + 已确认实拍 → 放行', () => {
    expect(blocked('Spring sale $99', 'client_verified')).toBe(false)
    expect(blocked('Spring sale $99', 'fde_shot')).toBe(false)
  })

  it('没价格 → 来源不明也照常放行（不做无条件拦截）', () => {
    expect(blocked('Come see our Auckland showroom', 'unknown')).toBe(false)
    expect(blocked('Come see our Auckland showroom', 'ai_generated')).toBe(false)
  })
})
