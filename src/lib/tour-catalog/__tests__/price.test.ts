import { describe, it, expect } from 'vitest'
import { MAX_PRICE_TEXT_LENGTH, priceTextSafetyIssue, validatePriceText } from '../price'

describe('validatePriceText', () => {
  it('accepts a standard "From NZD $X per person" string', () => {
    expect(validatePriceText('From NZD $4,080 per person')).toEqual({
      ok: true,
      kind: 'amount',
    })
  })

  it('accepts a plain "NZD $X per person" string', () => {
    expect(validatePriceText('NZD $2,699 per person')).toEqual({
      ok: true,
      kind: 'amount',
    })
  })

  it('accepts a "From NZD $X" string without a per-person suffix', () => {
    expect(validatePriceText('From NZD $3,480')).toEqual({
      ok: true,
      kind: 'amount',
    })
  })

  it('treats a digit-free TBC string as tbc', () => {
    expect(validatePriceText('From NZD $TBC per person')).toEqual({
      ok: true,
      kind: 'tbc',
    })
  })

  it('rejects text containing two distinct currencies', () => {
    expect(
      validatePriceText('From AUD 5,200 (NZD $4,999 for NZ residents)'),
    ).toEqual({ ok: false, reason: 'multiple_currencies' })
  })

  it('rejects an empty string', () => {
    expect(validatePriceText('')).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects a whitespace-only string', () => {
    expect(validatePriceText('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects text with no price information', () => {
    expect(validatePriceText('Call us')).toEqual({
      ok: false,
      reason: 'unparseable',
    })
  })

  it('rejects TBC text that also contains digits', () => {
    expect(validatePriceText('TBC 2027')).toEqual({
      ok: false,
      reason: 'unparseable',
    })
  })
})

describe('price text hardening (design §6.10.1 item 7)', () => {
  it.each(['From NZD $4,080 per person', 'NZD $2,699 per person', 'From NZD $3,480', 'TBC', 'From NZD $TBC per person', 'NZD $400'])(
    'still accepts the existing value %s',
    (text) => {
      expect(priceTextSafetyIssue(text)).toBeNull()
      expect(validatePriceText(text).ok).toBe(true)
    },
  )

  it('accepts exactly 100 characters and refuses 101 (after trimming)', () => {
    const base = 'From NZD $4,080 per person'
    const exactly = base + ' '.repeat(1) + 'x'.repeat(MAX_PRICE_TEXT_LENGTH - base.length - 1)
    expect(exactly.length).toBe(100)
    expect(priceTextSafetyIssue(exactly)).toBeNull()
    expect(priceTextSafetyIssue(`  ${exactly}  `)).toBeNull()
    expect(priceTextSafetyIssue(exactly + 'x')).toBe('too_long')
    expect(validatePriceText(exactly + 'x')).toEqual({ ok: false, reason: 'too_long' })
  })

  it.each([
    'From NZD $4,080 <b>per person</b>',
    'NZD $1 <script>alert(1)</script>',
    'NZD $4,080 > NZD $3,000',
    'NZD $4,080 see http://evil.example',
    'NZD $4,080 see https://evil.example',
    'NZD $4,080 HTTPS://EVIL.EXAMPLE',
    'NZD $4,080 www.evil.example',
    'NZD $4,080 WWW.evil.example',
  ])('refuses markup or a link: %s', (text) => {
    expect(priceTextSafetyIssue(text)).toBe('forbidden_content')
    expect(validatePriceText(text)).toEqual({ ok: false, reason: 'forbidden_content' })
  })

  it('an empty string is still reported as empty, not as a safety issue', () => {
    expect(validatePriceText('   ')).toEqual({ ok: false, reason: 'empty' })
  })
})

