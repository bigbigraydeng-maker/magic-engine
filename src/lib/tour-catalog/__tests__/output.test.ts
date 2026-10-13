import { describe, it, expect } from 'vitest'
import { toFirstPartyTours } from '../output'
import type { CatalogDeparture, CatalogTour } from '../types'
import { EMPTY_TOUR_CONTENT } from './content-fixture'

function makeTour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: 'tour-1',
    clientId: 'client-1',
    slug: 'tour-1',
    destination: 'New Zealand',
    tier: 'premium',
    name: 'Tour One',
    title: 'Tour One Title',
    shortDescription: 'Short',
    durationText: '10 days',
    displayPriceText: 'From NZD $4,999 per person',
    highlights: ['h1'],
    itinerary: [{ day: 1, title: 'Arrival', description: 'Arrive', meals: ['dinner'] }],
    inclusions: ['in1'],
    exclusions: ['ex1'],
    tourCities: ['Auckland', 'Wellington'],
    singleSupplement: 'NZD $900',
    maxGroupSize: 16,
    isActive: true,
    managesDepartures: true,
    sortOrder: 1,
    ...EMPTY_TOUR_CONTENT,
    updatedAt: '2027-05-13T09:30:00.000Z',
    ...overrides,
  }
}

function makeDeparture(overrides: Partial<CatalogDeparture> = {}): CatalogDeparture {
  return {
    id: 'dep-1',
    tourId: 'tour-1',
    clientId: 'client-1',
    departOn: '2027-05-13',
    returnOn: '2027-05-23',
    priceTextOverride: null,
    status: 'open',
    internal: { airline: 'XX-AIRLINE', capacity: 20 },
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const TODAY = '2027-01-01'

describe('toFirstPartyTours', () => {
  it('maps every field of a tour', () => {
    const tour = makeTour()
    const [result] = toFirstPartyTours([tour], [], TODAY)

    expect(result.id).toBe('tour-1')
    expect(result.slug).toBe('tour-1')
    expect(result.destination).toBe('New Zealand')
    expect(result.tier).toBe('premium')
    expect(result.name).toBe('Tour One')
    expect(result.title).toBe('Tour One Title')
    expect(result.duration).toBe('10 days')
    expect(result.price).toBe('From NZD $4,999 per person')
    expect(result.updated_at).toBe('2027-05-13')
    expect(result.tour_cities).toEqual(['Auckland', 'Wellington'])
    expect(result.itinerary).toEqual([
      { day: 1, title: 'Arrival', description: 'Arrive', meals: ['dinner'] },
    ])
    expect(result.inclusions).toEqual(['in1'])
    expect(result.exclusions).toEqual(['ex1'])
    expect(result.single_supplement).toBe('NZD $900')
    expect(result.max_group_size).toBe(16)
  })

  it('formats departure dates as "13 May 2027" and sorts ascending', () => {
    const tour = makeTour()
    const departures = [
      makeDeparture({ id: 'd2', departOn: '2027-06-01' }),
      makeDeparture({ id: 'd1', departOn: '2027-05-13' }),
    ]
    const [result] = toFirstPartyTours([tour], departures, TODAY)
    expect(result.departure_dates).toEqual(['13 May 2027', '1 June 2027'])
  })

  it('excludes sold_out, closed, cancelled and past departures', () => {
    const tour = makeTour()
    const departures = [
      makeDeparture({ id: 'd1', departOn: '2027-05-13', status: 'sold_out' }),
      makeDeparture({ id: 'd2', departOn: '2027-05-14', status: 'closed' }),
      makeDeparture({ id: 'd3', departOn: '2027-05-15', status: 'cancelled' }),
      makeDeparture({ id: 'd4', departOn: '2026-12-31', status: 'open' }),
    ]
    const [result] = toFirstPartyTours([tour], departures, TODAY)
    expect(result.departure_dates).toEqual([])
  })

  it('includes limited departures', () => {
    const tour = makeTour()
    const departures = [makeDeparture({ departOn: '2027-05-13', status: 'limited' })]
    const [result] = toFirstPartyTours([tour], departures, TODAY)
    expect(result.departure_dates).toEqual(['13 May 2027'])
  })

  it('includes departures exactly on today', () => {
    const tour = makeTour()
    const departures = [makeDeparture({ departOn: TODAY, status: 'open' })]
    const [result] = toFirstPartyTours([tour], departures, TODAY)
    expect(result.departure_dates).toEqual(['1 January 2027'])
  })

  it('builds departure_pricing keys equal to departure_dates strings', () => {
    const tour = makeTour()
    const departures = [
      makeDeparture({ id: 'd1', departOn: '2027-05-13', priceTextOverride: 'NZD $5,200' }),
      makeDeparture({ id: 'd2', departOn: '2027-06-01', priceTextOverride: null }),
    ]
    const [result] = toFirstPartyTours([tour], departures, TODAY)
    expect(result.departure_dates).toEqual(['13 May 2027', '1 June 2027'])
    expect(Object.keys(result.departure_pricing)).toEqual(['13 May 2027'])
    expect(result.departure_pricing['13 May 2027']).toBe('NZD $5,200')
    for (const key of Object.keys(result.departure_pricing)) {
      expect(result.departure_dates).toContain(key)
    }
  })

  it('ignores empty or whitespace-only price overrides', () => {
    const tour = makeTour()
    const departures = [
      makeDeparture({ id: 'd1', departOn: '2027-05-13', priceTextOverride: '' }),
      makeDeparture({ id: 'd2', departOn: '2027-06-01', priceTextOverride: '   ' }),
    ]
    const [result] = toFirstPartyTours([tour], departures, TODAY)
    expect(result.departure_pricing).toEqual({})
  })

  it('managesDepartures=true with zero visible departures -> is_active false', () => {
    const tour = makeTour({ isActive: true, managesDepartures: true })
    const [result] = toFirstPartyTours([tour], [], TODAY)
    expect(result.is_active).toBe(false)
  })

  it('managesDepartures=false with no departure rows -> is_active true', () => {
    const tour = makeTour({ isActive: true, managesDepartures: false })
    const [result] = toFirstPartyTours([tour], [], TODAY)
    expect(result.is_active).toBe(true)
  })

  it('isActive=false -> is_active false regardless of departures', () => {
    const tour = makeTour({ isActive: false, managesDepartures: false })
    const departures = [makeDeparture({ departOn: '2027-05-13', status: 'open' })]
    const [result] = toFirstPartyTours([tour], departures, TODAY)
    expect(result.is_active).toBe(false)
  })

  it('never includes internal data anywhere in the output', () => {
    const tour = makeTour()
    const departures = [makeDeparture({ internal: { airline: 'XX-AIRLINE', capacity: 20 } })]
    const output = toFirstPartyTours([tour], departures, TODAY)
    const json = JSON.stringify(output)
    expect(json).not.toContain('XX-AIRLINE')
    expect(json).not.toContain('internal')
    expect(json).not.toContain('capacity')
  })

  it('orders by sortOrder then name', () => {
    const tours = [
      makeTour({ id: 'b', name: 'Beta', sortOrder: 2 }),
      makeTour({ id: 'a', name: 'Alpha', sortOrder: 1 }),
      makeTour({ id: 'c', name: 'Charlie', sortOrder: 2 }),
    ]
    const result = toFirstPartyTours(tours, [], TODAY)
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('null displayPriceText -> price undefined', () => {
    const tour = makeTour({ displayPriceText: null })
    const [result] = toFirstPartyTours([tour], [], TODAY)
    expect(result.price).toBeUndefined()
  })

  it('null singleSupplement and maxGroupSize stay null', () => {
    const tour = makeTour({ singleSupplement: null, maxGroupSize: null })
    const [result] = toFirstPartyTours([tour], [], TODAY)
    expect(result.single_supplement).toBeNull()
    expect(result.max_group_size).toBeNull()
  })

  it('ignores departures belonging to other tours', () => {
    const tour = makeTour({ id: 'tour-1' })
    const departures = [
      makeDeparture({ id: 'd1', tourId: 'tour-2', departOn: '2027-05-13' }),
    ]
    const [result] = toFirstPartyTours([tour], departures, TODAY)
    expect(result.departure_dates).toEqual([])
  })
})
