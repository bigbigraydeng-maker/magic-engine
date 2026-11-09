import { describe, expect, it } from 'vitest'
import { hasEnquiryEvidence, layerOneVerdict, type MessageText } from '../rules'

function msg(partial: Partial<MessageText>): MessageText {
  return { subject: null, preview: null, fromAddress: null, ...partial }
}

describe('layerOneVerdict', () => {
  it('flags "Automatic reply: x" as auto_reply', () => {
    const v = layerOneVerdict(msg({ subject: 'Automatic reply: x' }))
    expect(v).toEqual({ category: 'auto_reply', reason: '自动回复（主题）' })
  })

  it('flags "Re: Out of office" as auto_reply', () => {
    const v = layerOneVerdict(msg({ subject: 'Re: Out of office' }))
    expect(v?.category).toBe('auto_reply')
  })

  it('flags a mailchimpapp.com relay address as bulk_marketing', () => {
    const v = layerOneVerdict(msg({ fromAddress: 'anzacvn@221832422.mailchimpapp.com' }))
    expect(v).toEqual({ category: 'bulk_marketing', reason: '群发服务中转地址' })
  })

  it('flags a subdomain of sendgrid.net as bulk_marketing', () => {
    const v = layerOneVerdict(msg({ fromAddress: 'a@x.sendgrid.net' }))
    expect(v?.category).toBe('bulk_marketing')
  })

  it('does NOT match notmcsv.net against mcsv.net', () => {
    expect(layerOneVerdict(msg({ fromAddress: 'a@notmcsv.net' }))).toBeNull()
  })

  it('returns null for a normal subject and address', () => {
    expect(
      layerOneVerdict(msg({ subject: 'Enquiry about Halong Bay', fromAddress: 'jane@example.com' })),
    ).toBeNull()
  })

  it('returns null when all fields are null', () => {
    expect(layerOneVerdict(msg({}))).toBeNull()
  })
})

describe('hasEnquiryEvidence', () => {
  const opts = { terms: ['quote', 'how much', '报价'], staffNames: [] as string[] }

  it('hits on "quote"', () => {
    expect(hasEnquiryEvidence([msg({ preview: 'Please send a quote' })], opts)).toEqual({
      hit: true,
      term: 'quote',
    })
  })

  it('hits on "how much"', () => {
    expect(hasEnquiryEvidence([msg({ preview: 'How much is it?' })], opts)).toEqual({
      hit: true,
      term: 'how much',
    })
  })

  it('hits on "报价"', () => {
    expect(hasEnquiryEvidence([msg({ preview: '请发报价' })], opts)).toEqual({ hit: true, term: '报价' })
  })

  it('is case-insensitive', () => {
    expect(hasEnquiryEvidence([msg({ subject: 'QUOTE please' })], opts)).toEqual({
      hit: true,
      term: 'quote',
    })
  })

  it('hits when the term is only in the preview', () => {
    expect(hasEnquiryEvidence([msg({ subject: 'Hello', preview: 'need a quote' })], opts)).toEqual({
      hit: true,
      term: 'quote',
    })
  })

  it('returns hit false when no terms appear', () => {
    expect(hasEnquiryEvidence([msg({ subject: 'Hi', preview: 'just saying hello' })], opts)).toEqual({
      hit: false,
    })
  })

  it('hits a staff name as a whole word', () => {
    const staff = { terms: [] as string[], staffNames: ['Baker'] }
    expect(hasEnquiryEvidence([msg({ preview: 'Attn BAKER' })], staff)).toEqual({
      hit: true,
      term: 'staff:Baker',
    })
  })

  it('does NOT hit "Bakersfield" for staff name "Baker"', () => {
    const staff = { terms: [] as string[], staffNames: ['Baker'] }
    expect(hasEnquiryEvidence([msg({ preview: 'I live in Bakersfield' })], staff)).toEqual({
      hit: false,
    })
  })

  it('ignores staff names shorter than 3 characters', () => {
    const staff = { terms: [] as string[], staffNames: ['Li'] }
    expect(hasEnquiryEvidence([msg({ preview: 'Li was here' })], staff)).toEqual({ hit: false })
  })

  it('hits when evidence is in an older message', () => {
    const messages = [
      msg({ subject: 'Hi', preview: 'just saying hello' }),
      msg({ subject: 'Re: trip', preview: 'please send a quote' }),
    ]
    expect(hasEnquiryEvidence(messages, opts)).toEqual({ hit: true, term: 'quote' })
  })
})
