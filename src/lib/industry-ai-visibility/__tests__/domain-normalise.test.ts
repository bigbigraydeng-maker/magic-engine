import { describe, expect, it } from 'vitest'
import { extractDomainBrand, extractDomainBrandsFromOrganic } from '../domain-normalise'
import { isAggregatorHost } from '../aggregator-blacklist'

describe('extractDomainBrand', () => {
  it('strips .co.nz, returns last label', () => {
    expect(extractDomainBrand('https://www.ctstours.co.nz/')).toBe('ctstours')
  })

  it('strips .com.au', () => {
    expect(extractDomainBrand('https://intrepidtravel.com.au/tours')).toBe('intrepidtravel')
  })

  it('strips www. and .com', () => {
    expect(extractDomainBrand('https://www.intrepidtravel.com/')).toBe('intrepidtravel')
  })

  it('drops subdomains beyond the registrable base', () => {
    expect(extractDomainBrand('https://bookings.example.co.nz/')).toBe('example')
    expect(extractDomainBrand('https://blog.intrepidtravel.com/post')).toBe('intrepidtravel')
  })

  it('returns null for aggregator hosts', () => {
    expect(extractDomainBrand('https://www.tripadvisor.com/Attraction_Review-x')).toBeNull()
    expect(extractDomainBrand('https://www.reddit.com/r/travel/comments/abc')).toBeNull()
    expect(extractDomainBrand('https://newzealand.com/nz/plan/business/x')).toBeNull()
  })

  it('returns null for SaaS multi-tenant hosts', () => {
    expect(extractDomainBrand('https://customer.myshopify.com/')).toBeNull()
    expect(extractDomainBrand('https://my-tour.wixsite.com/')).toBeNull()
  })

  it('returns null for non-URL or empty input', () => {
    expect(extractDomainBrand('not a url')).toBeNull()
    expect(extractDomainBrand('')).toBeNull()
    expect(extractDomainBrand(null)).toBeNull()
    expect(extractDomainBrand(undefined)).toBeNull()
  })

  it('handles unknown TLD defensively (joins last two labels)', () => {
    expect(extractDomainBrand('https://x.example.xyz/')).toBe('example.xyz')
  })
})

describe('extractDomainBrandsFromOrganic', () => {
  it('preserves SERP order and dedupes', () => {
    const organic = [
      { url: 'https://www.ctstours.co.nz/' },
      { url: 'https://www.intrepidtravel.com/' },
      { url: 'https://blog.ctstours.co.nz/another-post' },   // dup → dropped
      { url: 'https://www.tripadvisor.com/' },               // aggregator → dropped
    ]
    expect(extractDomainBrandsFromOrganic(organic)).toEqual(['ctstours', 'intrepidtravel'])
  })

  it('returns [] for null / empty input', () => {
    expect(extractDomainBrandsFromOrganic(null)).toEqual([])
    expect(extractDomainBrandsFromOrganic([])).toEqual([])
  })
})

describe('isAggregatorHost', () => {
  it('matches exact + subdomains', () => {
    expect(isAggregatorHost('tripadvisor.com')).toBe(true)
    expect(isAggregatorHost('amp.tripadvisor.com')).toBe(true)
    expect(isAggregatorHost('reddit.com')).toBe(true)
    expect(isAggregatorHost('www.reddit.com')).toBe(true)
  })

  it('does NOT false-positive on similar names', () => {
    expect(isAggregatorHost('reddit-clone.com')).toBe(false)
    expect(isAggregatorHost('mytripadvisor.com')).toBe(false)
  })
})
