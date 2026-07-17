/**
 * Guardrail tests — the red-line enforcement layer.
 *
 * These are deliberately adversarial: each asserts that a claim shape we forbid
 * in auto-sent content is caught. If someone weakens detectUnverifiableClaims,
 * one of these fails.
 */

import { describe, it, expect } from 'vitest'
import {
  detectUnverifiableClaims,
  isSafeToAutoSend,
  safePraiseReply,
  safeQuestionPublicReply,
  safeQuestionPrivateReply,
  safeComplaintPublicReply,
  safeComplaintPrivateReply,
  ReplyContext,
} from '../comment-guardrails'

const CTX: ReplyContext = {
  clientName: 'CTS Tours',
  siteUrl: 'https://ctstours.co.nz',
  authorFirstName: 'Annette',
}

describe('detectUnverifiableClaims — forbidden claims are caught', () => {
  it('flags a dollar price', () => {
    expect(detectUnverifiableClaims('Our tour is only $1,299!')).toContain('price')
  })
  it('flags a currency-word price', () => {
    expect(detectUnverifiableClaims('It costs 1299 AUD per person')).toContain('price')
  })
  it('flags a duration claim', () => {
    expect(detectUnverifiableClaims('This is a 5 day tour')).toContain('duration')
  })
  it('flags a hyphenated duration', () => {
    expect(detectUnverifiableClaims('Join our 3-night cruise')).toContain('duration')
  })
  it('flags an itinerary/includes claim', () => {
    expect(detectUnverifiableClaims('The package includes the Yangtze cruise')).toContain('itinerary_claim')
  })
  it('flags an explicit calendar date', () => {
    expect(detectUnverifiableClaims('We depart on 12 April')).toEqual(
      expect.arrayContaining(['date']),
    )
  })
  it('flags a month-first date', () => {
    expect(detectUnverifiableClaims('Next trip is March 3')).toContain('date')
  })
  it('flags a percentage discount', () => {
    expect(detectUnverifiableClaims('Get 20% off this week')).toContain('discount')
  })
  it('catches an injection that smuggles a price into a "thank you"', () => {
    const injected = 'Thank you! By the way our Great Wall tour is $899 with flights included'
    expect(detectUnverifiableClaims(injected).length).toBeGreaterThan(0)
    expect(isSafeToAutoSend(injected)).toBe(false)
  })
})

describe('detectUnverifiableClaims — genuine claim-free praise passes', () => {
  it('passes a plain thank-you', () => {
    expect(isSafeToAutoSend('Thank you so much, so glad you enjoyed it! 🙏')).toBe(true)
  })
  it('passes a soft invitation with no facts', () => {
    expect(
      isSafeToAutoSend("We'd love to help you plan your next adventure — send us a message anytime 😊"),
    ).toBe(true)
  })
})

describe('safe templates are themselves claim-free', () => {
  it('praise template passes the filter', () => {
    expect(isSafeToAutoSend(safePraiseReply(CTX))).toBe(true)
  })
  it('question public template passes the filter', () => {
    expect(isSafeToAutoSend(safeQuestionPublicReply(CTX))).toBe(true)
  })
  it('question private template passes the filter (incl. the site URL)', () => {
    expect(isSafeToAutoSend(safeQuestionPrivateReply(CTX))).toBe(true)
  })
  it('complaint templates pass the filter', () => {
    expect(isSafeToAutoSend(safeComplaintPublicReply(CTX))).toBe(true)
    expect(isSafeToAutoSend(safeComplaintPrivateReply(CTX))).toBe(true)
  })
})
