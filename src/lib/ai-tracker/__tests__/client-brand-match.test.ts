import { describe, it, expect } from 'vitest'
import {
  buildClientIdentifiers,
  isClientBrand,
  resolveClientBrandRank,
} from '../client-brand-match'

describe('buildClientIdentifiers', () => {
  it('includes brand, aliases, domain host and domain root', () => {
    expect(
      buildClientIdentifiers({
        brandName: 'CTS Tours',
        domain: 'https://www.ctstours.co.nz/',
        aliases: ['China Travel Service'],
      })
    ).toEqual(['cts tours', 'china travel service', 'ctstours co nz', 'ctstours'])
  })

  it('returns nothing for an empty brand with no domain', () => {
    expect(buildClientIdentifiers({ brandName: '' })).toEqual([])
  })
})

describe('isClientBrand', () => {
  const roman = buildClientIdentifiers({
    brandName: 'Roman Hu — Ray White Mission Bay',
    domain: 'romanhu.com',
  })
  const cts = buildClientIdentifiers({ brandName: 'CTS Tours NZ', domain: 'ctstours.co.nz' })
  const dixon = buildClientIdentifiers({ brandName: 'Dixon Homes' })

  it('rejects a brand that only appears inside a composite client name', () => {
    expect(isClientBrand('Ray White', roman)).toBe(false)
    expect(isClientBrand('Ray White Mission Bay', roman)).toBe(false)
  })

  it('rejects generic single tokens', () => {
    expect(isClientBrand('Homes', dixon)).toBe(false)
    expect(isClientBrand('Roman', roman)).toBe(false)
  })

  it('accepts real variants', () => {
    expect(isClientBrand('Roman Hu', roman)).toBe(true)
    expect(isClientBrand('Roman Hu (Ray White Mission Bay)', roman)).toBe(true)
    expect(isClientBrand('CTS Tours', cts)).toBe(true)
    expect(isClientBrand('ctstours.co.nz', cts)).toBe(true)
    expect(isClientBrand('Dixon Homes Ltd', dixon)).toBe(true)
  })

  it('does not match a domain root embedded in a longer word', () => {
    expect(isClientBrand('Romanhunter Realty', roman)).toBe(false)
  })
})

describe('resolveClientBrandRank', () => {
  it('matches a CJK alias inside unspaced Chinese text', () => {
    const out = resolveClientBrandRank(
      [{ brand: '中国旅行社', rank: 1, snippet: '推荐中国旅行社' }],
      '如果你要去北京，我推荐中国旅行社的行程。',
      { brandName: 'CTS Tours', aliases: ['中国旅行社'] }
    )
    expect(out.client_brand_rank).toBe(1)
  })

  it('a leading-words variant written in the text counts as evidence', () => {
    const out = resolveClientBrandRank(
      [
        { brand: 'JR Academy', rank: 1, snippet: 'x' },
        { brand: 'Magic Lab', rank: 2, snippet: 'x' },
      ],
      'Compare JR Academy and Magic Lab for small-business owners learning AI.',
      { brandName: 'Magic Lab Class' }
    )
    expect(out.client_brand_rank).toBe(2)
  })

  it('drops multiple hallucinated client entries and closes rank gaps', () => {
    const out = resolveClientBrandRank(
      [
        { brand: 'Dixon Homes', rank: 1, snippet: 'x' },
        { brand: 'GJ Gardner', rank: 2, snippet: 'x' },
        { brand: 'Dixon Homes Ltd', rank: 3, snippet: 'x' },
        { brand: 'Signature Homes', rank: 4, snippet: 'x' },
      ],
      'Consider GJ Gardner and Signature Homes for a new build in Auckland.',
      { brandName: 'Dixon Homes' }
    )
    expect(out.client_brand_rank).toBeNull()
    expect(out.brands.map(b => [b.brand, b.rank])).toEqual([
      ['GJ Gardner', 1],
      ['Signature Homes', 2],
    ])
  })
})
