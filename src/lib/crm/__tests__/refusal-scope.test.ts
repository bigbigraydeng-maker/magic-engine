import { describe, expect, it } from 'vitest'
import { classifyRefusalScope } from '../refusal-scope'
import { DNC_PATTERNS } from '../note-parser'

const scope = (s: string) => classifyRefusalScope(s)

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

describe('不会回头影响线上的判法', () => {
  it('note-parser 的 DNC_PATTERNS 仍然包含那三条旧的电话说法（第 1 刀不改线上）', () => {
    const sources = DNC_PATTERNS.map((p) => p.source)
    expect(sources).toContain('不要(打)?电话')
    expect(sources).toContain('只邮件联系')
  })
  it('正则都没带 g 标志：连续调用结果一致', () => {
    const s = 'does not want us to call back'
    expect(scope(s)).toBe(scope(s))
  })
})
