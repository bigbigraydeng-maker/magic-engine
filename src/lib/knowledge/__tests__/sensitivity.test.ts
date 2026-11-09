/**
 * Sensitivity classifier tests — the first gate of the double-signoff chain
 * (issue #1643). Direction of error only accepts one side: it is fine for a
 * test to demand "must NOT be general", it must never demand "must be
 * general" for anything that plausibly carries a real fact.
 */

import { describe, it, expect } from 'vitest'
import { detectSensitivity, resolveSensitivity, SENSITIVITY_LEVELS } from '../sensitivity'

describe('detectSensitivity — Chinese numerals force non-general (NAL/CTS real patterns)', () => {
  it('spelled-out Chinese numeral duration ("一共十二天") is not general', () => {
    expect(detectSensitivity('这次行程一共十二天')).not.toBe('general')
  })

  it('Chinese numeral quantity ("两箱") is not general', () => {
    expect(detectSensitivity('客人寄了两箱货')).not.toBe('general')
  })

  it('large Chinese numeral ("三千五百块") is not general', () => {
    expect(detectSensitivity('服务费大概三千五百块')).not.toBe('general')
  })
})

describe('detectSensitivity — time + cutoff keyword (NAL real pattern)', () => {
  it('"周五 18:00 截单" is not general (timeline/commitment)', () => {
    const result = detectSensitivity('空运截单时间是周五 18:00')
    expect(result).not.toBe('general')
    expect(['timeline', 'commitment']).toContain(result)
  })

  it('English deadline sentence is not general', () => {
    const result = detectSensitivity('The order deadline is Friday 6pm.')
    expect(result).not.toBe('general')
    expect(['timeline', 'commitment']).toContain(result)
  })
})

describe('detectSensitivity — "12/24" date-shaped string must NOT be misjudged as price', () => {
  it('a bare date-shaped digit pair is not general and is not price', () => {
    // 反例来自 issue #1643：这类日期格式字符串必须判非 general，但不能因为"含数字"
    // 就顺着默认兜底规则误落进 price。它跟真正没有任何线索的裸数字不是同一种情况——
    // "数字/数字"这个形状本身就是日期最常见的写法，判 timeline 比判 price 更贴近它
    // 实际最可能代表的含义（截止日/有效期），也仍然落在"需要客户确认"的敏感范围内。
    const result = detectSensitivity('12/24')
    expect(result).not.toBe('general')
    expect(result).not.toBe('price')
    expect(result).toBe('timeline')
  })

  it('a date-shaped string embedded in a sentence with no other signal resolves the same way', () => {
    const result = detectSensitivity('预计到货 12/24')
    expect(result).not.toBe('general')
    expect(result).not.toBe('price')
  })
})

describe('detectSensitivity — weight/volume-unit + digit combos (travel/logistics pattern) are not general', () => {
  it('kg-tiered rate sentence is not general', () => {
    expect(detectSensitivity('20公斤以下每公斤NZD4，20公斤以上每公斤NZD2')).not.toBe('general')
  })

  it('CBM sea-freight quote sentence is not general', () => {
    expect(detectSensitivity('整柜按38CBM计算,报价另算')).not.toBe('general')
  })

  it('a one-off deal-shaped weight/price line is still not general (dedup vs deal is a separate step, not this classifier)', () => {
    expect(detectSensitivity('138kg × NZD4 = NZD552')).not.toBe('general')
  })
})

describe('detectSensitivity — structured value is scanned the same way as the statement', () => {
  it('digits only in structuredValue still force non-general', () => {
    expect(detectSensitivity('本产品线的分档价目如下', { tiers: [{ maxKg: 20, ratePerKg: 4 }] })).not.toBe(
      'general'
    )
  })

  it('a statement + structuredValue with neither digits nor keywords is general', () => {
    expect(detectSensitivity('我们随时欢迎您的咨询', { note: 'friendly greeting' })).toBe('general')
  })
})

describe('detectSensitivity — Chinese keyword table (>=3 positives)', () => {
  it('保证 → commitment', () => {
    expect(detectSensitivity('我们保证按时送达')).toBe('commitment')
  })
  it('退款 → policy', () => {
    expect(detectSensitivity('七天内可以申请退款')).toBe('policy')
  })
  it('截单 → timeline', () => {
    expect(detectSensitivity('每周五截单')).toBe('timeline')
  })
  it('时效 → timeline', () => {
    expect(detectSensitivity('海运时效约六周')).toBe('timeline')
  })
  it('包运费 → price', () => {
    expect(detectSensitivity('这个价格包运费')).toBe('price')
  })
})

describe('detectSensitivity — English keyword table (>=3 positives)', () => {
  it('guarantee → commitment', () => {
    expect(detectSensitivity('We guarantee on-time delivery.')).toBe('commitment')
  })
  it('refund → policy', () => {
    expect(detectSensitivity('You can request a refund within 7 days.')).toBe('policy')
  })
  it('deadline → timeline', () => {
    expect(detectSensitivity('Please note the booking deadline.')).toBe('timeline')
  })
  it('included → price', () => {
    expect(detectSensitivity('Shipping is included in this quote.')).toBe('price')
  })
})

describe('detectSensitivity — genuinely no signal is general', () => {
  it('a plain greeting with no digits and no keywords is general', () => {
    expect(detectSensitivity('谢谢你的关注，祝你今天愉快')).toBe('general')
  })
  it('a plain English pleasantry is general', () => {
    expect(detectSensitivity('Thanks so much for reaching out, have a great day!')).toBe('general')
  })
})

describe('resolveSensitivity — missing/unknown values must default to price, never general', () => {
  it('undefined defaults to price', () => {
    expect(resolveSensitivity(undefined)).toBe('price')
  })
  it('null defaults to price', () => {
    expect(resolveSensitivity(null)).toBe('price')
  })
  it('empty string defaults to price', () => {
    expect(resolveSensitivity('')).toBe('price')
  })
  it('an unrecognised string defaults to price', () => {
    expect(resolveSensitivity('urgent')).toBe('price')
  })
  it('a valid known level passes through unchanged', () => {
    for (const level of SENSITIVITY_LEVELS) {
      expect(resolveSensitivity(level)).toBe(level)
    }
  })
})
