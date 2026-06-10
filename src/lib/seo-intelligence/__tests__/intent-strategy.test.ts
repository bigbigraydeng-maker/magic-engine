import { describe, expect, it } from 'vitest'
import {
  buildBrandTrafficSplit,
  estimateKeywordTraffic,
  isBrandedKeyword,
  isBrandedKeywordWithAliases,
  prioritizeContentKeywords,
  sortByIntentPriority,
  type IntentKeyword,
} from '../intent-strategy'

function keyword(
  keywordText: string,
  intent: string,
  overrides: Partial<IntentKeyword> = {},
): IntentKeyword {
  return {
    keyword: keywordText,
    intent,
    position: 5,
    search_volume: 100,
    keyword_difficulty: 30,
    ...overrides,
  }
}

describe('intent strategy helpers', () => {
  it('detects branded keywords by token match', () => {
    expect(isBrandedKeyword('cts tours new zealand', 'cts')).toBe(true)
    expect(isBrandedKeyword('best tours in new zealand', 'cts')).toBe(false)
    expect(isBrandedKeyword('oz top flooring', 'oztop')).toBe(false)
  })

  it('estimates traffic from position and volume', () => {
    expect(estimateKeywordTraffic(keyword('top tour', 'transactional', {
      position: 1,
      search_volume: 1000,
    }))).toBe(280)
    expect(estimateKeywordTraffic(keyword('deep tour', 'commercial', {
      position: 30,
      search_volume: 1000,
    }))).toBe(4)
  })

  it('splits estimated traffic into branded and non-branded buckets', () => {
    // Note: brandRoot 'cts' alone is now too short to pass the auto-derived
    // length-5 guard (2026-06-11 P0 fix), so we pass it via the alias array
    // — this mirrors how FDE configures multi-word / short brands in
    // clients.brand_aliases.
    const split = buildBrandTrafficSplit([
      keyword('cts tours', 'navigational', { position: 1, search_volume: 1000 }),
      keyword('new zealand private tours', 'transactional', { position: 2, search_volume: 1000 }),
    ], 'cts', ['cts'])

    expect(split.branded).toMatchObject({
      keywords: 1,
      estimated_traffic: 280,
      search_volume: 1000,
      share: 65,
    })
    expect(split.non_branded).toMatchObject({
      keywords: 1,
      estimated_traffic: 150,
      search_volume: 1000,
      share: 35,
    })
  })

  it('prioritizes non-branded transactional and commercial keywords for content', () => {
    // Same note as above: short brandRoot 'cts' needs alias support to count
    // as branded under the post-2026-06-11 substring matcher.
    const priorities = prioritizeContentKeywords([
      keyword('cts tours', 'transactional', { search_volume: 900 }),
      keyword('what to pack nz', 'informational', { search_volume: 1000 }),
      keyword('nz private tour package', 'transactional', { search_volume: 400 }),
      keyword('new zealand tour company', 'commercial', { search_volume: 700 }),
    ], 'cts', 8, ['cts'])

    expect(priorities.map(item => item.keyword)).toEqual([
      'nz private tour package',
      'new zealand tour company',
      'what to pack nz',
    ])
  })

  it('sorts ranking rows by transactional intent before volume and position', () => {
    const sorted = sortByIntentPriority([
      keyword('high volume guide', 'informational', { search_volume: 2000, position: 1 }),
      keyword('buy nz tour', 'transactional', { search_volume: 100, position: 8 }),
      keyword('compare tour companies', 'commercial', { search_volume: 500, position: 4 }),
    ], 'cts')

    expect(sorted.map(item => item.keyword)).toEqual([
      'buy nz tour',
      'compare tour companies',
      'high volume guide',
    ])
  })
})

