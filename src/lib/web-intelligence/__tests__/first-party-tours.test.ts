import { describe, expect, it } from 'vitest'
import { firstPartyTourProducts, parseFirstPartyTourFeed } from '../first-party-tours'

describe('first-party Tour feed', () => {
  it('accepts the structured catalogue and keeps itinerary data', () => {
    const feed = parseFirstPartyTourFeed({
      source: 'chinatravel.tours', source_version: '2026-09-12', products: [{
        id: 'golden-china', slug: 'golden-china', destination: 'china', tier: 'signature', name: 'Golden China',
        title: 'Golden China', duration: '12 days', price: 'NZD $4,999', is_active: true, updated_at: '2026-09-10',
        departure_dates: ['16 November 2026'], departure_pricing: {}, tour_cities: ['beijing', 'xian', 'shanghai'],
        itinerary: [{ day: 1, title: 'Arrive', description: 'Welcome', meals: [] }], inclusions: ['Accommodation'], exclusions: ['Visa'],
      }],
    })
    expect(feed?.products[0].itinerary[0].title).toBe('Arrive')
    expect(feed?.products[0].tour_cities).toEqual(['beijing', 'xian', 'shanghai'])
  })

  it('maps only active products without inventing missing audience data', () => {
    const feed = parseFirstPartyTourFeed({
      source: 'test', source_version: 'v1', products: [
        { id: 'active', destination: 'china', name: 'Active', is_active: true, updated_at: '2026-09-10', departure_dates: [], departure_pricing: {}, tour_cities: ['beijing'], itinerary: [], inclusions: [], exclusions: [] },
        { id: 'inactive', destination: 'china', name: 'Inactive', is_active: false, updated_at: '2026-09-10', departure_dates: [], departure_pricing: {}, tour_cities: [], itinerary: [], inclusions: [], exclusions: [] },
      ],
    })
    const products = firstPartyTourProducts(feed!)
    expect(products).toHaveLength(1)
    expect(products[0].destination).toBe('china')
    expect('audience' in products[0]).toBe(false)
  })

  it('fails closed for malformed feeds', () => {
    expect(parseFirstPartyTourFeed({ source: 'test', products: [] })).toBeNull()
    expect(parseFirstPartyTourFeed(null)).toBeNull()
  })
})
