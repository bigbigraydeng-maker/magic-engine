import { describe, expect, it } from 'vitest'
import {
  buildBusinessKeywordTerms,
  extractExcludedTopics,
  isBusinessRelevantKeyword,
} from '../keyword-relevance'

describe('keyword relevance guard', () => {
  const oztopTerms = buildBusinessKeywordTerms({
    domain: 'oztopbuildingsupplies.com.au',
    industry: 'flooring and building supplies',
    seedTerms: ['SPC flooring', 'engineered timber flooring'],
  })

  const oztopExcluded = ['shutter', 'blind', 'curtain', 'window treatment', 'plantation']

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

  // ── excluded_topics: Oztop does not sell shutters/blinds/curtains ──────────

  it('blocks excluded topic — exact singular root', () => {
    expect(isBusinessRelevantKeyword('plantation shutter cost', oztopTerms, oztopExcluded)).toBe(false)
    expect(isBusinessRelevantKeyword('venetian blind installation', oztopTerms, oztopExcluded)).toBe(false)
    expect(isBusinessRelevantKeyword('sheer curtain ideas', oztopTerms, oztopExcluded)).toBe(false)
  })

  it('blocks excluded topic — plural forms via substring match', () => {
    expect(isBusinessRelevantKeyword('shutters near me', oztopTerms, oztopExcluded)).toBe(false)
    expect(isBusinessRelevantKeyword('roller blinds Brisbane', oztopTerms, oztopExcluded)).toBe(false)
    expect(isBusinessRelevantKeyword('curtains online australia', oztopTerms, oztopExcluded)).toBe(false)
  })

  it('blocks excluded multi-word topic — window treatment', () => {
    expect(isBusinessRelevantKeyword('window treatment ideas 2026', oztopTerms, oztopExcluded)).toBe(false)
  })

  it('allows real Oztop flooring keywords despite excluded list', () => {
    expect(isBusinessRelevantKeyword('preference flooring cost', oztopTerms, oztopExcluded)).toBe(true)
    expect(isBusinessRelevantKeyword('karndean flooring australia', oztopTerms, oztopExcluded)).toBe(true)
    expect(isBusinessRelevantKeyword('lappato finish tiles brisbane', oztopTerms, oztopExcluded)).toBe(true)
    expect(isBusinessRelevantKeyword('nfd flooring nz', oztopTerms, oztopExcluded)).toBe(true)
  })

  // ── backward-compatibility: no excludedTopics means behaviour unchanged ───

  it('backward-compat: shutters passes without excluded list (old behaviour)', () => {
    // Without excludedTopics, shutters is in businessTerms so it is relevant — original behaviour
    expect(isBusinessRelevantKeyword('plantation shutters brisbane', oztopTerms)).toBe(true)
    expect(isBusinessRelevantKeyword('roller blinds nz', oztopTerms)).toBe(true)
  })

  it('backward-compat: empty excludedTopics array = same as no argument', () => {
    expect(isBusinessRelevantKeyword('shutters near me', oztopTerms, [])).toBe(true)
    expect(isBusinessRelevantKeyword('flooring store', oztopTerms, [])).toBe(true)
  })

  it('non-matching excluded topic does not block unrelated keyword', () => {
    // excluded=['shutter'] should NOT block flooring keywords
    expect(isBusinessRelevantKeyword('spc flooring price', oztopTerms, ['shutter'])).toBe(true)
    expect(isBusinessRelevantKeyword('engineered timber perth', oztopTerms, ['shutter'])).toBe(true)
  })
})

describe('extractExcludedTopics', () => {
  it('returns empty array for null brief', () => {
    expect(extractExcludedTopics(null)).toEqual([])
  })

  it('returns empty array when field absent', () => {
    expect(extractExcludedTopics({ brand_name: 'Oztop' })).toEqual([])
  })

  it('parses string array from brief', () => {
    const brief = { excluded_topics: ['Shutter', 'Blind ', 'CURTAIN'] }
    expect(extractExcludedTopics(brief)).toEqual(['shutter', 'blind', 'curtain'])
  })

  it('handles single string value', () => {
    const brief = { excluded_topics: 'plantation' }
    expect(extractExcludedTopics(brief)).toEqual(['plantation'])
  })
})
