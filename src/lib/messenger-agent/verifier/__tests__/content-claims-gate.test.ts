/**
 * Acceptance tests for the shared content-claims evaluation (design §4.1, §4.2).
 * Reviewer-written: a claim is only allowed through when it matches a CONFIRMED fact;
 * promises, visa, availability, discount, duration, relative dates and scan errors
 * never pass, whatever facts exist.
 */

import { describe, it, expect } from 'vitest'
import { evaluateClaims } from '../content-claims-gate'

const none = { validPrices: new Set<number>(), validDates: new Set<string>() }

describe('evaluateClaims', () => {
  it('returns null for an ordinary courtesy reply', () => {
    expect(evaluateClaims({ text: '感谢您的留言，我们的顾问稍后回复您。', ...none })).toBeNull()
  })

  it('blocks a Chinese price when no confirmed price exists', () => {
    const r = evaluateClaims({ text: '每人3880纽币', ...none })
    expect(r).not.toBeNull()
    expect(r).toContain('price')
    expect(r).toContain('3880')
  })

  it('lets a Chinese price through only when the amount equals a confirmed price', () => {
    expect(evaluateClaims({ text: '每人3880纽币', validPrices: new Set([3880]), validDates: new Set() })).toBeNull()
    expect(evaluateClaims({ text: '每人三千八百八十纽币', validPrices: new Set([3880]), validDates: new Set() })).toBeNull()
    expect(evaluateClaims({ text: '每人3880纽币', validPrices: new Set([3800]), validDates: new Set() })).not.toBeNull()
  })

  it('colloquial price 三千八 means 3800, not 3880', () => {
    expect(evaluateClaims({ text: '三千八就能走', validPrices: new Set([3880]), validDates: new Set() })).not.toBeNull()
    expect(evaluateClaims({ text: '三千八就能走', validPrices: new Set([3800]), validDates: new Set() })).toBeNull()
  })

  it('absolute dates must equal a confirmed departure date', () => {
    const ok = { validPrices: new Set<number>(), validDates: new Set(['2026-12-31']) }
    expect(evaluateClaims({ text: '有效期至2026年12月31日', ...ok })).toBeNull()
    expect(evaluateClaims({ text: '有效期至2026年12月30日', ...ok })).not.toBeNull()
    expect(evaluateClaims({ text: '有效期至2026年12月31日', ...none })).not.toBeNull()
  })

  it('a month-day without a year matches any confirmed date with that month and day', () => {
    const facts = { validPrices: new Set<number>(), validDates: new Set(['2026-03-18']) }
    expect(evaluateClaims({ text: '3月18号出发', ...facts })).toBeNull()
    expect(evaluateClaims({ text: '4月18号出发', ...facts })).not.toBeNull()
  })

  it('price and date both need support: one unsupported claim blocks the whole reply', () => {
    const facts = { validPrices: new Set([3880]), validDates: new Set<string>() }
    const r = evaluateClaims({ text: '每人3880纽币，3月18号出发', ...facts })
    expect(r).not.toBeNull()
    expect(r).toContain('date')
  })

  it.each([
    '保证出签',
    '新西兰护照免签入境',
    '仅剩2个名额',
    '全网最低价',
    '15天14晚',
    '下周三出发',
    '我们三个工作日内回复您',
  ])('never passes, even with every fact present: %s', (text) => {
    const everything = { validPrices: new Set([3880, 3800, 500]), validDates: new Set(['2026-03-18', '2026-12-31']) }
    expect(evaluateClaims({ text, ...everything })).not.toBeNull()
  })

  it('an English spelled-out price with no numeric value is blocked', () => {
    expect(evaluateClaims({ text: 'only nine hundred NZD', ...none })).not.toBeNull()
  })

  it('fails closed when the input is not a string', () => {
    const r = evaluateClaims({ text: undefined as never, ...none })
    expect(r).not.toBeNull()
  })

  it('reports every unsupported kind in one reason string', () => {
    const r = evaluateClaims({ text: '保证出签，每人3880纽币，3月18号出发', ...none })
    expect(r).toContain('promise')
    expect(r).toContain('price')
    expect(r).toContain('date')
  })
})
