import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseListingItem,
  searchBusinessListings,
  INDUSTRY_CATEGORIES,
  CITY_COORDS,
} from '../business-listings'

vi.mock('@/lib/validation-utils', () => ({
  validateEnvVar: () => 'test',
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

describe('parseListingItem', () => {
  it('normalises a complete listing', () => {
    const l = parseListingItem({
      place_id: 'ChIJabc',
      title: 'Oz Flooring Co',
      category: 'Flooring store',
      address: '1 Main St, Sydney NSW',
      address_info: { city: 'Sydney', country_code: 'AU' },
      phone: '+61 2 9999 9999',
      url: 'https://www.ozflooring.com.au/home',
      is_claimed: true,
      rating: { value: 4.6, votes_count: 87 },
    })
    expect(l).toMatchObject({
      place_id: 'ChIJabc',
      name: 'Oz Flooring Co',
      city: 'Sydney',
      country_code: 'AU',
      domain: 'ozflooring.com.au',
      rating: 4.6,
      review_count: 87,
      is_claimed: true,
    })
  })

  it('returns null for a listing without a title', () => {
    expect(parseListingItem({ place_id: 'x' })).toBeNull()
  })

  it('handles a listing with no website', () => {
    const l = parseListingItem({ title: 'No Site Plumbing' })
    expect(l?.domain).toBeNull()
    expect(l?.website_url).toBeNull()
    expect(l?.rating).toBeNull()
  })

  it('extracts domain from url when domain field is absent', () => {
    const l = parseListingItem({ title: 'X', url: 'http://example.co.nz/about' })
    expect(l?.domain).toBe('example.co.nz')
  })
})

describe('searchBusinessListings', () => {
  it('surfaces a task-level error instead of returning an empty list', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        tasks: [{ status_code: 40501, status_message: 'Invalid Field: categories' }],
      }),
    } as Response)
    await expect(
      searchBusinessListings({ categories: ['bogus'], coord: '0,0' }),
    ).rejects.toThrow(/40501.*Invalid Field/)
  })

  it('parses a successful response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        tasks: [{
          status_code: 20000,
          result: [{ items: [{ title: 'A Plumbing', url: 'https://aplumbing.co.nz' }, { title: '' }] }],
        }],
      }),
    } as Response)
    const listings = await searchBusinessListings({ categories: ['plumber'], coord: '0,0' })
    expect(listings).toHaveLength(1)
    expect(listings[0].domain).toBe('aplumbing.co.nz')
  })
})

describe('seed data', () => {
  it('covers the 18 priority industries', () => {
    expect(Object.keys(INDUSTRY_CATEGORIES)).toHaveLength(18)
  })

  it('every city has a lat,long coord and AU/NZ country', () => {
    for (const { coord, country } of Object.values(CITY_COORDS)) {
      expect(coord).toMatch(/^-?\d+\.\d+,-?\d+\.\d+$/)
      expect(['AU', 'NZ']).toContain(country)
    }
  })
})
