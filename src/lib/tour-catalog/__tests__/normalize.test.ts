import { describe, it, expect } from 'vitest'

import { matchTour, norm, shortName } from '../normalize'
import type { CatalogAlias, CatalogTour } from '../types'
import { EMPTY_TOUR_CONTENT } from './content-fixture'

/** Build a CatalogTour fixture with neutral defaults for all required fields. */
function makeTour(overrides: Partial<CatalogTour> & { id: string }): CatalogTour {
  return {
    clientId: 'client-1',
    slug: overrides.id,
    destination: 'China',
    tier: 'signature',
    name: overrides.id,
    title: null,
    shortDescription: null,
    durationText: null,
    displayPriceText: null,
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    tourCities: [],
    singleSupplement: null,
    maxGroupSize: null,
    isActive: true,
    managesDepartures: true,
    sortOrder: 0,
    ...EMPTY_TOUR_CONTENT,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('norm', () => {
  it('trims, lowercases and expands "&" to "and"', () => {
    expect(norm('  Shanghai &  Surroundings ')).toBe('shanghai and surroundings')
  })

  it('treats "&" and "and" as equal', () => {
    expect(norm('Shanghai & Surroundings')).toBe(norm('Shanghai and Surroundings'))
  })

  it('collapses whitespace runs including newlines and tabs', () => {
    expect(norm('Best\t of\n\nChina')).toBe('best of china')
  })
})

describe('shortName', () => {
  it('returns the part after the first separator', () => {
    expect(shortName('China Signature — Natural China')).toBe('Natural China')
  })

  it('returns the trimmed name when no separator is present', () => {
    expect(shortName('  Best of China  ')).toBe('Best of China')
  })

  it('uses only the first separator', () => {
    expect(shortName('A — B — C')).toBe('B — C')
  })
})

describe('matchTour', () => {
  const signature = makeTour({
    id: 'signature',
    name: 'China Signature — Natural China',
  })
  const discovery = makeTour({
    id: 'discovery',
    name: 'China Discovery — Natural China',
  })
  const bestOfChina = makeTour({
    id: 'best-of-china',
    name: 'China Discovery — Best of China',
  })

  it('matches an exact full name', () => {
    const result = matchTour('China Signature — Natural China', [signature], [])
    expect(result).toEqual({ status: 'matched', tour: signature })
  })

  it('matches a short name', () => {
    const result = matchTour('Best of China', [bestOfChina], [])
    expect(result).toEqual({ status: 'matched', tour: bestOfChina })
  })

  it('matches across "&" and "and"', () => {
    const tour = makeTour({ id: 'shanghai', name: 'Shanghai & Surroundings' })
    const result = matchTour('Shanghai and Surroundings', [tour], [])
    expect(result).toEqual({ status: 'matched', tour })
  })

  it('returns ambiguous when two tours share a short name', () => {
    const result = matchTour('Natural China', [signature, discovery], [])
    expect(result).toEqual({
      status: 'ambiguous',
      candidates: [signature, discovery],
    })
  })

  it('prefers an alias hit over short-name ambiguity', () => {
    const aliases: CatalogAlias[] = [
      { aliasNorm: 'natural china', tourId: 'signature' },
    ]
    const result = matchTour('Natural China', [signature, discovery], aliases)
    expect(result).toEqual({ status: 'matched', tour: signature })
  })

  it('returns none for an unknown name', () => {
    const result = matchTour('Nowhere Tour', [signature, discovery], [])
    expect(result).toEqual({ status: 'none' })
  })

  it('returns none for an empty string', () => {
    const result = matchTour('   ', [signature, discovery], [])
    expect(result).toEqual({ status: 'none' })
  })

  it('ignores aliases pointing to tours not in the list', () => {
    const aliases: CatalogAlias[] = [
      { aliasNorm: 'natural china', tourId: 'missing' },
    ]
    const result = matchTour('Natural China', [signature, discovery], aliases)
    expect(result).toEqual({
      status: 'ambiguous',
      candidates: [signature, discovery],
    })
  })

  it('prefers a full-name match over a short-name match', () => {
    const fullNameTour = makeTour({ id: 'full', name: 'Natural China' })
    const result = matchTour('Natural China', [fullNameTour, signature], [])
    expect(result).toEqual({ status: 'matched', tour: fullNameTour })
  })
})
