import { describe, expect, it } from 'vitest'
import { hasForbiddenChars } from '../text-rules'
import { validateTourPatch } from '../edit-validation'
import { patchContext } from './content-fixture'

const LINE_SEPARATORS: ReadonlyArray<[string, number]> = [
  ['U+2028 line separator', 0x2028],
  ['U+2029 paragraph separator', 0x2029],
  ['U+0085 next line', 0x85],
]

describe('hasForbiddenChars', () => {
  it.each(LINE_SEPARATORS)('refuses %s in single-line and in multi-line text', (_name, code) => {
    const text = 'before' + String.fromCharCode(code) + 'after'
    expect(hasForbiddenChars(text)).toBe(true)
    expect(hasForbiddenChars(text, true)).toBe(true)
  })

  it('still allows ordinary line breaks and tabs in multi-line text only', () => {
    expect(hasForbiddenChars('a\nb\tc', true)).toBe(false)
    expect(hasForbiddenChars('a\nb')).toBe(true)
    expect(hasForbiddenChars('a\tb')).toBe(true)
  })

  it('still refuses what it refused before', () => {
    for (const code of [0x00, 0x07, 0x7f, 0x200b, 0x200f, 0x202a, 0x202e, 0x2060, 0x2069, 0xfeff]) {
      expect(hasForbiddenChars('a' + String.fromCharCode(code) + 'b', true), code.toString(16)).toBe(true)
    }
    expect(hasForbiddenChars('a<b', true)).toBe(true)
    expect(hasForbiddenChars('a>b', true)).toBe(true)
  })

  it('allows ordinary text in the languages and punctuation the catalog uses', () => {
    const ordinary = 'Xi’an – Terracotta Warriors & Great Wall (2 nights) · NZD $4,999 — café ' + String.fromCharCode(0xa0) + '… 西安'
    expect(hasForbiddenChars(ordinary)).toBe(false)
    expect(hasForbiddenChars(ordinary, true)).toBe(false)
  })
})

describe('line separators are refused on save, in single-line and multi-line fields', () => {
  it.each(LINE_SEPARATORS)('%s', (_name, code) => {
    const text = 'before' + String.fromCharCode(code) + 'after'
    for (const key of ['title', 'shortDescription', 'quickAnswer', 'metaTitle']) {
      const result = validateTourPatch({ [key]: text }, patchContext())
      expect(result.ok, key).toBe(false)
      if (!result.ok) expect(result.errors).toEqual([{ field: key, code: 'invalid_characters' }])
    }
    const day = validateTourPatch({ itinerary: [{ day: 1, title: 'Arrive', description: text }] }, patchContext())
    expect(day.ok).toBe(false)
  })
})
