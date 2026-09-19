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

  it('adds the leading segment of a "Person — Office" composite name', () => {
    expect(buildClientIdentifiers({ brandName: 'Roman Hu — Ray White Mission Bay' })).toEqual([
      'roman hu ray white mission bay',
      'roman hu',
    ])
  })

  it('uses the registrable label, not a subdomain', () => {
    expect(buildClientIdentifiers({ brandName: 'Acme', domain: 'https://shop.acme.co.nz' })).toEqual([
      'acme',
      'shop acme co nz',
    ])
  })

  it('ignores a domain with a path (a page on someone else\'s site)', () => {
    expect(
      buildClientIdentifiers({ brandName: 'Jane Doe', domain: 'raywhite.co.nz/agents/jane-doe' })
    ).toEqual(['jane doe'])
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
    expect(isClientBrand('CTS Tours NZ Ltd', cts)).toBe(true)
    expect(isClientBrand('ctstours.co.nz', cts)).toBe(true)
    expect(isClientBrand('Dixon Homes Ltd', dixon)).toBe(true)
  })

  it('a national brand does not claim a branch-named client', () => {
    const branch = buildClientIdentifiers({ brandName: 'Ray White Mission Bay' })
    expect(isClientBrand('Ray White', branch)).toBe(false)
  })

  it('a short single-token alias must equal the brand exactly', () => {
    const ids = buildClientIdentifiers({ brandName: 'CTS Tours NZ', aliases: ['CTS'] })
    expect(isClientBrand('CTS', ids)).toBe(true)
    expect(isClientBrand('CTS Logistics', ids)).toBe(false)
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

  it('a shorter name only counts once it is configured as an alias', () => {
    const brands = [
      { brand: 'JR Academy', rank: 1, snippet: 'x' },
      { brand: 'Magic Lab', rank: 2, snippet: 'x' },
    ]
    const raw = 'Compare JR Academy and Magic Lab for small-business owners learning AI.'
    expect(resolveClientBrandRank(brands, raw, { brandName: 'Magic Lab Class' }).client_brand_rank).toBeNull()
    expect(
      resolveClientBrandRank(brands, raw, { brandName: 'Magic Lab Class', aliases: ['Magic Lab'] })
        .client_brand_rank
    ).toBe(2)
  })

  it('a 2-char CJK alias is not textual evidence (no word boundaries in CJK)', () => {
    const out = resolveClientBrandRank([], '我推荐中旅游公司的行程，性价比很高。', {
      brandName: 'CTS Tours',
      aliases: ['中旅'],
    })
    expect(out.client_brand_rank).toBeNull()
  })

  it('composite name: client written as "Person" only is still found', () => {
    const out = resolveClientBrandRank(
      [{ brand: 'Ray White', rank: 1, snippet: 'Agent Roman Hu at Ray White is great.' }],
      'Agent Roman Hu at Ray White is great.',
      { brandName: 'Roman Hu — Ray White Mission Bay', domain: 'romanhu.com' }
    )
    expect(out.client_brand_rank).toBe(1)
    expect(out.brands.map(b => [b.brand, b.rank])).toEqual([
      ['Roman Hu — Ray White Mission Bay', 1],
      ['Ray White', 2],
    ])
  })

  it('"&" and "and" are treated alike when ordering an inserted client', () => {
    const out = resolveClientBrandRank(
      [
        { brand: 'Barfoot & Thompson', rank: 1, snippet: 'x' },
        { brand: 'Bayleys', rank: 2, snippet: 'x' },
      ],
      'Barfoot and Thompson, Bayleys, then Acme Realty.',
      { brandName: 'Acme Realty' }
    )
    expect(out.client_brand_rank).toBe(3)
  })

  it('domain-only identity never inserts an empty brand name', () => {
    const out = resolveClientBrandRank([], 'See acmetours.co.nz for itineraries.', {
      brandName: '',
      domain: 'acmetours.co.nz',
    })
    expect(out.client_brand_rank).toBe(1)
    expect(out.brands[0].brand).toBe('acmetours.co.nz')
  })

  it('a short alias mentioned only as part of a different brand is not evidence', () => {
    const out = resolveClientBrandRank(
      [{ brand: 'CTS Logistics', rank: 1, snippet: 'x' }],
      'For freight, try CTS Logistics — they cover the whole North Island.',
      { brandName: 'CTS Tours NZ', aliases: ['CTS'] }
    )
    expect(out.client_brand_rank).toBeNull()
    expect(out.brands.map(b => [b.brand, b.rank])).toEqual([['CTS Logistics', 1]])
  })

  it('a bare short alias with no competing brand is still evidence', () => {
    const out = resolveClientBrandRank(
      [],
      'For your trip, I recommend CTS — they know the region well.',
      { brandName: 'CTS Tours NZ', aliases: ['CTS'] }
    )
    expect(out.client_brand_rank).toBe(1)
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
