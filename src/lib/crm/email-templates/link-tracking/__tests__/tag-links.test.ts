import { describe, expect, it } from 'vitest'
import { stripToken, tagBody } from '../tag-links'

const HOSTS = ['www.example.com', 'example.com']

function tokens(...list: string[]): () => string {
  const queue = [...list]
  return () => {
    const next = queue.shift()
    if (next === undefined) throw new Error('ran out of tokens')
    return next
  }
}

describe('tagBody', () => {
  it('tags a tracked link and leaves the rest of the text alone', () => {
    const r = tagBody('See https://www.example.com/b.pdf now.', HOSTS, tokens('AAAAAAAAAAAA'))
    expect(r).toEqual({ ok: true, body: 'See https://www.example.com/b.pdf?me=AAAAAAAAAAAA now.', links: [{ token: 'AAAAAAAAAAAA', url: 'https://www.example.com/b.pdf' }] })
  })

  it('keeps sentence punctuation outside the link', () => {
    for (const end of ['.', ',', ')', '!', '?']) {
      const r = tagBody(`(see https://www.example.com/b.pdf${end}`, HOSTS, tokens('AAAAAAAAAAAA'))
      expect(r.body).toBe(`(see https://www.example.com/b.pdf?me=AAAAAAAAAAAA${end}`)
    }
  })

  it('puts the token after an existing query and before a fragment', () => {
    const r = tagBody('https://www.example.com/tours/a/b/c?date=2027-03-11#days', HOSTS, tokens('AAAAAAAAAAAA'))
    expect(r.body).toBe('https://www.example.com/tours/a/b/c?date=2027-03-11&me=AAAAAAAAAAAA#days')
  })

  it('does not touch other hosts, mail addresses or phone numbers', () => {
    const text = 'https://other.com/x info@example.com 0800 287 888 mailto:info@example.com'
    expect(tagBody(text, HOSTS, tokens())).toEqual({ ok: true, body: text, links: [] })
  })

  it('treats host case and a bare www. link as tracked', () => {
    const r = tagBody('A https://WWW.Example.com/x and www.example.com/y', HOSTS, tokens('AAAAAAAAAAAA', 'BBBBBBBBBBBB'))
    expect(r.body).toBe('A https://WWW.Example.com/x?me=AAAAAAAAAAAA and www.example.com/y?me=BBBBBBBBBBBB')
  })

  it('gives the same link one token however often it appears', () => {
    const r = tagBody('https://example.com/a then https://example.com/a', HOSTS, tokens('AAAAAAAAAAAA'))
    expect(r.ok && r.links).toHaveLength(1)
    expect(r.body).toBe('https://example.com/a?me=AAAAAAAAAAAA then https://example.com/a?me=AAAAAAAAAAAA')
  })

  it('drops an old token copied from an earlier mail before adding the new one', () => {
    const r = tagBody('https://example.com/a?me=OLDOLDOLDOLD&date=2027-03-11', HOSTS, tokens('NEWNEWNEWNEW'))
    expect(r.body).toBe('https://example.com/a?date=2027-03-11&me=NEWNEWNEWNEW')
    expect(r.ok && r.links[0].url).toBe('https://example.com/a?date=2027-03-11')
  })

  it('returns the body untouched and says so when the result would not match the original links', () => {
    // A browser reads "\" as "/", so the gates see https://example.com/a/b here; a token inserted before the backslash
    // would change what the link opens. The re-check must catch it and keep the original text.
    const body = 'See https://example.com/a\\b today'
    expect(tagBody(body, HOSTS, tokens('AAAAAAAAAAAA'))).toEqual({ ok: false, body, reason: 'mismatch' })
  })

  it('refuses a token that is not 12 letters or digits', () => {
    expect(() => tagBody('https://example.com/a', HOSTS, () => 'bad token!')).toThrow()
  })

  it('stripToken keeps everything but me=', () => {
    expect(stripToken('https://x/a?me=1&b=2#f')).toBe('https://x/a?b=2#f')
    expect(stripToken('https://x/a?ME=1')).toBe('https://x/a')
    expect(stripToken('https://x/a')).toBe('https://x/a')
  })
})
