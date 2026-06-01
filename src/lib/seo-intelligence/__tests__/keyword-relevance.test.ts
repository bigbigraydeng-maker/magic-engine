import { describe, expect, it } from 'vitest'
import {
  buildBusinessKeywordTerms,
  isBusinessRelevantKeyword,
} from '../keyword-relevance'

describe('keyword relevance guard', () => {
  const oztopTerms = buildBusinessKeywordTerms({
    domain: 'oztopbuildingsupplies.com.au',
    industry: 'flooring and building supplies',
    seedTerms: ['SPC flooring', 'engineered timber flooring'],
  })

  it('keeps business-relevant flooring keywords', () => {
    expect(isBusinessRelevantKeyword('pet friendly flooring Brisbane', oztopTerms)).toBe(true)
    expect(isBusinessRelevantKeyword('engineered timber flooring', oztopTerms)).toBe(true)
  })

  it('blocks broad retail and public-facility noise seen in QA', () => {
    expect(isBusinessRelevantKeyword('marketplace', oztopTerms)).toBe(false)
    expect(isBusinessRelevantKeyword('bunnings near me', oztopTerms)).toBe(false)
    expect(isBusinessRelevantKeyword('officeworks near me', oztopTerms)).toBe(false)
    expect(isBusinessRelevantKeyword('toilet near me', oztopTerms)).toBe(false)
    expect(isBusinessRelevantKeyword('canvas', oztopTerms)).toBe(false)
  })
})
