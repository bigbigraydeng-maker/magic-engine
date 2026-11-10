import { describe, expect, it } from 'vitest'
import { classifyRefusalScope } from '../refusal-scope'
import { DNC_PATTERNS } from '../note-parser'
import {
  CALLBACK_PATTERNS,
  FULL_REFUSAL_PATTERNS,
  OTHER_CHANNEL_OK_PATTERNS,
  PHONE_ONLY_PATTERNS,
  RISK_WORD_PATTERNS,
  TIME_LIMIT_PATTERNS,
} from '../refusal-patterns'

const scope = (s: string | null | undefined) => classifyRefusalScope(s)

describe('只别打电话（明确说电话）', () => {
  it.each([
    'does not want us to call back but please send our 2027 catalog',
    'follow up with best of china not been to mainland china but do not like phone call',
    '7.14大瑞更新， 客户明确说了不要电话，只邮件联系',
    '客人说不要打电话',
    'do not want phone calls',
  ])('判 phone_only: %s', (note) => {
    expect(scope(note)).toBe('phone_only')
  })
})

describe('全面拒绝维持原样 —— 这些一条都不能被放行', () => {
  it.each([
    'do not follow up',
    'no need follow up',
    'does not want to talk',
    'do not want to talk about it',
    '客户直接说不需要联系',
    '别再联系我',
  ])('判 all: %s', (note) => {
    expect(scope(note)).toBe('all')
  })
})

describe('一句话两种意思 —— 不自动判，请人看', () => {
  it.each([
    'just need the email information does not want to talk 9 July',
    '只要邮件，不想谈。客户直接说不需要联系',
    'does not want to call back and do not follow up',
  ])('判 needs_review: %s', (note) => {
    expect(scope(note)).toBe('needs_review')
  })
})

describe('不是拒绝', () => {
  it.each(['', '   ', 'voice mail', 'very interested but not plan to go until end of next year'])(
    '判 none: %j',
    (note) => {
      expect(scope(note)).toBe('none')
    },
  )
  it('null / undefined 当空处理', () => {
    expect(scope(null)).toBe('none')
    expect(scope(undefined)).toBe('none')
  })
})

describe('词表单一来源', () => {
  it('note-parser 的 DNC_PATTERNS 就是全面拒绝词表，不再含电话说法（2B 切换）', () => {
    expect(DNC_PATTERNS).toBe(FULL_REFUSAL_PATTERNS)
    const sources = DNC_PATTERNS.map((p) => p.source)
    expect(sources).not.toContain('不要(打)?电话')
    expect(sources).not.toContain('只邮件联系')
  })
  it('正则都没带 g 标志：连续调用结果一致', () => {
    const all = [
      ...FULL_REFUSAL_PATTERNS,
      ...PHONE_ONLY_PATTERNS,
      ...OTHER_CHANNEL_OK_PATTERNS,
      ...RISK_WORD_PATTERNS,
      ...CALLBACK_PATTERNS,
      ...TIME_LIMIT_PATTERNS,
    ]
    expect(all.filter((p) => p.flags.includes('g'))).toEqual([])
    const s = 'does not want us to call back'
    expect(scope(s)).toBe(scope(s))
    expect(scope(s)).toBe(scope(s))
  })
})

/**
 * 魏征 2026-11-09 P0：最贵的错是把「拒绝所有联系」的人判成只别打电话（会把他放给邮件）。
 * 下面每一条都**不许**是 phone_only。
 */
describe('拒绝所有联系 —— 一条都不许判成只别打电话', () => {
  it.each([
    '不要打电话，不要发邮件',
    '不要电话也不要邮件',
    '不要打电话，也别发短信',
    '不要打电话了，以后都别联系',
    '不要电话 不需要再联系',
    'do not want calls or emails',
    'do not call or email',
    "don't call me, don't email me",
    'do not call, do not contact',
    'do not call. unsubscribe',
    'do not call, remove from list',
    'do not call, take me off your list',
    "don't call. stop contacting me",
    'do not call me, leave me alone',
    'do not phone or text',
    'do not call or message',
    'please do not call or write',
    'do not call. never contact again',
    'do not call, do not send anything',
    'do not phone. delete my details',
    'do not call. will report as spam',
    'do not call, very rude, block',
    'do not call — deceased',
    'customer passed away, do not call',
    'no calls or emails',
    '不要联系',
    '不要再联系',
    '别联系我',
    'unsubscribe',
    'do not contact',
    'not to be contacted',
  ])('不是 phone_only: %s', (note) => {
    expect(['all', 'needs_review']).toContain(scope(note))
  })

  it.each(['unsubscribe', 'do not contact', 'not to be contacted', '不要联系', '不要再联系', '别联系我', 'DNC', 'do not disturb', 'remove me', 'take me off'])(
    '新补的全面拒绝判 all: %s',
    (note) => {
      expect(scope(note)).toBe('all')
    },
  )
})

