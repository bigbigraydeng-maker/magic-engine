/**
 * Draft tests for validateSmartAck. Maintainer will move next to validate.ts.
 */
import { describe, it, expect } from 'vitest'
import { validateSmartAck } from '../validate'
import { AUTOMATED_NOTICE } from '../types'

const GOOD =
  'Thanks for reaching out about a private tour for your family — one of our team will be in touch with the details shortly.'

describe('validateSmartAck — success', () => {
  it('accepts a good reply', () => {
    const r = validateSmartAck(GOOD, [])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe(GOOD)
  })

  it('accepts "One of our team will get back to you" (number check)', () => {
    const r = validateSmartAck('One of our team will get back to you shortly.', [])
    expect(r.ok).toBe(true)
  })

  it('strips the automated notice and returns text without it', () => {
    const r = validateSmartAck(`${GOOD} ${AUTOMATED_NOTICE}`, [])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe(GOOD)
      expect(r.text.includes(AUTOMATED_NOTICE)).toBe(false)
    }
  })

  it('allows "details", "team", "get back to you"', () => {
    const r = validateSmartAck(
      'Our team will get back to you with the details very soon.',
      [],
    )
    expect(r.ok).toBe(true)
  })
})

describe('validateSmartAck — failures', () => {
  const cases: Array<[string, string, string[]]> = [
    ['validate_empty', '', []],
    ['validate_empty', '   ', []],
    ['validate_length', 'Too short.', []],
    ['validate_length', 'a'.repeat(241), []],
    ['validate_language', 'Спасибо за ваше сообщение, мы свяжемся с вами.', []],
    ['validate_language', 'ありがとうございます、すぐにご連絡します。', []],
    ['validate_link_contact', 'Please visit https://example.com for more info.', []],
    ['validate_link_contact', 'See www.example.com for details about us.', []],
    ['validate_link_contact', 'Email us at hello@example.com any time.', []],
    ['validate_link_contact', 'Check example.com for more information.', []],
    ['validate_link_contact', 'Call us on +64 21 555 1234 for help.', []],
    ['validate_number', 'We have 3 guides ready to help you today.', []],
    ['validate_number', 'The price is $100 for the whole group.', []],
    ['validate_number', 'We have two guides ready to help you today.', []],
    ['validate_number', 'We will see you in May for the tour.', []],
    ['validate_identity', 'As an AI, I cannot help with that request.', []],
    ['validate_identity', "I'm Sarah and I will help you today.", []],
    ['validate_identity', 'My name is Alex and I am here to help.', []],
    ['validate_identity', 'I promise we will take great care of you.', []],
    ['validate_forbidden', 'Your booking is confirmed and ready to go.', []],
    ['validate_forbidden', 'This is a free upgrade for your family.', []],
    ['validate_forbidden', 'We will send you the itinerary shortly.', []],
    ['validate_forbidden', 'Your refund has been processed already.', []],
    ['validate_forbidden', 'We will call you tomorrow morning for sure.', []],
    ['validate_forbidden', 'That is definitely a great idea for you.', []],
    ['validate_forbidden', 'No problem at all, we are happy to help.', []],
  ]

  for (const [reason, reply, msgs] of cases) {
    it(`${reason}: ${reply.slice(0, 40)}`, () => {
      const r = validateSmartAck(reply, msgs)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe(reason)
    })
  }
})

describe('validateSmartAck — obfuscations', () => {
  const cases: Array<[string, string]> = [
    ['validate_forbidden', 'This is a pr ice offer for your family.'],
    ['validate_forbidden', 'This is a ｆｒｅｅ upgrade for your family.'],
    ['validate_forbidden', 'Your re\u200Bfund has been processed already.'],
    ['validate_identity', 'We guarantee you will love this tour.'],
    ['validate_forbidden', 'Your booking is confir med and ready to go.'],
  ]
  for (const [reason, reply] of cases) {
    it(`${reason}: ${reply}`, () => {
      const r = validateSmartAck(reply, [])
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe(reason)
    })
  }
})

describe('validateSmartAck — echo', () => {
  it('fails when 6+ consecutive customer words are copied', () => {
    const customer = 'I would really love to explore the Silk Road with my whole family'
    const reply =
      'Thanks for your note — we would love to explore the silk road with my whole family too.'
    const r = validateSmartAck(reply, [customer])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('validate_echo')
  })

  it('allows a 5-word overlap', () => {
    const customer = 'I would really love to explore the Silk Road with my whole family'
    const reply =
      'Thanks for your note — the silk road with you sounds lovely, and our team will reply soon.'
    const r = validateSmartAck(reply, [customer])
    expect(r.ok).toBe(true)
  })
})
