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
]

const numbersCases: Case[] = [
  { name: 'two adults in May', input: ['We want 2 adults in May'], reason: 'triage_numbers' },
  { name: 'price word', input: ['What is the price?'], reason: 'triage_numbers' },
  { name: 'currency', input: ['Budget is $500'], reason: 'triage_numbers' },
  { name: 'spelled number', input: ['We have three kids'], reason: 'triage_numbers' },
  { name: 'month name', input: ['Thinking about September'], reason: 'triage_numbers' },
  { name: 'chinese numeral', input: ['我们三个人'], reason: 'triage_numbers' },
]

const linkCases: Case[] = [
  { name: 'bit.ly', input: ['Earn big click bit.ly/xx'], reason: 'triage_link_only' },
  { name: 'https', input: ['see https://example.com'], reason: 'triage_link_only' },
  { name: 'www', input: ['visit www.example.com'], reason: 'triage_link_only' },
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
  { name: 'meta prefilled', input: ['Hello! Can I get more info on this?'], reason: 'triage_no_text' },
  { name: 'meta prefilled 2', input: ["Hi, I'm interested and I'd like more information"], reason: 'triage_no_text' },
  { name: 'private tours', input: ["I'd love to learn about your private tours for my family"], reason: 'triage_no_text' },
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

describe('triageMessages - numbers', () => {
  for (const c of numbersCases) {
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

describe('triageMessages - near-miss negatives', () => {
  it('"may" as modal is not a month', () => {
    expect(triageMessages(['I may be interested in your tours'])).toEqual({ useModel: true })
  })
  it('"free" inside a word is not numbers', () => {
    expect(triageMessages(['I feel freedom on your tours'])).toEqual({ useModel: true })
  })
  it('"sue" inside a word is not complaint', () => {
    expect(triageMessages(['I want to pursue the issue'])).toEqual({ useModel: true })
  })
  it('"may" preceded by "in" is a month', () => {
    expect(triageMessages(['We are coming in May'])).toEqual({
      useModel: false,
      reason: 'triage_numbers',
    })
  })
  it('"may" followed by digit is a month', () => {
    expect(triageMessages(['May 5 works for us'])).toEqual({
      useModel: false,
      reason: 'triage_numbers',
    })
  })
  it('only last 3 non-empty messages are joined', () => {
    expect(
      triageMessages(['refund', '', 'I love your private tours', 'for my family', 'please']),
    ).toEqual({ useModel: true })
  })
})
