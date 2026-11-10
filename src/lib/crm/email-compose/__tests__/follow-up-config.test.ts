import { describe, expect, it } from 'vitest'
import { readFollowUpWriterConfig } from '../follow-up-config'

const ok = {
  enabled: true,
  greeting: 'Kia ora {first_name},',
  greeting_no_name: 'Kia ora,',
  signature: 'Warm regards,\nAlex',
  site_link: { label: 'All our tours', url: 'https://www.example.com/tours' },
  price_basis_phrases: ['per person', 'twin share'],
  max_words: 140,
}

describe('readFollowUpWriterConfig', () => {
  it('reads a complete block', () => {
    expect(readFollowUpWriterConfig({ follow_up_writer: ok })).toEqual({
      greeting: 'Kia ora {first_name},',
      greetingNoName: 'Kia ora,',
      signature: 'Warm regards,\nAlex',
      siteLink: { label: 'All our tours', url: 'https://www.example.com/tours' },
      priceBasisPhrases: ['per person', 'twin share'],
      maxWords: 140,
    })
  })

  it('defaults: no-name greeting, no phrases, 150 words, no site link', () => {
    const c = readFollowUpWriterConfig({ follow_up_writer: { enabled: true, greeting: 'Hi {first_name},', signature: 'Alex' } })
    expect(c).toMatchObject({ greetingNoName: 'Hello,', priceBasisPhrases: [], maxWords: 150, siteLink: null })
  })

  it.each([
    ['missing block', {}],
    ['not enabled', { follow_up_writer: { ...ok, enabled: false } }],
    ['greeting without {first_name}', { follow_up_writer: { ...ok, greeting: 'Hello,' } }],
    ['no signature', { follow_up_writer: { ...ok, signature: '  ' } }],
    ['http site link', { follow_up_writer: { ...ok, site_link: { label: 'x', url: 'http://www.example.com' } } }],
    ['too many phrases', { follow_up_writer: { ...ok, price_basis_phrases: ['a', 'b', 'c', 'd', 'e'] } }],
    ['max_words out of range', { follow_up_writer: { ...ok, max_words: 20 } }],
  ])('%s → null (the button only says "not configured")', (_label, leads) => {
    expect(readFollowUpWriterConfig(leads)).toBeNull()
  })
})
