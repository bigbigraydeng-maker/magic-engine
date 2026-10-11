/**
 * 事实层纯函数的测试 —— 不连数据库、不调模型。
 *
 * 覆盖三块最容易出错的地方：罐头话术的识别边界（同一段话刷多遍不算）、
 * 对话渲染的截断与代理项清理、以及引文核对/降级规则。
 *
 * 这些规则离线探针和线上任务共用，所以测试就是两边的共同契约。
 */

import { describe, expect, it } from 'vitest'
import {
  buildTranscript,
  cannedKey,
  findCanned,
  isCanned,
  lastSpeaker,
  type FactsMsg,
} from '../canned'
import { declineStands, grounded, sanitizeFacts } from '../checks'
import type { Facts } from '../schema'

function msg(
  direction: 'inbound' | 'outbound',
  body: string | null,
  sent_at = '2026-10-01T00:00:00Z',
): FactsMsg {
  return { direction, body, sent_at }
}

function facts(over: Partial<Facts> = {}): Facts {
  return {
    spam_kind: 'none',
    is_spam_or_unrelated: false,
    customer_gave_specifics: false,
    we_gave_price: false,
    next_step_arranged: false,
    ordered_or_paid: false,
    we_declined: false,
    customer_said_not_now: false,
    decline_quote: '',
    customer_quote: '',
    our_quote: '',
    progression: '',
    reason: '',
    ...over,
  }
}

describe('cannedKey', () => {
  it('collapses whitespace and lowercases', () => {
    expect(cannedKey('  Hello   WORLD \n')).toBe('hello world')
  })

  it('returns empty string for null', () => {
    expect(cannedKey(null)).toBe('')
  })

  it('keeps only the first 60 characters', () => {
    expect(cannedKey('a'.repeat(100))).toHaveLength(60)
  })
})

describe('findCanned', () => {
  it('marks a phrase seen in three different conversations', () => {
    const canned = findCanned([['Thanks for reaching out!'], ['Thanks for reaching out!'], ['Thanks for reaching out!']])
    expect(canned.has(cannedKey('Thanks for reaching out!'))).toBe(true)
  })

  it('does not mark a phrase repeated five times in ONE conversation', () => {
    const repeated = Array.from({ length: 5 }, () => 'Thanks for reaching out!')
    const canned = findCanned([repeated, [], []])
    expect(canned.has(cannedKey('Thanks for reaching out!'))).toBe(false)
  })

  it('ignores keys shorter than 12 characters', () => {
    const canned = findCanned([['ok thanks'], ['ok thanks'], ['ok thanks']])
    expect(canned.size).toBe(0)
  })
})

describe('isCanned', () => {
  it('is true only for outbound messages', () => {
    const canned = new Set([cannedKey('Thanks for reaching out!')])
    expect(isCanned(msg('outbound', 'Thanks for reaching out!'), canned)).toBe(true)
    expect(isCanned(msg('inbound', 'Thanks for reaching out!'), canned)).toBe(false)
  })
})

describe('lastSpeaker', () => {
  it('skips canned outbound and finds the real us', () => {
    const canned = new Set([cannedKey('Thanks for reaching out!')])
    const msgs = [msg('inbound', 'hi'), msg('outbound', 'Thanks for reaching out!'), msg('outbound', 'Sure, what size?')]
    expect(lastSpeaker(msgs, canned)).toBe('us')
  })

  it('defaults to customer when nothing qualifies', () => {
    const canned = new Set([cannedKey('Thanks for reaching out!')])
    const msgs = [msg('outbound', 'Thanks for reaching out!')]
    expect(lastSpeaker(msgs, canned)).toBe('customer')
  })
})

describe('buildTranscript', () => {
  it('labels customer, us and auto-reply lines', () => {
    const canned = new Set([cannedKey('Thanks for reaching out!')])
    const msgs = [msg('inbound', 'hello'), msg('outbound', 'Thanks for reaching out!'), msg('outbound', 'What size?')]
    expect(buildTranscript(msgs, canned)).toBe('CUSTOMER: hello\nUS (auto-reply): Thanks for reaching out!\nUS: What size?')
  })

  it('strips lone surrogates', () => {
    const out = buildTranscript([msg('inbound', 'hi \uD83D there')], new Set())
    expect(out).toBe('CUSTOMER: hi  there')
  })

  it('keeps only the last 12000 characters', () => {
    // 单条消息本来就先被砍到 600 字，所以要用很多条才会撞到整段上限。
    const msgs = Array.from({ length: 40 }, (_, i) => msg('inbound', `${String(i).padStart(2, '0')}${'x'.repeat(500)}`))
    const out = buildTranscript(msgs, new Set())
    expect(out).toHaveLength(12_000)
    expect(out.endsWith(`39${'x'.repeat(500)}`)).toBe(true) // 留的是最后那些
  })
})

