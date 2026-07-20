/**
 * Guardrail tests — the red-line enforcement layer.
 *
 * Adversarial by design. Includes the escape strings a red-team pass found
 * against the first (form-based) filter — currency-first, spelled-out numbers,
 * numeric dates, minutes, "percent", past-tense "included", full-width chars.
 * If someone weakens the filter, one of these fails.
 */

import { describe, it, expect } from 'vitest'
import {
  detectUnverifiableClaims,
  isSafeToAutoSend,
  isPraiseReplySafe,
  safePraiseReply,
  safeQuestionPublicReplyNoDm,
  safeQuestionPublicReplyWithDm,
  safeQuestionPrivateReply,
  safeComplaintPublicReplyNoDm,
  safeComplaintPublicReplyWithDm,
  safeComplaintPrivateReply,
  ReplyContext,
} from '../comment-guardrails'

const CTX: ReplyContext = {
  clientName: 'CTS Tours',
  siteUrl: 'https://ctstours.co.nz',
  authorFirstName: 'Annette',
}

describe('detectUnverifiableClaims — obvious claims', () => {
  it('flags a dollar price', () => {
    expect(detectUnverifiableClaims('Our tour is only $1,299!')).toContain('price')
  })
  it('flags a duration claim', () => {
    expect(detectUnverifiableClaims('This is a 5 day tour')).toContain('duration')
  })
  it('flags an itinerary/includes claim', () => {
    expect(detectUnverifiableClaims('The package includes the Yangtze cruise')).toContain('itinerary_claim')
  })
  it('flags a percentage discount', () => {
    expect(detectUnverifiableClaims('Get 20% off this week')).toContain('discount')
  })
})

describe('detectUnverifiableClaims — red-team escape strings are now caught', () => {
  const escapes: Array<[string, string, string]> = [
    ['currency-first AUD', 'AUD 900 per person', 'price'],
    ['currency-first NZD', 'just NZD 500', 'price'],
    ['spelled-out dollars', 'only nine hundred dollars for the trip', 'price'],
    ['full-width price', '＄９００ total', 'price'],
    ['spelled-out duration', 'a lovely five day trip', 'duration'],
    ['week-long', 'a week-long adventure', 'duration'],
    ['minutes dimension', 'the show runs for 90 minutes', 'duration'],
    ['hrs abbrev', 'about 48 hrs on the road', 'duration'],
    ['numeric date', 'we go on 08/06/2026', 'date'],
    ['iso date', 'departs 2026-06-08', 'date'],
    ['relative date', 'leaving next weekend', 'date'],
    ['percent word', 'twenty percent off', 'discount'],
    ['half price', 'half price this month', 'discount'],
    ['past-tense included', 'the tour included the cable car', 'itinerary_claim'],
    ['we arrange', 'we arrange a private guide', 'itinerary_claim'],
    ['guarantee', 'we guarantee the lowest price', 'itinerary_claim'],
    ['airport pickup', 'we do airport pickup for you', 'itinerary_claim'],
  ]
  for (const [name, text, flag] of escapes) {
    it(`catches: ${name}`, () => {
      expect(detectUnverifiableClaims(text)).toContain(flag)
    })
  }
})

describe('isPraiseReplySafe — any digit / link / handle blocks an LLM praise reply', () => {
  it('rejects a spelled-out price the regex might miss, via a different lens', () => {
    // even if a claim escaped the regex, a praise reply with a link is blocked
    expect(isPraiseReplySafe('Thanks! Book at ctstours.co.nz')).toBe(false)
  })
  it('rejects any digit', () => {
    expect(isPraiseReplySafe('Thanks, see you in 2026!')).toBe(false)
  })
  it('rejects an @ handle', () => {
    expect(isPraiseReplySafe('Thanks! DM @ctstours')).toBe(false)
  })
  it('accepts a genuine claim-free thank-you', () => {
    expect(isPraiseReplySafe('Thank you so much, so glad you enjoyed it! 🙏')).toBe(true)
  })
})

describe('genuine claim-free praise passes', () => {
  it('passes a plain thank-you', () => {
    expect(isSafeToAutoSend('Thank you so much, so glad you enjoyed it! 🙏')).toBe(true)
  })
})

describe('safe templates are themselves claim-free (all variants)', () => {
  it('praise variants all pass + rotate', () => {
    const a = safePraiseReply(CTX, 0)
    const b = safePraiseReply(CTX, 1)
    expect(isSafeToAutoSend(a)).toBe(true)
    expect(isSafeToAutoSend(b)).toBe(true)
    expect(a).not.toEqual(b) // rotation avoids a botted-looking feed
  })
  it('question templates pass (no-DM + with-DM + private)', () => {
    expect(isSafeToAutoSend(safeQuestionPublicReplyNoDm(CTX))).toBe(true)
    expect(isSafeToAutoSend(safeQuestionPublicReplyWithDm(CTX))).toBe(true)
    expect(isSafeToAutoSend(safeQuestionPrivateReply(CTX))).toBe(true)
  })
  it('complaint templates pass (no-DM + with-DM + private)', () => {
    expect(isSafeToAutoSend(safeComplaintPublicReplyNoDm(CTX))).toBe(true)
    expect(isSafeToAutoSend(safeComplaintPublicReplyWithDm(CTX))).toBe(true)
    expect(isSafeToAutoSend(safeComplaintPrivateReply(CTX))).toBe(true)
  })
  it('no-DM variants do NOT claim a message was sent', () => {
    expect(safeQuestionPublicReplyNoDm(CTX).toLowerCase()).not.toContain('sent you a message')
    expect(safeComplaintPublicReplyNoDm(CTX).toLowerCase()).not.toContain('private message')
  })
})
