/**
 * Decision-engine tests — decideByCategory maps an LLM classification to a
 * guardrailed reply. Pure function, no network. Proves the LLM is never
 * trusted to answer a factual question, that a claim-laden or low-confidence
 * praise draft is replaced by a safe template, and that DM-first public
 * variants exist.
 */

import { describe, it, expect } from 'vitest'
import { decideByCategory, PRAISE_CONFIDENCE_THRESHOLD } from '../comment-classifier'
import { isSafeToAutoSend, ReplyContext } from '../comment-guardrails'

const CTX: ReplyContext = {
  clientName: 'CTS Tours',
  siteUrl: 'https://ctstours.co.nz',
  authorFirstName: 'Dave',
}

describe('decideByCategory — praise', () => {
  it('uses the LLM draft when confident and claim-free', () => {
    const d = decideByCategory(
      { category: 'praise', confidence: 0.95, purchase_intent: false, praise_reply: 'So glad you loved it, thank you! 🙏' },
      CTX,
    )
    expect(d.replySource).toBe('llm')
    expect(d.publicReply).toContain('thank you')
    expect(d.needsHuman).toBe(false)
    expect(d.privateReply).toBeNull()
  })

  it('falls back to a safe template when the LLM draft smuggles a price', () => {
    const d = decideByCategory(
      { category: 'praise', confidence: 0.95, purchase_intent: false, praise_reply: 'Thanks! Our tour is $999 with flights included' },
      CTX,
    )
    expect(d.replySource).toBe('fallback')
    expect(isSafeToAutoSend(d.publicReply!)).toBe(true)
  })

  it('falls back when the draft has any digit (spelled-out escapes still blocked by whitelist)', () => {
    const d = decideByCategory(
      { category: 'praise', confidence: 0.95, purchase_intent: false, praise_reply: 'Thanks, see you in 2026!' },
      CTX,
    )
    expect(d.replySource).toBe('fallback')
  })

  it('falls back when confidence is below threshold even if the draft is clean', () => {
    const d = decideByCategory(
      { category: 'praise', confidence: PRAISE_CONFIDENCE_THRESHOLD - 0.01, purchase_intent: false, praise_reply: 'Thank you! 🙏' },
      CTX,
    )
    expect(d.replySource).toBe('fallback')
  })

  it('adds a DM only when purchase intent is signalled', () => {
    const withIntent = decideByCategory(
      { category: 'praise', confidence: 0.95, purchase_intent: true, praise_reply: 'Thank you! 🙏' },
      CTX,
    )
    expect(withIntent.privateReply).not.toBeNull()
    expect(isSafeToAutoSend(withIntent.privateReply!)).toBe(true)
  })
})

describe('decideByCategory — question never gets an LLM answer', () => {
  it('routes to safe no-DM + with-DM public variants + human, ignoring any leaked praise_reply', () => {
    const d = decideByCategory(
      { category: 'question', confidence: 0.95, purchase_intent: true, praise_reply: 'It costs $1299 for 5 days' },
      CTX,
    )
    expect(d.needsHuman).toBe(true)
    expect(d.replySource).toBe('fallback')
    expect(isSafeToAutoSend(d.publicReply!)).toBe(true)
    expect(isSafeToAutoSend(d.publicReplyAfterDm!)).toBe(true)
    expect(isSafeToAutoSend(d.privateReply!)).toBe(true)
    expect(d.publicReply).not.toContain('1299')
    expect(d.publicReplyAfterDm).not.toContain('1299')
    // no-DM variant must not falsely claim a DM was sent
    expect(d.publicReply!.toLowerCase()).not.toContain('sent you a message')
  })
})

describe('decideByCategory — complaint / spam / other', () => {
  it('complaint → empathetic no-DM + with-DM variants + human', () => {
    const d = decideByCategory(
      { category: 'complaint', confidence: 0.7, purchase_intent: false, praise_reply: null },
      CTX,
    )
    expect(d.needsHuman).toBe(true)
    expect(d.shouldHide).toBe(false)
    expect(isSafeToAutoSend(d.publicReply!)).toBe(true)
    expect(isSafeToAutoSend(d.publicReplyAfterDm!)).toBe(true)
  })

  it('spam → hide, no reply', () => {
    const d = decideByCategory(
      { category: 'spam', confidence: 0.9, purchase_intent: false, praise_reply: null },
      CTX,
    )
    expect(d.shouldHide).toBe(true)
    expect(d.publicReply).toBeNull()
    expect(d.privateReply).toBeNull()
  })

  it('other → no auto reply, route to human', () => {
    const d = decideByCategory(
      { category: 'other', confidence: 0.4, purchase_intent: false, praise_reply: null },
      CTX,
    )
    expect(d.needsHuman).toBe(true)
    expect(d.publicReply).toBeNull()
  })
})
