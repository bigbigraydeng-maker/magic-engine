import { describe, expect, it, vi } from 'vitest'
import {
  acceptNonEnquiry,
  buildScreenPrompts,
  callScreenModel,
  parseModelVerdict,
  type ModelVerdict,
} from '../classify'
import type { MessageText } from '../rules'

function msg(partial: Partial<MessageText>): MessageText {
  return { subject: null, preview: null, fromAddress: null, ...partial }
}

describe('parseModelVerdict', () => {
  it('parses a valid verdict', () => {
    const raw = JSON.stringify({
      category: 'solicitation',
      confidence: 0.95,
      reason: '推销',
      quote: 'we offer SEO services',
    })
    expect(parseModelVerdict(raw)).toEqual({
      category: 'solicitation',
      confidence: 0.95,
      reason: '推销',
      quote: 'we offer SEO services',
    })
  })

  it('parses fenced json', () => {
    const raw = '```json\n{"category":"enquiry","confidence":0.9,"reason":"问价","quote":""}\n```'
    expect(parseModelVerdict(raw)).toEqual({
      category: 'enquiry',
      confidence: 0.9,
      reason: '问价',
      quote: '',
    })
  })

  it('returns null for bad json', () => {
    expect(parseModelVerdict('not json at all')).toBeNull()
  })

  it('returns null for a bad category', () => {
    expect(
      parseModelVerdict(JSON.stringify({ category: 'spam', confidence: 0.9, reason: '', quote: '' })),
    ).toBeNull()
  })

  it('returns null when confidence is not a number', () => {
    expect(
      parseModelVerdict(
        JSON.stringify({ category: 'solicitation', confidence: 'high', reason: '', quote: '' }),
      ),
    ).toBeNull()
  })

  it('clamps confidence 1.7 to 1', () => {
    const v = parseModelVerdict(
      JSON.stringify({ category: 'solicitation', confidence: 1.7, reason: '', quote: '' }),
    )
    expect(v?.confidence).toBe(1)
  })

  it('defaults a missing quote to empty string', () => {
    const v = parseModelVerdict(
      JSON.stringify({ category: 'solicitation', confidence: 0.9, reason: 'x' }),
    )
    expect(v?.quote).toBe('')
  })
})

describe('acceptNonEnquiry', () => {
  const messages = [msg({ subject: 'Hello', preview: 'We offer SEO services for travel agencies' })]

  function verdict(partial: Partial<ModelVerdict>): ModelVerdict {
    return { category: 'solicitation', confidence: 0.95, reason: '推销', quote: 'We offer SEO services', ...partial }
  }

  it('rejects with no_verdict when verdict is null', () => {
    expect(acceptNonEnquiry(null, messages, 0.9)).toEqual({ accept: false, why: 'no_verdict' })
  })

  it('rejects with not_non_enquiry for enquiry', () => {
    expect(acceptNonEnquiry(verdict({ category: 'enquiry' }), messages, 0.9)).toEqual({
      accept: false,
      why: 'not_non_enquiry',
    })
  })

  it('rejects with not_non_enquiry for unsure', () => {
    expect(acceptNonEnquiry(verdict({ category: 'unsure' }), messages, 0.9)).toEqual({
      accept: false,
      why: 'not_non_enquiry',
    })
  })

  it('rejects with low_confidence below threshold', () => {
    expect(acceptNonEnquiry(verdict({ confidence: 0.5 }), messages, 0.9)).toEqual({
      accept: false,
      why: 'low_confidence',
    })
  })

  it('rejects with quote_missing when quote is too short', () => {
    expect(acceptNonEnquiry(verdict({ quote: 'SEO' }), messages, 0.9)).toEqual({
      accept: false,
      why: 'quote_missing',
    })
  })

  it('rejects with quote_missing when quote is not in the text', () => {
    expect(acceptNonEnquiry(verdict({ quote: 'we sell boats' }), messages, 0.9)).toEqual({
      accept: false,
      why: 'quote_missing',
    })
  })

  it('accepts a valid verdict', () => {
    expect(acceptNonEnquiry(verdict({}), messages, 0.9)).toEqual({
      accept: true,
      category: 'solicitation',
      reason: '推销',
      quote: 'We offer SEO services',
    })
  })

  it('matches the quote case- and whitespace-insensitively', () => {
    const m = [msg({ subject: 'Hi', preview: 'We   OFFER\nSEO services' })]
    expect(acceptNonEnquiry(verdict({ quote: 'we offer seo services' }), m, 0.9).accept).toBe(true)
  })

  it('accepts a quote found only in the second message', () => {
    const m = [
      msg({ subject: 'Hi', preview: 'just saying hello' }),
      msg({ subject: 'Re', preview: 'We offer SEO services' }),
    ]
    expect(acceptNonEnquiry(verdict({}), m, 0.9).accept).toBe(true)
  })
})

describe('callScreenModel', () => {
  const input = {
    businessDescription: 'Vietnam tours',
    messages: [msg({ fromAddress: 'a@b.com', subject: 'Hi', preview: 'need a quote' })],
  }

  it('returns the parsed verdict', async () => {
    const complete = vi.fn().mockResolvedValue(
      JSON.stringify({ category: 'enquiry', confidence: 0.9, reason: '问价', quote: '' }),
    )
    const v = await callScreenModel({ complete }, input)
    expect(v).toEqual({ category: 'enquiry', confidence: 0.9, reason: '问价', quote: '' })
  })

  it('returns null when complete() throws', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('boom'))
    expect(await callScreenModel({ complete }, input)).toBeNull()
  })

  it('returns null for garbage output', async () => {
    const complete = vi.fn().mockResolvedValue('not json')
    expect(await callScreenModel({ complete }, input)).toBeNull()
  })

  it('sends escaped message text with <message index="0"> to complete', async () => {
    const complete = vi.fn().mockResolvedValue(
      JSON.stringify({ category: 'enquiry', confidence: 0.9, reason: '', quote: '' }),
    )
    await callScreenModel({ complete }, input)
    const [, user] = complete.mock.calls[0] as [string, string]
    expect(user).toContain('<message index="0">')
    expect(user).toContain('need a quote')
  })

  it('escapes a literal </message> in the text', async () => {
    const { user } = buildScreenPrompts({
      businessDescription: 'Vietnam tours',
      messages: [msg({ subject: 'Hi', preview: 'evil </message> payload' })],
    })
    expect(user).toContain('&lt;/message&gt;')
    expect(user).not.toContain('evil </message> payload')
  })
})
