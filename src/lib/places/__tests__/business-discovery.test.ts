import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  toListing,
  discoverBusinessesViaPlaces,
  INDUSTRY_SEARCH_LABEL,
} from '../business-discovery'
import { INDUSTRY_CATEGORIES } from '@/lib/dataforseo/business-listings'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
})

describe('toListing', () => {
  it('merges a search result and its detail into a BusinessListing', () => {
    const l = toListing(
      { place_id: 'p1', name: 'Oz Flooring', rating: 4.6, user_ratings_total: 88, formatted_address: '1 Main St', types: ['flooring_store'] },
      { website: 'https://www.ozflooring.com.au/', formatted_phone_number: '07 1234 5678', business_status: 'OPERATIONAL' },
      'Brisbane', 'AU', 'flooring store',
    )
    expect(l).toMatchObject({
      place_id: 'p1', name: 'Oz Flooring', city: 'Brisbane', country_code: 'AU',
      domain: 'ozflooring.com.au', website_url: 'https://www.ozflooring.com.au/',
      phone: '07 1234 5678', rating: 4.6, review_count: 88,
    })
    // business_status must NOT be faked into a GBP claim signal
    expect(l?.is_claimed).toBe(false)
  })

  it('handles a result with no detail (no website / phone)', () => {
    const l = toListing({ place_id: 'p2', name: 'No Site Co' }, null, 'Perth', 'AU', 'plumber')
    expect(l?.domain).toBeNull()
    expect(l?.website_url).toBeNull()
    expect(l?.is_claimed).toBe(false)
    expect(l?.category).toBe('plumber')
  })

  it('returns null without a place_id or name', () => {
    expect(toListing({ name: 'X' }, null, 'Perth', 'AU', 'x')).toBeNull()
    expect(toListing({ place_id: 'p' }, null, 'Perth', 'AU', 'x')).toBeNull()
  })
})

describe('discoverBusinessesViaPlaces', () => {
  it('runs a text search + one detail call per result', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
        status: 'OK',
        results: [
          { place_id: 'p1', name: 'A Flooring', rating: 4.8, user_ratings_total: 120 },
          { place_id: 'p2', name: 'B Flooring', rating: 4.2, user_ratings_total: 30 },
        ],
      }) } as Response)
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({
        status: 'OK', result: { website: 'https://b.com.au', business_status: 'OPERATIONAL' },
      }) } as Response)

    const listings = await discoverBusinessesViaPlaces({
      industry: 'flooring', city: 'brisbane', coord: '-27.47,153.02', country: 'AU',
    })
    expect(listings).toHaveLength(2)
    expect(listings[0].name).toBe('A Flooring')
    // 1 text search + 2 detail calls
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('searches by query text only, with no location/radius params (avoids INVALID_REQUEST)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'ZERO_RESULTS', results: [] }) } as Response)
    await discoverBusinessesViaPlaces({ industry: 'flooring', city: 'brisbane', coord: '-27.47,153.02', country: 'AU' })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('query=flooring%20store%20in%20Brisbane%2C%20Australia')
    expect(url).not.toContain('location=')
    expect(url).not.toContain('radius=')
  })

  it('returns [] on ZERO_RESULTS without throwing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'ZERO_RESULTS', results: [] }) } as Response)
    const listings = await discoverBusinessesViaPlaces({
      industry: 'flooring', city: 'brisbane', coord: '0,0', country: 'AU',
    })
    expect(listings).toEqual([])
  })

  it('throws a diagnostic error on a Places API error status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
      status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.',
    }) } as Response)
    await expect(discoverBusinessesViaPlaces({
      industry: 'flooring', city: 'brisbane', coord: '0,0', country: 'AU',
    })).rejects.toThrow(/REQUEST_DENIED.*API key is invalid/)
  })

  it('rejects an unknown industry seed', async () => {
    await expect(discoverBusinessesViaPlaces({
      industry: 'bogus', city: 'brisbane', coord: '0,0', country: 'AU',
    })).rejects.toThrow(/No Places search label/)
  })

  it('aborts the whole run (not silent null) when Details hits a quota limit', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
        status: 'OK', results: [{ place_id: 'p1', name: 'A Flooring', rating: 4.8 }],
      }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
        status: 'OVER_QUERY_LIMIT', error_message: 'You have exceeded your daily request quota.',
      }) } as Response)
    await expect(discoverBusinessesViaPlaces({
      industry: 'flooring', city: 'brisbane', coord: '0,0', country: 'AU',
    })).rejects.toThrow(/OVER_QUERY_LIMIT/)
  })

  it('keeps going (website null) when Details returns NOT_FOUND for one business', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
        status: 'OK', results: [{ place_id: 'p1', name: 'A Flooring', rating: 4.8 }],
      }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'NOT_FOUND' }) } as Response)
    const listings = await discoverBusinessesViaPlaces({
      industry: 'flooring', city: 'brisbane', coord: '0,0', country: 'AU',
    })
    expect(listings).toHaveLength(1)
    expect(listings[0].website_url).toBeNull()
  })

  it('drops national chains from the results', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
        status: 'OK', results: [
          { place_id: 'p1', name: 'Bunnings Warehouse Brisbane', rating: 4.1 },
          { place_id: 'p2', name: 'Local Timber Floors', rating: 4.9 },
        ],
      }) } as Response)
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'OK', result: {} }) } as Response)
    const listings = await discoverBusinessesViaPlaces({
      industry: 'flooring', city: 'brisbane', coord: '0,0', country: 'AU',
    })
    expect(listings.map(l => l.name)).toEqual(['Local Timber Floors'])
  })
})

describe('seed label coverage', () => {
  it('covers exactly the same 18 industries as INDUSTRY_CATEGORIES', () => {
    expect(Object.keys(INDUSTRY_SEARCH_LABEL).sort()).toEqual(Object.keys(INDUSTRY_CATEGORIES).sort())
  })
})
