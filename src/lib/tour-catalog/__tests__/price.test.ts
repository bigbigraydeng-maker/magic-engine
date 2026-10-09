import { describe, it, expect } from 'vitest'
import { validatePriceText } from '../price'

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
