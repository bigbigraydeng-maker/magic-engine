import { describe, expect, it } from 'vitest'

import {
  classifyQuery,
  normalizeQueryText,
  readBrandConfig,
  splitQueryRows,
  type BrandMatcher,
  type QueryRow,
} from '../brand-split'

function matcherOf(brand: string[], ambiguous: string[] = []): BrandMatcher {
  return { brand, ambiguous }
}

describe('normalizeQueryText', () => {
  it('lower-cases and collapses whitespace', () => {
    expect(normalizeQueryText('  Hello   World  ')).toBe('hello world')
  })

  it('applies NFKC and strips diacritics', () => {
    expect(normalizeQueryText('Māori Tours')).toBe('maori tours')
  })

  it('deletes apostrophes', () => {
    expect(normalizeQueryText("roman's")).toBe('romans')
    expect(normalizeQueryText('roman\u2019s')).toBe('romans')
    expect(normalizeQueryText('roman\u2018s')).toBe('romans')
    expect(normalizeQueryText('roman`s')).toBe('romans')
  })

  it('replaces non letter/number characters with spaces', () => {
    expect(normalizeQueryText('a-b.c/d')).toBe('a b c d')
  })

  it('keeps non-latin letters and numbers', () => {
    expect(normalizeQueryText('中旅 官网')).toBe('中旅 官网')
  })
})

describe('readBrandConfig', () => {
  it('rejects undefined', () => {
    expect(readBrandConfig(undefined)).toEqual({ status: 'brand_terms_not_configured' })
  })

  it('rejects null', () => {
    expect(readBrandConfig(null)).toEqual({ status: 'brand_terms_not_configured' })
  })

  it('rejects empty object', () => {
    expect(readBrandConfig({})).toEqual({ status: 'brand_terms_not_configured' })
  })

  it('rejects non-array brand_terms', () => {
    expect(readBrandConfig({ brand_terms: 'cts' })).toEqual({
      status: 'brand_terms_not_configured',
    })
  })

  it('rejects empty brand_terms array', () => {
    expect(readBrandConfig({ brand_terms: [] })).toEqual({
      status: 'brand_terms_not_configured',
    })
  })

  it('rejects terms that are too short or not strings', () => {
    expect(readBrandConfig({ brand_terms: ['', ' ', 'a', 5] })).toEqual({
      status: 'brand_terms_not_configured',
    })
  })

  it('accepts valid terms and normalises them', () => {
    const result = readBrandConfig({ brand_terms: ['CTS', '  Boying  '] })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.matcher.brand).toEqual(['cts', 'boying'])
    expect(result.matcher.ambiguous).toEqual([])
  })

  it('removes ambiguous terms that are also brand terms', () => {
    const result = readBrandConfig({
      brand_terms: ['cts'],
      brand_ambiguous_terms: ['cts', 'china travel service'],
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.matcher.brand).toEqual(['cts'])
    expect(result.matcher.ambiguous).toEqual(['china travel service'])
  })

  it('treats a missing ambiguous list as empty', () => {
    const result = readBrandConfig({ brand_terms: ['cts'] })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.matcher.ambiguous).toEqual([])
  })

  it('adds the domain stem when it extends a configured brand term', () => {
    const result = readBrandConfig(
      { brand_terms: ['example'] },
      'https://www.example-tours.co.nz/',
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.matcher.brand).toContain('example tours')
    expect(result.matcher.brand).toContain('exampletours')
  })

  it('adds "ctstours" for a "cts" brand on a ctstours domain, including a sc-domain property', () => {
    for (const site of ['https://ctstours.co.nz/', 'sc-domain:ctstours.co.nz']) {
      const result = readBrandConfig({ brand_terms: ['cts'] }, site)
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(result.matcher.brand).toEqual(['cts', 'ctstours'])
    }
  })

  it('does NOT add a domain stem that does not extend any configured term (generic word domain)', () => {
    const result = readBrandConfig({ brand_terms: ['cts'] }, 'https://www.example-tours.co.nz/')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.matcher.brand).toEqual(['cts'])
  })

  it('ignores siteUrl when no valid term exists', () => {
    const result = readBrandConfig(
      { brand_terms: [] },
      'https://www.example-tours.co.nz/',
    )
    expect(result).toEqual({ status: 'brand_terms_not_configured' })
  })

  it('ignores an unparsable siteUrl', () => {
    const result = readBrandConfig({ brand_terms: ['cts'] }, 'not a url')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.matcher.brand).toEqual(['cts'])
  })
})

describe('classifyQuery', () => {
  const matcher = matcherOf(['cts', 'boying'], ['china travel service'])

  it('matches "cts tours"', () => {
    expect(classifyQuery('cts tours', matcher)).toBe('brand')
  })

  it('matches "tours by cts"', () => {
    expect(classifyQuery('tours by cts', matcher)).toBe('brand')
  })

  it('does not match "facts about china"', () => {
    expect(classifyQuery('facts about china', matcher)).toBe('non_brand')
  })

  it('does not match "acts"', () => {
    expect(classifyQuery('acts', matcher)).toBe('non_brand')
  })

  it('matches "boying"', () => {
    expect(classifyQuery('boying', matcher)).toBe('brand')
  })

  it('prefers brand over ambiguous', () => {
    const m = matcherOf(['cts'], ['cts china travel service'])
    expect(classifyQuery('cts china travel service', m)).toBe('brand')
  })

  it('classifies ambiguous terms', () => {
    expect(classifyQuery('china travel service', matcher)).toBe('ambiguous')
  })

  it('defaults to non_brand', () => {
    expect(classifyQuery('random query', matcher)).toBe('non_brand')
  })

  it('matches non-latin terms by substring', () => {
    const m = matcherOf(['中旅'])
    expect(classifyQuery('中旅 官网', m)).toBe('brand')
  })

  it('matches diacritic queries against normalised terms', () => {
    const m = matcherOf(['maori tours'])
    expect(classifyQuery('Māori Tours', m)).toBe('brand')
  })

  it('matches apostrophe queries against normalised terms', () => {
    const m = matcherOf(['romans'])
    expect(classifyQuery("roman's", m)).toBe('brand')
  })
})

