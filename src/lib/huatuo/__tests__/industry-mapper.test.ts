import { describe, it, expect } from 'vitest'
import {
  INDUSTRY_DICTIONARY,
  mapIndustryToCategory,
  categoryToChineseName,
} from '../industry-mapper'

/**
 * These categories are the aggregation keys the baseline cron writes into
 * industry_benchmarks.industry_category (see
 * src/app/api/cron/baseline-domains-monthly/route.ts step 4). If a value lives
 * in baseline_domains.industry but not in this dictionary, the cron produces
 * benchmark rows that no reader ever queries — the exact silent failure
 * migration 20260728000002 repairs.
 */
const BASELINE_DOMAIN_INDUSTRIES = [
  'tourism_operator',
  'building_supplies',
  'real_estate_agency',
  'logistics_3pl',
]

describe('INDUSTRY_DICTIONARY ↔ baseline_domains alignment', () => {
  it('covers every industry code seeded into baseline_domains', () => {
    const categories = INDUSTRY_DICTIONARY.map(e => e.category)
    for (const industry of BASELINE_DOMAIN_INDUSTRIES) {
      expect(categories).toContain(industry)
    }
  })

  it('gives every category a human label (no raw slug leaks into the 华佗 prompt)', () => {
    for (const { category } of INDUSTRY_DICTIONARY) {
      expect(categoryToChineseName(category)).not.toBe(category)
    }
  })

  it('has no duplicate categories', () => {
    const categories = INDUSTRY_DICTIONARY.map(e => e.category)
    expect(new Set(categories).size).toBe(categories.length)
  })
})

describe('mapIndustryToCategory — logistics_3pl', () => {
  it.each([
    [['物流', '仓储'], 'logistics_3pl'],
    [['3PL'], 'logistics_3pl'],
    [['ecommerce fulfilment', 'warehousing'], 'logistics_3pl'],
    [['Third Party Logistics'], 'logistics_3pl'],
    [['freight', 'supply chain'], 'logistics_3pl'],
  ])('maps %j → %s', (tags, expected) => {
    expect(mapIndustryToCategory(tags as string[])).toBe(expected)
  })

  it('does not steal clients from existing categories', () => {
    expect(mapIndustryToCategory(['旅游', '旅行社'])).toBe('tourism_operator')
    expect(mapIndustryToCategory(['地板', '瓷砖'])).toBe('building_supplies')
    expect(mapIndustryToCategory(['房地产', '中介'])).toBe('real_estate_agency')
  })

  /**
   * Known limitation, documented rather than hidden: mapIndustryToCategory
   * picks the highest keyword-hit count and breaks ties by dictionary order.
   * A lone "ecommerce fulfilment" scores 1 for ecommerce_d2c ("ecommerce") and
   * 1 for logistics_3pl ("fulfilment"), so the earlier entry wins. A real 3PL
   * description carries more than one logistics term and resolves correctly —
   * the case above proves it. Flagged for NewAsian onboarding: its
   * clients.industry text must include a second logistics term.
   */
  it('ties on a single ambiguous phrase, resolved by dictionary order', () => {
    expect(mapIndustryToCategory(['ecommerce fulfilment'])).toBe('ecommerce_d2c')
  })

  it('still returns null for genuinely unmatched input', () => {
    expect(mapIndustryToCategory(['养蜂'])).toBeNull()
    expect(mapIndustryToCategory([])).toBeNull()
  })
})