describe('只别打电话 —— 白名单里的干净说法', () => {
  it.each([
    'does not want us to call back but please send our 2027 catalog',
    '客户明确说了不要电话，只邮件联系',
    'follow up with best of china not been to mainland china but do not like phone call',
    '明确不要电话，email only',
    'no calls pls',
    'stop calling',
    "don't ring me",
    '别打了',
    '少打电话',
    '不要再打电话了',
  ])('判 phone_only: %s', (note) => {
    expect(scope(note)).toBe('phone_only')
  })
})

describe('回电约定 / 时间限定优先 —— 不是拒绝电话', () => {
  it.each(["don't call me today, call back Friday", 'do not call until March'])('判 none: %s', (note) => {
    expect(scope(note)).toBe('none')
  })
})


describe('2B 复核补充（11-09 PM 验收时追加的原话）', () => {
  it.each([
    ['别打电话，别发邮件', 'needs_review'],
    ['别再打电话', 'needs_review'],
    ['Customer prefers email, no phone calls', 'phone_only'],
    ['no phone calls please', 'phone_only'],
  ] as const)('%s => %s', (note, expected) => {
    expect(classifyRefusalScope(note)).toBe(expected)
  })
})

/** 魏征 2026-11-09 复审（169 条探针）后补的规则。 */
describe('复审补丁 P0-1：没兴趣 / 已在别家订了 + 电话说法 → 不许降成只别打电话', () => {
  it.each([
    'not interested do not call',
    'not interested, dont call',
    'already booked elsewhere do not call',
    'not intending to go do not phone',
    '不感兴趣 别打电话了',
    '不感兴趣，不要打电话',
    'not interested do not like phone calls',
  ])('判 needs_review: %s', (note) => {
    expect(scope(note)).toBe('needs_review')
  })
})

describe('复审补丁 P0-gap：漏掉的风险词和全面拒绝', () => {
  it.each(['husband passed, pls dont call', 'Leave us alone dont call', 'stop calling me. stop everything.', 'dont call, stop bothering me'])(
    '不是 phone_only: %s',
    (note) => {
      expect(['all', 'needs_review']).toContain(scope(note))
    },
  )
  it('单纯的 DO NOT CALL!!! 仍是只别打电话', () => {
    expect(scope('DO NOT CALL!!!')).toBe('phone_only')
  })
  it.each(['never call me', 'call me back never', 'never phone me'])('never 一类判 needs_review: %s', (note) => {
    expect(scope(note)).toBe('needs_review')
  })
  it.each([
    'no phone, no email',
    'never call again',
    'no more contact',
    'opt out',
    'STOP',
    'stop!!',
    'does not want to be contacted',
    'not to be called',
    'not to be contacted',
    'delete my number',
    'delete my details',
    'deceased',
    'passed away',
    '客户已去世',
    '去世',
    '不要打扰',
    '别烦我',
    '不想被联系',
    '把我从名单删',
    '永远别打',
    '再打就投诉',
    '不要聯繫我',
    '不要給我打電話也不要發郵件',
  ])('全面拒绝（all 或 needs_review）: %s', (note) => {
    expect(['all', 'needs_review']).toContain(scope(note))
  })
  it('stop 只认单独一个词，句子里的 stop 不算全面拒绝', () => {
    expect(scope('stop by the office next week')).toBe('none')
  })
  it.each([
    'okay to call',
    'please do call',
    'you can call',
    "don't hesitate to call",
    'happy to be called',
    '可以打电话',
    '打电话没问题',
  ])('「可以打电话」一类不是拒绝: %s', (note) => {
    expect(scope(note)).toBe('none')
  })
})

describe('复审补丁 P1-1：时间 / 对象限定不是永久不打电话', () => {
  it.each([
    'no calls on weekends',
    'dont call on sunday',
    'do not call in the evening',
    'pls dont call landline, use mobile',
    'she said do not call her husband, call her mobile',
  ])('判 none: %s', (note) => {
    expect(scope(note)).toBe('none')
  })
})

describe('复审补丁 P2：明确说别的渠道可以 → 只别打电话', () => {
  it.each([
    "don't call me, email is fine",
    'Do not phone. Email instead.',
    '不要打电话，发邮件就行',
    "don't call, only whatsapp",
    "don't call, prefer text",
  ])('判 phone_only: %s', (note) => {
    expect(scope(note)).toBe('phone_only')
  })
})


describe('2B 验收补充：opt out 在旅游备注里常指「不参加自费项目」', () => {
  it.each([
    ['opt out of optional tours, please call me Monday', 'none'],
    ['opt out of the mailing list', 'all'],
    ['client opted out of all emails', 'all'],
    ['客户不想接电话，请发邮件', 'phone_only'],
  ] as const)('%s => %s', (note, expected) => {
    expect(classifyRefusalScope(note)).toBe(expected)
  })
})