describe('splitQueryRows', () => {
  const matcher = matcherOf(['cts', 'boying'], ['china travel service'])

  it('returns all-zero buckets for empty rows', () => {
    const result = splitQueryRows([], matcher)
    expect(result.brand).toEqual({
      clicks: 0,
      impressions: 0,
      distinct_queries: 0,
      position: null,
    })
    expect(result.ambiguous).toEqual({
      clicks: 0,
      impressions: 0,
      distinct_queries: 0,
      position: null,
    })
    expect(result.non_brand).toEqual({
      clicks: 0,
      impressions: 0,
      distinct_queries: 0,
      position: null,
    })
    expect(result.suspect_missed_brand).toEqual([])
  })

  it('sums clicks and impressions per bucket', () => {
    const rows: QueryRow[] = [
      { query: 'cts tours', clicks: 3, impressions: 10, position: 1 },
      { query: 'cts tours', clicks: 2, impressions: 5, position: 2 },
      { query: 'china travel service', clicks: 1, impressions: 4, position: 3 },
      { query: 'random', clicks: 0, impressions: 2, position: 5 },
    ]
    const result = splitQueryRows(rows, matcher)
    expect(result.brand.clicks).toBe(5)
    expect(result.brand.impressions).toBe(15)
    expect(result.brand.distinct_queries).toBe(1)
    expect(result.ambiguous.clicks).toBe(1)
    expect(result.ambiguous.impressions).toBe(4)
    expect(result.non_brand.clicks).toBe(0)
    expect(result.non_brand.impressions).toBe(2)
  })

  it('computes impression-weighted position', () => {
    const rows: QueryRow[] = [
      { query: 'cts tours', clicks: 0, impressions: 10, position: 1 },
      { query: 'cts tours', clicks: 0, impressions: 30, position: 5 },
    ]
    const result = splitQueryRows(rows, matcher)
    expect(result.brand.position).toBeCloseTo((1 * 10 + 5 * 30) / 40, 10)
  })

  it('gives null position for a zero-impression bucket', () => {
    const rows: QueryRow[] = [
      { query: 'cts tours', clicks: 1, impressions: 0, position: 3 },
    ]
    const result = splitQueryRows(rows, matcher)
    expect(result.brand.impressions).toBe(0)
    expect(result.brand.position).toBeNull()
  })

  it('counts distinct normalised queries', () => {
    const rows: QueryRow[] = [
      { query: 'CTS Tours', clicks: 0, impressions: 1, position: 1 },
      { query: 'cts tours', clicks: 0, impressions: 1, position: 1 },
      { query: 'cts  tours', clicks: 0, impressions: 1, position: 1 },
    ]
    const result = splitQueryRows(rows, matcher)
    expect(result.brand.distinct_queries).toBe(1)
  })

  it('flags suspect missed brand queries', () => {
    const rows: QueryRow[] = [
      { query: 'ctstours co nz', clicks: 2, impressions: 20, position: 1 },
      { query: 'cts tours', clicks: 1, impressions: 10, position: 1 },
    ]
    const result = splitQueryRows(rows, matcher)
    const queries = result.suspect_missed_brand.map((s) => s.query)
    expect(queries).toContain('ctstours co nz')
    expect(queries).not.toContain('cts tours')
  })

  it('de-duplicates suspect queries across rows', () => {
    const rows: QueryRow[] = [
      { query: 'ctstours co nz', clicks: 1, impressions: 5, position: 1 },
      { query: 'ctstours co nz', clicks: 2, impressions: 7, position: 1 },
    ]
    const result = splitQueryRows(rows, matcher)
    expect(result.suspect_missed_brand).toHaveLength(1)
    expect(result.suspect_missed_brand[0].clicks).toBe(3)
    expect(result.suspect_missed_brand[0].impressions).toBe(12)
  })

  it('sorts suspects by impressions desc then query asc', () => {
    const rows: QueryRow[] = [
      { query: 'ctstours b', clicks: 0, impressions: 5, position: 1 },
      { query: 'ctstours a', clicks: 0, impressions: 5, position: 1 },
      { query: 'ctstours c', clicks: 0, impressions: 9, position: 1 },
    ]
    const result = splitQueryRows(rows, matcher)
    expect(result.suspect_missed_brand.map((s) => s.query)).toEqual([
      'ctstours c',
      'ctstours a',
      'ctstours b',
    ])
  })

  it('limits suspects to suspectLimit', () => {
    const rows: QueryRow[] = [
      { query: 'ctstours a', clicks: 0, impressions: 1, position: 1 },
      { query: 'ctstours b', clicks: 0, impressions: 2, position: 1 },
      { query: 'ctstours c', clicks: 0, impressions: 3, position: 1 },
    ]
    const result = splitQueryRows(rows, matcher, 2)
    expect(result.suspect_missed_brand).toHaveLength(2)
    expect(result.suspect_missed_brand.map((s) => s.query)).toEqual([
      'ctstours c',
      'ctstours b',
    ])
  })

  it('does not flag short brand terms', () => {
    const m = matcherOf(['ab'])
    const rows: QueryRow[] = [
      { query: 'abtours', clicks: 0, impressions: 1, position: 1 },
    ]
    const result = splitQueryRows(rows, m)
    expect(result.suspect_missed_brand).toEqual([])
  })
})
