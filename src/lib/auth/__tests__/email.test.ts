import { describe, it, expect } from 'vitest'
import { normalizeEmail, canonicalEmail } from '../email'

describe('normalizeEmail — Gmail', () => {
  it('strips +alias and dots, lowercases', () => {
    expect(canonicalEmail('A.B+promo@Gmail.com')).toBe('ab@gmail.com')
  })

  it('treats googlemail.com as gmail.com', () => {
    expect(canonicalEmail('user@googlemail.com')).toBe('user@gmail.com')
  })

  it('collapses many gmail aliases to the same canonical key', () => {
    const variants = [
      'foo@gmail.com',
      'f.o.o@gmail.com',
      'foo+1@gmail.com',
      'foo+anything@gmail.com',
      'F.O.O+anything@Gmail.com',
      'foo@googlemail.com',
    ]
    const canons = new Set(variants.map(canonicalEmail))
    expect([...canons]).toEqual(['foo@gmail.com'])
  })

  it('reports transformed=true when canonical differs from lower', () => {
    const r = normalizeEmail('a.b+x@Gmail.com')
    expect(r?.transformed).toBe(true)
    expect(r?.lower).toBe('a.b+x@gmail.com')
    expect(r?.normalized).toBe('ab@gmail.com')
  })

  it('reports transformed=false for plain gmail addresses', () => {
    const r = normalizeEmail('plain@gmail.com')
    expect(r?.transformed).toBe(false)
  })
})

describe('normalizeEmail — non-Gmail', () => {
  it('lowercases but does NOT strip + or dots for outlook', () => {
    // We deliberately do not collapse non-Gmail addresses — risk of merging
    // distinct humans is worse than letting one person grab two bonuses.
    expect(canonicalEmail('Foo+X@Outlook.com')).toBe('foo+x@outlook.com')
    expect(canonicalEmail('a.b@example.com')).toBe('a.b@example.com')
  })

  it('lowercases the domain too', () => {
    expect(canonicalEmail('user@ProtonMail.COM')).toBe('user@protonmail.com')
  })
})

describe('normalizeEmail — invalid input', () => {
  it('returns null for null/undefined/empty', () => {
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
  })

  it('returns null when @ is missing', () => {
    expect(normalizeEmail('justastring')).toBeNull()
  })

  it('returns null when local or domain is empty', () => {
    expect(normalizeEmail('@gmail.com')).toBeNull()
    expect(normalizeEmail('user@')).toBeNull()
  })

  it('canonicalEmail returns empty string for invalid input', () => {
    expect(canonicalEmail('not an email')).toBe('')
    expect(canonicalEmail(null)).toBe('')
  })
})

describe('normalizeEmail — whitespace', () => {
  it('trims surrounding whitespace', () => {
    expect(canonicalEmail('  Foo@Bar.com  ')).toBe('foo@bar.com')
  })
})