describe('grounded', () => {
  it('is false for an empty quote', () => {
    expect(grounded('', 'anything')).toBe(false)
  })

  it('accepts a short quote present verbatim', () => {
    expect(grounded('ok', 'CUSTOMER: ok')).toBe(true)
  })

  it('accepts a long quote present verbatim', () => {
    const t = 'CUSTOMER: I need to move 20 pallets to Auckland next week.'
    expect(grounded('I need to move 20 pallets to Auckland next week.', t)).toBe(true)
  })

  it('rejects a long quote that is not present', () => {
    const t = 'CUSTOMER: I need to move 20 pallets to Auckland next week.'
    expect(grounded('I want to ship 50 containers to Wellington.', t)).toBe(false)
  })
})

describe('declineStands', () => {
  const decline = 'Sorry, we cannot move hazardous goods.'
  const transcript = `US: ${decline}`

  it('is true when nothing follows the decline', () => {
    const msgs = [msg('outbound', decline)]
    expect(declineStands(decline, transcript, msgs, new Set())).toBe(true)
  })

  it('is false when a later non-canned outbound message keeps working', () => {
    const later = 'Actually let me check with our dangerous goods team and get back to you tomorrow.'
    const msgs = [msg('outbound', decline), msg('outbound', later)]
    expect(declineStands(decline, transcript, msgs, new Set())).toBe(false)
  })

  it('is true when only a later canned outbound message follows', () => {
    const cannedText = 'Thanks for reaching out! Our team will reply within one business day.'
    const canned = new Set([cannedKey(cannedText)])
    const msgs = [msg('outbound', decline), msg('outbound', cannedText)]
    expect(declineStands(decline, transcript, msgs, canned)).toBe(true)
  })

  it('is false when the quote is not grounded', () => {
    const msgs = [msg('outbound', decline)]
    expect(declineStands('We never said that at all.', transcript, msgs, new Set())).toBe(false)
  })
})

describe('sanitizeFacts · 垃圾以种类为准', () => {
  it('模型笼统说垃圾但点不出种类 → 不算垃圾（措辞生硬的真客人不被挡）', () => {
    const out = sanitizeFacts(facts({ is_spam_or_unrelated: true, spam_kind: 'none' }), '', [], new Set())
    expect(out.is_spam_or_unrelated).toBe(false)
  })
  it('点得出名的种类 → 算垃圾，哪怕布尔漏填', () => {
    for (const k of ['platform_broadcast', 'pitch_to_us', 'job_seeker', 'wrong_recipient', 'unrelated'] as const) {
      const out = sanitizeFacts(facts({ is_spam_or_unrelated: false, spam_kind: k }), '', [], new Set())
      expect(out.is_spam_or_unrelated).toBe(true)
    }
  })
})

describe('sanitizeFacts', () => {
  const decline = 'Sorry, we cannot move hazardous goods.'
  const transcript = `CUSTOMER: Can you move 20 pallets of paint?\nUS: ${decline}`

  it('(a) forces we_declined false when the decline does not stand', () => {
    const later = 'Actually let me check with our dangerous goods team and get back to you tomorrow.'
    const msgs = [msg('outbound', decline), msg('outbound', later)]
    const out = sanitizeFacts(facts({ we_declined: true, decline_quote: decline }), transcript, msgs, new Set())
    expect(out.we_declined).toBe(false)
  })

  it('(a) keeps we_declined true when the decline stands', () => {
    const msgs = [msg('outbound', decline)]
    const out = sanitizeFacts(facts({ we_declined: true, decline_quote: decline }), transcript, msgs, new Set())
    expect(out.we_declined).toBe(true)
  })

  it('(b) forces customer_gave_specifics false when the customer quote is ungrounded', () => {
    const out = sanitizeFacts(
      facts({ customer_gave_specifics: true, customer_quote: 'I want to ship 50 containers to Wellington.' }),
      transcript,
      [],
      new Set(),
    )
    expect(out.customer_gave_specifics).toBe(false)
  })

  it('(b) keeps customer_gave_specifics true when the customer quote is grounded', () => {
    const out = sanitizeFacts(
      facts({ customer_gave_specifics: true, customer_quote: 'Can you move 20 pallets of paint?' }),
      transcript,
      [],
      new Set(),
    )
    expect(out.customer_gave_specifics).toBe(true)
  })

  it('(c) forces we_gave_price false when a non-empty our_quote is ungrounded', () => {
    const out = sanitizeFacts(
      facts({ we_gave_price: true, our_quote: 'It will be 500 dollars per pallet.' }),
      transcript,
      [],
      new Set(),
    )
    expect(out.we_gave_price).toBe(false)
  })

  it('(c) keeps we_gave_price true when our_quote is empty', () => {
    const out = sanitizeFacts(facts({ we_gave_price: true, our_quote: '' }), transcript, [], new Set())
    expect(out.we_gave_price).toBe(true)
  })

  it('never mutates its input', () => {
    const input = facts({ we_declined: true, decline_quote: decline })
    const snapshot = { ...input }
    sanitizeFacts(input, transcript, [msg('outbound', decline)], new Set())
    expect(input).toEqual(snapshot)
  })
})
