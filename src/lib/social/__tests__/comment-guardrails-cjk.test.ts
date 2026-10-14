/**
 * The public comment auto-reply channel (live for CTS) must not let a Chinese price,
 * date or promise through. Before this change the praise gate only looked for ASCII digits
 * and English claim words, so '保证出签' or '三千八就能走' passed straight to the page.
 * Reviewer-written acceptance tests.
 */

import { describe, it, expect } from 'vitest'
import {
  detectUnverifiableClaims,
  isPraiseReplySafe,
  isSafeToAutoSend,
  safePraiseReply,
  type ReplyContext,
} from '../comment-guardrails'
import { decideByCategory, PRAISE_CONFIDENCE_THRESHOLD } from '../comment-classifier'

const CTX: ReplyContext = { clientName: 'CTS Tours', siteUrl: 'https://ctstours.co.nz', authorFirstName: 'Annette' }

describe('detectUnverifiableClaims — Chinese wording', () => {
  it.each([
    ['每人三千八百纽币', 'price'],
    ['三千八就能走', 'price'],
    ['有效期至2026年12月31日', 'date'],
    ['下周三出发', 'date'],
    ['保证出签', 'promise'],
    ['免签入境', 'visa'],
    ['名额有限', 'availability'],
    ['全网最低价', 'discount'],
    ['十五日游', 'duration'],
  ])('%s -> %s', (text, flag) => {
    expect(detectUnverifiableClaims(text)).toContain(flag)
    expect(isSafeToAutoSend(text)).toBe(false)
  })

  it('English results are unchanged', () => {
    expect(detectUnverifiableClaims('Our tour is only $1,299!')).toContain('price')
  })

  it('an ordinary Chinese thank-you has no flags', () => {
    expect(detectUnverifiableClaims('感谢您的好评，欢迎再来！')).toEqual([])
    expect(isSafeToAutoSend('感谢您的好评，欢迎再来！')).toBe(true)
  })
})

describe('isPraiseReplySafe — Chinese claim shapes without ASCII digits', () => {
  it.each(['谢谢支持！保证出签', '三千八带您去南岛', '名额有限欢迎报名', '免费升级给您'])('rejects: %s', (text) => {
    expect(isPraiseReplySafe(text)).toBe(false)
  })
  it('still accepts a clean Chinese thank-you', () => {
    expect(isPraiseReplySafe('谢谢您的鼓励，我们会继续努力。')).toBe(true)
  })
})

describe('decideByCategory — praise with a claim-bearing LLM draft falls back to the fixed template', () => {
  const conf = PRAISE_CONFIDENCE_THRESHOLD + 0.05
  it.each(['谢谢您！保证出签，欢迎报名', '感谢好评，三千八就能走', '谢谢！下周三出发，名额有限'])('%s', (draft) => {
    const d = decideByCategory(
      { category: 'praise', confidence: conf, purchase_intent: false, praise_reply: draft },
      CTX,
      0,
    )
    expect(d.replySource).toBe('fallback')
    expect(d.publicReply).toBe(safePraiseReply(CTX, 0))
    expect(d.publicReply).not.toContain('保证')
    expect(d.guardrailFlags.length).toBeGreaterThan(0)
  })

  it('a clean Chinese thank-you draft is still used', () => {
    const d = decideByCategory(
      { category: 'praise', confidence: conf, purchase_intent: false, praise_reply: '谢谢您的鼓励，我们会继续努力。' },
      CTX,
      0,
    )
    expect(d.replySource).toBe('llm')
    expect(d.publicReply).toBe('谢谢您的鼓励，我们会继续努力。')
  })
})
