/**
 * Acceptance tests for the outbound claim scanner (design:
 * docs/specs/2026-10-14-outbound-gate-consolidation-design.md §4.5).
 *
 * Written by the reviewer, not the implementer, on purpose: the implementer's own
 * fixtures tend to agree with its own regexes. Every "must block" row here is a real
 * way a price / date / promise reaches a customer in Chinese or in English.
 */

import { describe, it, expect } from 'vitest'
import { scanOutboundClaims, type ClaimKind } from '../outbound-claims'

function kinds(text: string): ClaimKind[] {
  return scanOutboundClaims(text).map((h) => h.kind)
}
function valueOf(text: string, kind: ClaimKind): string | undefined {
  return scanOutboundClaims(text).find((h) => h.kind === kind)?.value
}

describe('price — must block, with normalised amount', () => {
  const cases: Array<[string, string]> = [
    ['每人3880纽币', '3880'],
    ['每人３８８０纽币', '3880'], // full-width
    ['三千八百八十纽币一位', '3880'],
    ['叁仟捌佰捌拾元整', '3880'],
    ['3880刀', '3880'],
    ['3880块', '3880'],
    ['3880蚊', '3880'],
    ['新币3880', '3880'],
    ['新西兰元3880', '3880'],
    ['NZD 3880', '3880'],
    ['NZ$3,880', '3880'],
    ['三千八就能走', '3800'],
    ['3千8', '3800'],
    ['3.88k', '3880'],
    ['3.8k', '3800'],
    ['单房差另加五百', '500'],
    ['价格 3 8 8 0', '3880'], // spaces between digits
    ['价格3️⃣8️⃣8️⃣0️⃣', '3880'], // keycap emoji digits
    ['价格3​880纽币', '3880'], // zero-width char inside the number
  ]
  it.each(cases)('%s', (text, amount) => {
    expect(kinds(text)).toContain('price')
    expect(valueOf(text, 'price')).toBe(amount)
  })
})

describe('date — must block, with normalised value', () => {
  const cases: Array<[string, string]> = [
    ['3月18号出发', '03-18'],
    ['三月十八日出发', '03-18'],
    ['3月18日', '03-18'],
    ['有效期至2026年12月31日', '2026-12-31'],
    ['有效期到2026/12/31', '2026-12-31'],
    ['12月31日截止', '12-31'],
  ]
  it.each(cases)('%s', (text, value) => {
    expect(kinds(text)).toContain('date')
    expect(valueOf(text, 'date')).toBe(value)
  })

  it.each(['下周三出发', '这个周末', '圣诞前报名', '国庆期间', '下个月出发', '春节前'])(
    'relative date: %s',
    (text) => {
      expect(kinds(text)).toContain('date')
    },
  )
})

describe('duration / response-time promise — must block', () => {
  it.each(['15天14晚', '十五日游', '两周行程', '我们三个工作日内回复您', '24小时内回复', '三天后给您答复'])(
    '%s',
    (text) => {
      expect(kinds(text)).toContain('duration')
    },
  )
})

describe('promise / visa / availability / discount — must block with no fact lookup', () => {
  it.each(['保证出签', '包过签', '一定能过', '百分百出签', '确保成功', '全额退款没问题'])('promise: %s', (text) => {
    expect(kinds(text)).toContain('promise')
  })
  it.each(['新西兰护照免签入境', '您不需要办签证', '签证一般都能通过', '拒签的话怎么办'])('visa: %s', (text) => {
    expect(kinds(text)).toContain('visa')
  })
  it.each(['仅剩2个名额', '名额有限，抓紧', '还有位置', '已经满团了', '余位不多'])('availability: %s', (text) => {
    expect(kinds(text)).toContain('availability')
  })
  it.each(['全网最低价', '免费升级', '现在报名有优惠', '立减200', '免费赠送行李箱'])('discount: %s', (text) => {
    expect(kinds(text)).toContain('discount')
  })
})

describe('embedding does not hide a claim', () => {
  const claim = '保证出签，每人3880纽币，3月18号出发'
  it('in the middle of ordinary courtesy', () => {
    const t = `您好，感谢您的咨询。${claim}。期待您的回复。`
    expect(kinds(t)).toEqual(expect.arrayContaining(['promise', 'price', 'date']))
  })
  it('repeated three times', () => {
    expect(kinds(claim.repeat(3))).toEqual(expect.arrayContaining(['promise', 'price', 'date']))
  })
  it('at the end of a 1700-character message', () => {
    const t = '感谢您的留言，我们的顾问会尽快联系您。'.repeat(90) + claim
    expect(t.length).toBeGreaterThan(1700)
    expect(kinds(t)).toEqual(expect.arrayContaining(['promise', 'price', 'date']))
  })
})

describe('English — same scanner, same strictness', () => {
  it.each([
    ['only nine hundred NZD for the trip', 'price'],
    ['NZ $ 3 880 per person', 'price'],
    ['AUD 900 per person', 'price'],
    ['departs 16 November 2026', 'date'],
    ['valid until Dec 31', 'date'],
    ['we guarantee your visa', 'promise'],
    ['only 2 seats left', 'availability'],
    ['a 15 day tour', 'duration'],
  ] as Array<[string, ClaimKind]>)('%s', (text, kind) => {
    expect(kinds(text)).toContain(kind)
  })
})

describe('fail closed', () => {
  it('a non-string input is reported as a hit, never as clean', () => {
    const scanAnything = (v: unknown) => scanOutboundClaims(v as never)
    expect(scanAnything(undefined).map((h) => h.kind)).toContain('scan_error')
    expect(scanAnything(null).map((h) => h.kind)).toContain('scan_error')
    expect(scanAnything(12345).map((h) => h.kind)).toContain('scan_error')
  })
})

describe('must pass — no false alarm on ordinary replies', () => {
  it.each([
    '感谢您的留言，我们的顾问稍后回复您。',
    '您好，请问大概几位出行？',
    '我帮你问一下同事，稍后回你',
    '您说的是新西兰南岛吗？',
    '欢迎随时联系我们，期待为您服务。',
    '团页在这里：https://ctstours.co.nz/tours/south-island?utm_campaign=me_daily_plan&utm_content=20261014',
    'Thanks for your message — one of our team will get back to you with the details shortly.',
    'Hi there, thanks for your interest. One of our consultants will be in touch.',
  ])('%s', (text) => {
    expect(scanOutboundClaims(text)).toEqual([])
  })
})
