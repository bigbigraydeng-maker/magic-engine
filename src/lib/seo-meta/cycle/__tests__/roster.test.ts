import { describe, expect, it } from 'vitest'
import { parseProtectedSlugs, normalizeSlug } from '../roster'

describe('normalizeSlug — strip domains, slashes, lowercase', () => {
  it('strips leading and trailing slashes', () => {
    expect(normalizeSlug('/about-us/')).toBe('about-us')
  })

  it('strips domain from a full URL, keeping only the path', () => {
    expect(normalizeSlug('https://ctstours.co.nz/china-tours')).toBe('china-tours')
  })

  it('strips domain with trailing slash', () => {
    expect(normalizeSlug('https://example.com/contact/')).toBe('contact')
  })

  it('lowercases the slug', () => {
    expect(normalizeSlug('About-Us')).toBe('about-us')
  })

  it('handles bare slug with no slashes', () => {
    expect(normalizeSlug('quote')).toBe('quote')
  })

  it('handles deeply nested path', () => {
    expect(normalizeSlug('https://example.com/tours/china/beijing')).toBe('tours/china/beijing')
  })
})

describe('parseProtectedSlugs — validation and normalization', () => {
  it('undefined → empty array, not malformed (no config = protect nothing, OK)', () => {
    const result = parseProtectedSlugs(undefined)
    expect(result).toEqual({ slugs: [], malformed: false })
  })

  it('null → empty array, not malformed', () => {
    const result = parseProtectedSlugs(null)
    expect(result).toEqual({ slugs: [], malformed: false })
  })

  it('a string (not an array) → malformed:true (someone configured protection but it is broken)', () => {
    const result = parseProtectedSlugs('quote')
    expect(result).toEqual({ slugs: [], malformed: true })
  })

  it('an object (not an array) → malformed:true', () => {
    const result = parseProtectedSlugs({ slug: 'quote' })
    expect(result).toEqual({ slugs: [], malformed: true })
  })

  it('a number → malformed:true', () => {
    const result = parseProtectedSlugs(42)
    expect(result).toEqual({ slugs: [], malformed: true })
  })

  it('valid array of slugs → normalized and returned', () => {
    const result = parseProtectedSlugs(['/quote/', 'About-Us', 'https://ctstours.co.nz/china-tours'])
    expect(result.malformed).toBe(false)
    expect(result.slugs).toEqual(['quote', 'about-us', 'china-tours'])
  })

  it('filters out empty strings and non-string items', () => {
    const result = parseProtectedSlugs(['quote', '', 123, null, 'contact'])
    expect(result.malformed).toBe(false)
    expect(result.slugs).toEqual(['quote', 'contact'])
  })

  it('🔴 魏征 mutation M5: a non-array config must NOT silently become [] (protect nothing) — it must signal malformed so the client is skipped', () => {
    const nonArrayInputs = ['quote', 42, { a: 1 }, true, 'https://example.com/quote']
    for (const input of nonArrayInputs) {
      const result = parseProtectedSlugs(input)
      expect(result.malformed, `input ${JSON.stringify(input)} should be malformed`).toBe(true)
      expect(result.slugs).toEqual([])
    }
  })
})
