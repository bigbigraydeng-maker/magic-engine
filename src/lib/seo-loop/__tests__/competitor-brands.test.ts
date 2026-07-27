import { describe, it, expect } from 'vitest'
import {
  competitorBrandTokens,
  isCompetitorBrandKeyword,
  squashKeyword,
} from '../competitor-brands'

describe('squashKeyword', () => {
  it('strips spacing and punctuation', () => {
    expect(squashKeyword('Carpet Court')).toBe('carpetcourt')
    expect(squashKeyword('carpet-court!')).toBe('carpetcourt')
  })
})

describe('competitorBrandTokens', () => {
  it('strips au and nz public suffixes', () => {
    expect(competitorBrandTokens(['carpetcourt.com.au'])).toEqual(['carpetcourt'])
    expect(competitorBrandTokens(['wendywutours.co.nz'])).toEqual(['wendywutours'])
  })

  it('strips protocol, www and trailing path', () => {
    expect(competitorBrandTokens(['https://www.carpetcall.com.au/rugs'])).toEqual(['carpetcall'])
  })

  it('keeps the most specific label on a subdomain', () => {
    expect(competitorBrandTokens(['tours.nzchinasociety.org.nz'])).toEqual(['nzchinasociety'])
  })

  it('de-duplicates repeated domains', () => {
    // CTS genuinely has inspiringvacations.com listed twice.
    expect(competitorBrandTokens(['inspiringvacations.com', 'inspiringvacations.com']))
      .toEqual(['inspiringvacations'])
  })

  it('discards tokens too short to be a safe brand match', () => {
    // An exact-match domain must not turn into a token that nukes the whole
    // category. `flooring` is 8 chars, so this specifically guards the boundary.
    expect(competitorBrandTokens(['floors.com.au'])).toEqual([])
    expect(competitorBrandTokens(['tiles.com.au'])).toEqual([])
  })

  it('ignores empty and non-string entries', () => {
    expect(competitorBrandTokens(['', '   '])).toEqual([])
  })
})

describe('isCompetitorBrandKeyword', () => {
  const tokens = competitorBrandTokens([
    'carpetcall.com.au', 'carpetcourt.com.au',
    'theflooringguys.com.au', 'floorworld.com.au',
  ])

  it('catches the real 2026-07-27 Oztop false positives', () => {
    // These three topped the raw gap list at 27,100 / 22,200 / 1,900 a month.
    // All are competitor brands and none is a content opportunity.
    expect(isCompetitorBrandKeyword('carpet court', tokens)).toBe(true)
    expect(isCompetitorBrandKeyword('carpet call', tokens)).toBe(true)
    expect(isCompetitorBrandKeyword('the flooring guys', tokens)).toBe(true)
  })

  it('catches brand terms with extra words around them', () => {
    expect(isCompetitorBrandKeyword('carpet call near me', tokens)).toBe(true)
    expect(isCompetitorBrandKeyword('carpet court rugs sale', tokens)).toBe(true)
  })

  it('lets genuine category keywords through', () => {
    expect(isCompetitorBrandKeyword('hybrid flooring brisbane', tokens)).toBe(false)
    expect(isCompetitorBrandKeyword('spc flooring trade price', tokens)).toBe(false)
    expect(isCompetitorBrandKeyword('best carpet underlay', tokens)).toBe(false)
  })

  it('returns false when no competitors are configured', () => {
    expect(isCompetitorBrandKeyword('carpet court', [])).toBe(false)
  })

  it('returns false for an empty keyword', () => {
    expect(isCompetitorBrandKeyword('   ', tokens)).toBe(false)
  })
})