describe('isBrandedKeywordWithAliases — substring + brand_aliases (2026-06-11 P0 fix)', () => {
  // Real CTS Tours NZ sample. Domain root = "ctstours", aliases configured
  // as ['cts tours', 'cts', 'cts travel', 'china travel service', 'ctsnz'].
  const CTS_ROOT = 'ctstours'
  const CTS_ALIASES = ['cts tours', 'cts', 'cts travel', 'china travel service', 'ctsnz']

  it('matches multi-word brand via alias substring (the bug)', () => {
    expect(isBrandedKeywordWithAliases('cts tours auckland', CTS_ROOT, CTS_ALIASES)).toBe(true)
    expect(isBrandedKeywordWithAliases('cts travel nz', CTS_ROOT, CTS_ALIASES)).toBe(true)
    expect(isBrandedKeywordWithAliases('china travel service review', CTS_ROOT, CTS_ALIASES)).toBe(true)
  })

  it('matches compound domain-root spelling via brandRoot substring', () => {
    expect(isBrandedKeywordWithAliases('ctstours review', CTS_ROOT, CTS_ALIASES)).toBe(true)
    expect(isBrandedKeywordWithAliases('ctstoursnz', CTS_ROOT, CTS_ALIASES)).toBe(true)
  })

  it('matches single-word alias as substring (legacy CTS spelling)', () => {
    // "cts" alias hits "cts queenstown tour" — by design, FDE-configured alias
    // is trusted (the alias array is the contract; if "cts" is too short FDE
    // removes it).
    expect(isBrandedKeywordWithAliases('cts queenstown tour', CTS_ROOT, CTS_ALIASES)).toBe(true)
  })

  it('returns false for unrelated keywords', () => {
    expect(isBrandedKeywordWithAliases('new zealand private tours', CTS_ROOT, CTS_ALIASES)).toBe(false)
    expect(isBrandedKeywordWithAliases('best tours in new zealand', CTS_ROOT, CTS_ALIASES)).toBe(false)
    expect(isBrandedKeywordWithAliases('queenstown ski package', CTS_ROOT, CTS_ALIASES)).toBe(false)
  })

  it('falls back to brandRoot when aliases are missing/empty', () => {
    expect(isBrandedKeywordWithAliases('ctstours review', CTS_ROOT, null)).toBe(true)
    expect(isBrandedKeywordWithAliases('ctstours review', CTS_ROOT, [])).toBe(true)
    expect(isBrandedKeywordWithAliases('cts tours auckland', CTS_ROOT, null)).toBe(false)
    // Without aliases, the multi-word query "cts tours" cannot contain the
    // compound root "ctstours" as a substring → MISS. This is why aliases
    // exist.
  })

  it('returns false when both brandRoot and aliases are missing', () => {
    expect(isBrandedKeywordWithAliases('cts tours', null, null)).toBe(false)
    expect(isBrandedKeywordWithAliases('cts tours', '', [])).toBe(false)
  })

  it('guards against trivially short aliases (<2 chars)', () => {
    expect(isBrandedKeywordWithAliases('ai tools', null, ['a'])).toBe(false)
    expect(isBrandedKeywordWithAliases('ai tools', null, ['ai'])).toBe(true)
  })

  it('applies a stricter min-length (5) to auto-derived brandRoot', () => {
    // Why this matters: brandRoot is auto-derived from clients.domain. A
    // generic root like "tours" (length 5) is exactly on the boundary, but
    // shorter roots like "tour", "care", "shop", "cts" would substring-match
    // every related query if we used the same 2-char gate as aliases.
    // Generic short roots → blocked:
    expect(isBrandedKeywordWithAliases('new zealand tours',  'cts',  null)).toBe(false) // 'cts' < 5
    expect(isBrandedKeywordWithAliases('best tour packages', 'tour', null)).toBe(false) // 'tour' < 5
    expect(isBrandedKeywordWithAliases('skincare brands',    'care', null)).toBe(false) // 'care' < 5
    // Long enough roots → allowed:
    expect(isBrandedKeywordWithAliases('ctstours auckland', 'ctstours', null)).toBe(true) // 'ctstours' = 8
    expect(isBrandedKeywordWithAliases('oztop building',    'oztop',    null)).toBe(true) // 'oztop' = 5
    // FDE can override length restriction by configuring explicit aliases:
    expect(isBrandedKeywordWithAliases('new zealand tours', 'tour', ['cts tours'])).toBe(false)
    expect(isBrandedKeywordWithAliases('cts tours nz',      'tour', ['cts tours'])).toBe(true)
  })

  it('is case-insensitive and collapses whitespace', () => {
    expect(isBrandedKeywordWithAliases('CTS Tours', CTS_ROOT, CTS_ALIASES)).toBe(true)
    expect(isBrandedKeywordWithAliases('cts    tours', CTS_ROOT, CTS_ALIASES)).toBe(true)
  })

  it('reproduces the CTS bug: token-equality vs substring on realistic mix', () => {
    // GSC top_queries sample roughly matching CTS Tours NZ 28-day reality:
    // 149 brand clicks out of 630 total ≈ 24% — we don't reproduce the click
    // proportions here, just that the *count* of branded queries jumps from
    // (almost) zero with the old token-equality logic to several with the
    // alias-aware substring matcher.
    const sampleQueries = [
      'cts tours',
      'cts tours auckland',
      'cts travel nz',
      'ctstours.co.nz',
      'china travel service',
      'cts queenstown',
      'new zealand private tour',
      'queenstown ski resort',
      'best nz holiday packages',
      'self drive nz',
    ]

    const oldHits = sampleQueries.filter(q => isBrandedKeyword(q, CTS_ROOT)).length
    const newHits = sampleQueries.filter(q => isBrandedKeywordWithAliases(q, CTS_ROOT, CTS_ALIASES)).length

    // Old behaviour: token equality of "cts tours auckland" against "ctstours"
    // — every token mismatches → 0 (or 1 if a query literally is "ctstours").
    expect(oldHits).toBeLessThanOrEqual(1)
    // New behaviour: at least 6 of the 10 are branded.
    expect(newHits).toBeGreaterThanOrEqual(6)
  })
})

