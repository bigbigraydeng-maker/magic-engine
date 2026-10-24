/**
 * Draft tests for triageMessages. Maintainer: move to triage.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { triageMessages } from '../triage'
import type { TriageReason } from '../types'

type Case = { name: string; input: string[]; reason: TriageReason }

const noTextCases: Case[] = [
  { name: 'empty string', input: [''], reason: 'triage_no_text' },
  { name: 'whitespace only', input: ['   '], reason: 'triage_no_text' },
  { name: 'emoji only', input: ['👍'], reason: 'triage_no_text' },
  { name: 'all empty across messages', input: ['', '  ', ''], reason: 'triage_no_text' },
]

const optoutCases: Case[] = [
  { name: 'stop messaging', input: ['Please stop messaging me'], reason: 'triage_optout' },
  { name: 'unsubscribe', input: ['unsubscribe'], reason: 'triage_optout' },
  { name: 'do not contact', input: ['Do not contact me again'], reason: 'triage_optout' },
  { name: 'leave me alone', input: ['Just leave me alone'], reason: 'triage_optout' },
  { name: 'chinese optout', input: ['请不要再发消息了'], reason: 'triage_optout' },
  { name: 'spaced optout', input: ['u n s u b s c r i b e'], reason: 'triage_optout' },
]

const complaintCases: Case[] = [
  {
    name: 'hospital + cancel before numbers',
    input: ['My mum is in hospital, we need to cancel the trip, you ignored my last 3 emails!!!'],
    reason: 'triage_complaint',
  },
  { name: 'refund', input: ['I want a refund'], reason: 'triage_complaint' },
  { name: 'full-width refund', input: ['ｒｅｆｕｎｄ'], reason: 'triage_complaint' },
  { name: 'zero-width refund', input: ['re\u200bfund'], reason: 'triage_complaint' },
  { name: 'lawyer', input: ['I am contacting my lawyer'], reason: 'triage_complaint' },
  { name: 'chinese complaint', input: ['我要投诉'], reason: 'triage_complaint' },
  { name: 'suing', input: ['I am suing you'], reason: 'triage_complaint' },
  { name: 'take legal action', input: ['We will take legal action'], reason: 'triage_complaint' },
  { name: 'see you in court', input: ['See you in court'], reason: 'triage_complaint' },
]

const promiseCases: Case[] = [
  {
    name: 'promised a discount',
    input: ['You promised me a discount yesterday'],
    reason: 'triage_promise',
  },
  {
    name: 'how much',
    input: ['How much for the Golden China tour?'],
    reason: 'triage_promise',
  },
  { name: 'quote', input: ['Can I get a quote please'], reason: 'triage_promise' },
  { name: 'agreed price', input: ['We agreed price last week'], reason: 'triage_promise' },
]

const linkCases: Case[] = [
  { name: 'bit.ly', input: ['Earn big click bit.ly/xx'], reason: 'triage_link_only' },
  { name: 'https', input: ['see https://example.com'], reason: 'triage_link_only' },
  { name: 'www', input: ['visit www.example.com'], reason: 'triage_link_only' },
  { name: 'https spam host', input: ['https://offers.example.com'], reason: 'triage_link_only' },
  {
    name: 'www spam tld',
    input: ['check this www.freemoney.top now'],
    reason: 'triage_link_only',
  },
  {
    name: 'shortener always blocks even with prose',
    input: ['hi https://bit.ly/abc'],
    reason: 'triage_link_only',
  },
]

const shortCases: Case[] = [
  { name: 'hi', input: ['Hi'], reason: 'triage_too_short' },
  { name: 'ok', input: ['ok'], reason: 'triage_too_short' },
]

const nonEnglishCases: Case[] = [
  { name: 'chinese', input: ['我想了解私人定制'], reason: 'triage_non_english' },
  { name: 'cyrillic', input: ['привет'], reason: 'triage_non_english' },
  { name: 'arabic', input: ['مرحبا'], reason: 'triage_non_english' },
  { name: 'accented majority', input: ['élégant école déjà très été'], reason: 'triage_non_english' },
]

const useModelCases: Case[] = [
  {
    name: 'form prefilled with name, phone, month',
    input: [
      'Hello! I filled out your form and would like to know more about your business. Full name: Jane Doe Phone number: 021 555 0100 Which tour interests you most?: Golden China - November',
    ],
    reason: 'triage_no_text',
  },
  {
    name: 'two adults in spring',
    input: ['We are 2 adults travelling in the spring and would love a private tour'],
    reason: 'triage_no_text',
  },
  {
    name: 'wife Sue, New Zealand, May 2027',
    input: [
      'My wife Sue and I are from New Zealand and are planning a private personalised holiday in China in May 2027',
    ],
    reason: 'triage_no_text',
  },
  {
    name: 'about 10 days with family',
    input: ['Looking at a trip for about 10 days with my family'],
    reason: 'triage_no_text',
  },
  {
    name: 'meta prefilled',
    input: ['Hello! Can I get more info on this?'],
    reason: 'triage_no_text',
  },
  {
    name: 'meta prefilled 2',
    input: ["Hi, I'm interested and I'd like more information"],
    reason: 'triage_no_text',
  },
  {
    name: 'private tours',
    input: ["I'd love to learn about your private tours for my family"],
    reason: 'triage_no_text',
  },
  {
    name: 'form dump containing customer email is not a link',
    input: [
      'Hello! I filled out your form and would like to know more about your business. Email: jane.doe@gmail.com Full name: Jane Doe Which tour interests you most?: Golden China - November',
    ],
    reason: 'triage_no_text',
  },
  {
    name: 'prose mentioning a news site is not spam',
    input: [
      'Hi, I read about your China tours on nzherald.co.nz and I would really like to know more about travelling with my family next year',
    ],
    reason: 'triage_no_text',
  },
]

describe('triageMessages - no_text', () => {
  for (const c of noTextCases) {
    it(c.name, () => {
      expect(triageMessages(c.input)).toEqual({ useModel: false, reason: c.reason })
    })
  }
})

describe('triageMessages - optout', () => {
  for (const c of optoutCases) {
    it(c.name, () => {
      expect(triageMessages(c.input)).toEqual({ useModel: false, reason: c.reason })
    })
  }
})

describe('triageMessages - complaint', () => {
  for (const c of complaintCases) {
    it(c.name, () => {
      expect(triageMessages(c.input)).toEqual({ useModel: false, reason: c.reason })
    })
  }
})

describe('triageMessages - promise', () => {
  for (const c of promiseCases) {
    it(c.name, () => {
      expect(triageMessages(c.input)).toEqual({ useModel: false, reason: c.reason })
    })
  }
})

describe('triageMessages - link_only', () => {
  for (const c of linkCases) {
    it(c.name, () => {
      expect(triageMessages(c.input)).toEqual({ useModel: false, reason: c.reason })
    })
  }
})

describe('triageMessages - too_short', () => {
  for (const c of shortCases) {
    it(c.name, () => {
      expect(triageMessages(c.input)).toEqual({ useModel: false, reason: c.reason })
    })
  }
})

describe('triageMessages - non_english', () => {
  for (const c of nonEnglishCases) {
    it(c.name, () => {
      expect(triageMessages(c.input)).toEqual({ useModel: false, reason: c.reason })
    })
  }
})

describe('triageMessages - useModel true', () => {
  for (const c of useModelCases) {
    it(c.name, () => {
      expect(triageMessages(c.input)).toEqual({ useModel: true })
    })
  }
})

describe('triageMessages - CJK promise only asserts useModel false', () => {
  it('请问报价多少 is blocked', () => {
    expect(triageMessages(['请问报价多少']).useModel).toBe(false)
  })
})

describe('triageMessages - near-miss negatives', () => {
  it('"free" inside "freedom" is not a promise hit', () => {
    expect(triageMessages(['I feel freedom on your tours'])).toEqual({ useModel: true })
  })
  it('"sue" as a name is not a complaint', () => {
    expect(triageMessages(['My wife Sue and I are planning a trip'])).toEqual({ useModel: true })
  })
  it('"may" as modal is not a month', () => {
    expect(triageMessages(['I may be interested in your tours'])).toEqual({ useModel: true })
  })
  it('only last 3 non-empty messages are joined', () => {
    expect(
      triageMessages(['refund', '', 'I love your private tours', 'for my family', 'please']),
    ).toEqual({ useModel: true })
  })
})

describe('triageMessages - email is not a link', () => {
  it('long prose containing an email address is not blocked', () => {
    expect(
      triageMessages([
        'Hello! I filled out your form and would like to know more about your business. Email: jane.doe@gmail.com Full name: Jane Doe Which tour interests you most?: Golden China - November',
      ]),
    ).toEqual({ useModel: true })
  })
})

describe('triageMessages — regex state must not leak between calls', () => {
  it('returns the same verdict when the same link-spam message is triaged twice', () => {
    const msg = 'https://offers.example.com'
    const first = triageMessages([msg])
    const second = triageMessages([msg])
    expect(second).toEqual(first)
    expect(first).toEqual({ useModel: false, reason: 'triage_link_only' })
  })
  it('a prose message with an email is not blocked, twice in a row', () => {
    const msg =
      'Hello! I filled out your form and would like to know more about your business. Email: jane.doe@gmail.com Full name: Jane Doe'
    expect(triageMessages([msg])).toEqual({ useModel: true })
    expect(triageMessages([msg])).toEqual({ useModel: true })
  })
})

describe('triageMessages — an email address is not a link (short message)', () => {
  // 变异测试逼出来的用例：长表单消息周围的正文够多，不剥邮箱也照样放行，
  // 所以必须用「只有一句问候 + 自己的邮箱」这种短消息，才真的测到剥邮箱那一步。
  it.each([
    ['greeting plus own email', 'Hi there, my email is jane.doe@gmail.com'],
    ['name and email only', 'Jane Doe jane.doe@xtra.co.nz'],
  ])('%s is not link spam', (_name, msg) => {
    expect(triageMessages([msg])).toEqual({ useModel: true })
  })
})
