import { describe, expect, it } from 'vitest'
import { parsePhoneList, toPhoneCountry } from '../parse-phone-list'
import { readOwnPhoneNumbers } from '../own-phone-numbers'

// Obvious placeholder numbers only.
describe('parsePhoneList', () => {
  it('normalises spaced / dashed international numbers to E.164', () => {
    const r = parsePhoneList('+64 21 000 0000\n+61-400-000-000')
    expect(r.phones).toEqual(['+64210000000', '+61400000000'])
    expect(r.rejected).toEqual([])
  })

  it('fills the default country for local 0-prefixed numbers', () => {
    expect(parsePhoneList('021 000 0000', 'NZ').phones).toEqual(['+64210000000'])
    expect(parsePhoneList('0400 000 000', 'AU').phones).toEqual(['+61400000000'])
  })

  it('accepts commas and arrays, and dedupes', () => {
    expect(parsePhoneList('+64 21 000 0000, 021 000 0000').phones).toEqual(['+64210000000'])
    expect(parsePhoneList(['+64 21 000 0000', '+64210000000']).phones).toEqual(['+64210000000'])
  })

  it('rejects names, too-short and unrecognisable entries instead of dropping them', () => {
    const r = parsePhoneList('+64 21 000 0000\nJason Wong\n12345\nsales 021 000 0000')
    expect(r.phones).toEqual(['+64210000000'])
    expect(r.rejected).toEqual(['Jason Wong', '12345', 'sales 021 000 0000'])
  })

  it('falls back to NZ unless the client default is AU', () => {
    expect(toPhoneCountry('AU')).toBe('AU')
    expect(toPhoneCountry(' au ')).toBe('AU')
    expect(toPhoneCountry(null)).toBe('NZ')
    expect(toPhoneCountry('xx')).toBe('NZ')
  })
})

describe('readOwnPhoneNumbers', () => {
  it('returns only valid, deduped E.164 strings', () => {
    expect(
      readOwnPhoneNumbers({ ownPhoneNumbers: ['+64210000000', '+64210000000', 'abc', 5, '021'] }),
    ).toEqual(['+64210000000'])
  })
  it('returns [] for missing / malformed config', () => {
    expect(readOwnPhoneNumbers(null)).toEqual([])
    expect(readOwnPhoneNumbers({})).toEqual([])
    expect(readOwnPhoneNumbers({ ownPhoneNumbers: 'x' })).toEqual([])
  })
})