describe('buildBrandTrafficSplit — alias-aware (2026-06-11 P0 fix)', () => {
  it('uses brandAliases to surface branded traffic that token equality would miss', () => {
    const split = buildBrandTrafficSplit(
      [
        // Branded by alias — would be missed by old token-equality with brandRoot='ctstours'
        keyword('cts tours', 'navigational', { position: 1, search_volume: 1000 }),
        keyword('cts travel nz', 'navigational', { position: 1, search_volume: 500 }),
        // Non-branded
        keyword('new zealand private tours', 'transactional', { position: 2, search_volume: 1000 }),
      ],
      'ctstours',
      ['cts tours', 'cts travel'],
    )

    expect(split.branded.keywords).toBe(2)
    expect(split.non_branded.keywords).toBe(1)
    // Branded traffic = 1000*0.28 + 500*0.28 = 420; Non-branded = 1000*0.15 = 150.
    expect(split.branded.estimated_traffic).toBe(420)
    expect(split.non_branded.estimated_traffic).toBe(150)
    // Share = 420 / 570 ≈ 74%
    expect(split.branded.share).toBe(74)
    expect(split.non_branded.share).toBe(26)
  })

  it('with no aliases falls back to brandRoot substring (compound spellings only)', () => {
    const split = buildBrandTrafficSplit(
      [
        keyword('ctstours review', 'navigational', { position: 1, search_volume: 1000 }),
        keyword('cts tours auckland', 'navigational', { position: 1, search_volume: 1000 }),
      ],
      'ctstours',
      null,
    )
    // Only the first matches (substring of brandRoot in query); second misses
    // because "ctstours" is not a substring of "cts tours auckland".
    expect(split.branded.keywords).toBe(1)
    expect(split.non_branded.keywords).toBe(1)
  })
})

describe('prioritizeContentKeywords — alias-aware (2026-06-11 P0 fix)', () => {
  it('excludes alias-matched branded keywords from content priorities', () => {
    const priorities = prioritizeContentKeywords(
      [
        keyword('cts tours auckland',     'transactional', { search_volume: 900 }),
        keyword('china travel service',   'transactional', { search_volume: 800 }),
        keyword('what to pack nz',        'informational', { search_volume: 1000 }),
        keyword('new zealand tour company', 'commercial',  { search_volume: 700 }),
      ],
      'ctstours',
      5,
      ['cts tours', 'china travel service'],
    )

    expect(priorities.map(p => p.keyword)).toEqual([
      'new zealand tour company',
      'what to pack nz',
    ])
  })
})
