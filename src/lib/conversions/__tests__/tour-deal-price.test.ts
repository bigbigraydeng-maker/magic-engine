import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { minorToDecimalString, priceDealFromCatalog } from '../tour-deal-price'

describe('priceDealFromCatalog', () => {
  it('uses the tour price times party size, and documents that From-prices are a starting total', () => {
    const priced = priceDealFromCatalog({
      tourPriceText: 'From NZD $4,999 per person',
      partySize: 2,
    })
    expect(priced).toEqual({
      ok: true,
      amount: '9998.00',
      currency: 'NZD',
      basis: 'tour',
      startingPrice: true,
    })
    const source = readFileSync(join(process.cwd(), 'src/lib/conversions/tour-deal-price.ts'), 'utf8')
    expect(source).toMatch(/From/)
    expect(source).toMatch(/starting/i)
  })

  it('prefers a non-blank departure price', () => {
    const priced = priceDealFromCatalog({
      departurePriceText: 'AUD $1,000',
      tourPriceText: 'From NZD $4,999 per person',
      partySize: 3,
    })
    expect(priced).toMatchObject({ ok: true, amount: '3000.00', currency: 'AUD', basis: 'departure' })
  })

  it('a blank departure override falls through to the tour price', () => {
    const priced = priceDealFromCatalog({
      departurePriceText: '  \n ',
      tourPriceText: 'NZD $10.10',
      partySize: 3,
    })
    expect(priced).toMatchObject({ ok: true, amount: '30.30', currency: 'NZD', basis: 'tour' })
  })

  it('missing party size is not treated as 1', () => {
    expect(priceDealFromCatalog({ tourPriceText: 'NZD $100', partySize: null }).ok).toBe(false)
    expect(priceDealFromCatalog({ tourPriceText: 'NZD $100', partySize: null })).toMatchObject({ reason: 'missing_party_size' })
    expect(priceDealFromCatalog({ tourPriceText: 'NZD $100' })).toMatchObject({ reason: 'missing_party_size' })
  })

  it('rejects a non-integer, zero, or oversized party without inventing a total', () => {
    expect(priceDealFromCatalog({ tourPriceText: 'NZD $100', partySize: 1.5 })).toMatchObject({ reason: 'unpriced' })
    expect(priceDealFromCatalog({ tourPriceText: 'NZD $100', partySize: 0 })).toMatchObject({ reason: 'unpriced' })
    expect(priceDealFromCatalog({ tourPriceText: 'NZD $100', partySize: 61 })).toMatchObject({ reason: 'unpriced' })
  })

  it('refuses an unreadable price and an unsupported currency', () => {
    expect(priceDealFromCatalog({ tourPriceText: 'ask us', partySize: 2 })).toMatchObject({ reason: 'unpriced' })
    expect(priceDealFromCatalog({ departurePriceText: 'TBA', tourPriceText: 'NZD $10', partySize: 2 })).toMatchObject({ reason: 'unpriced' })
    expect(priceDealFromCatalog({ tourPriceText: 'JPY 1000', partySize: 2 })).toMatchObject({ reason: 'unsupported_currency' })
  })

  it('builds the decimal from minor units', () => {
    expect(minorToDecimalString(3030, 'NZD')).toBe('30.30')
  })
})
