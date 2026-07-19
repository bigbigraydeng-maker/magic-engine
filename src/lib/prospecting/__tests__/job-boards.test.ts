import { describe, it, expect, afterEach } from 'vitest'
import {
  isAgencyOrRecruiter, classifySeniority, tagIcpBuckets,
  jobKeywordPool, DEFAULT_JOB_KEYWORDS,
} from '../job-boards/filters'
import { normaliseLocationToSeedKey, deriveIndustrySlug, JOB_SIGNAL_INDUSTRY_FALLBACK } from '../job-boards/locations'
import { nameMatchStrength } from '../job-boards/resolve'

// ── Noise filter — agencies/recruiters out, real end-employers in ─────────────
describe('isAgencyOrRecruiter', () => {
  it('drops recruiters and marketing/digital agencies by name (real Seek samples)', () => {
    for (const c of ['Tribe Recruitment', 'Campfire Digital Recruitment', 'Calibrate Marketing',
                     'Spang Digital', 'Gather Creative Recruitment', 'Burst Digital']) {
      expect(isAgencyOrRecruiter(c, null)).toBe(true)
    }
  })

  it('keeps real end-employers whose names merely contain a fragment', () => {
    // "Markwell" must NOT trip \bmarketing\b; these are all genuine prospects.
    // "Construction Cost Consultants" must NOT be dropped — bare "consult" was
    // removed after it false-dropped this real end-employer on a live run.
    for (const c of ['Downlow Burgers', '3 Wise Men', 'Markwell Foods', 'Hills Hats Limited',
                     'Rangiora Vet centre', 'Plumbing World', 'KIWI NZ VENTURE LIMITED',
                     'Construction Cost Consultants']) {
      expect(isAgencyOrRecruiter(c, null)).toBe(false)
    }
  })

  it('catches recruiters whose names carry no agency keyword (exact list + personnel)', () => {
    for (const c of ['Positive People', 'Working In', 'EQ Consultants', 'PN Personnel']) {
      expect(isAgencyOrRecruiter(c, null)).toBe(true)
    }
  })

  it('drops by board classification even when the name looks clean', () => {
    expect(isAgencyOrRecruiter('Acme Foods', 'Advertising, Arts & Media')).toBe(true)
    expect(isAgencyOrRecruiter('Acme Foods', 'Marketing & Communications')).toBe(false)
  })
})

// ── Seniority split — junior = strong signal, senior = building in-house ───────
describe('classifySeniority', () => {
  it('junior wins ties (part-time coordinator beats the word "manager")', () => {
    expect(classifySeniority('Part-Time Digital Marketing & Content Manager')).toBe('junior')
    expect(classifySeniority('Digital Marketing Coordinator')).toBe('junior')
    expect(classifySeniority('Marketing Assistant')).toBe('junior')
  })
  it('flags senior leadership roles', () => {
    expect(classifySeniority('Marketing Manager')).toBe('senior')
    expect(classifySeniority('Head of Marketing')).toBe('senior')
  })
  it('defaults to mid when neither senior nor junior words appear', () => {
    expect(classifySeniority('Social Media Specialist')).toBe('mid')
  })
})

// ── ICP bucket tagging ────────────────────────────────────────────────────────
describe('tagIcpBuckets', () => {
  it('junior generalist small business = smb_local', () => {
    expect(tagIcpBuckets({ company: 'Downlow Burgers', seniority: 'junior', reviewCount: 40, industrySlug: 'restaurant' }))
      .toContain('smb_local')
  })
  it('large review count flags mid_large_budget', () => {
    expect(tagIcpBuckets({ company: 'Farmers', seniority: 'senior', reviewCount: 500, industrySlug: 'department_store' }))
      .toContain('mid_large_budget')
  })
  it('detects migrant/Chinese name hints and served verticals', () => {
    expect(tagIcpBuckets({ company: 'KIWI NZ VENTURE', seniority: 'mid', reviewCount: 10, industrySlug: 'travel_agency' }))
      .toEqual(expect.arrayContaining(['migrant_chinese', 'industry_vertical']))
  })
  it('never returns an empty array', () => {
    expect(tagIcpBuckets({ company: 'Acme', seniority: 'mid', reviewCount: null, industrySlug: 'x' }).length)
      .toBeGreaterThan(0)
  })
})

// ── Keyword pool (env override) ───────────────────────────────────────────────
describe('jobKeywordPool', () => {
  afterEach(() => { delete process.env.JOB_SIGNAL_KEYWORDS })
  it('excludes AI-visibility/GEO terms from the default pool', () => {
    const pool = jobKeywordPool()
    expect(pool).toEqual(DEFAULT_JOB_KEYWORDS)
    expect(pool.some(k => /ai visibility|geo|generative/i.test(k))).toBe(false)
  })
  it('honours an env override and lowercases/trims it', () => {
    process.env.JOB_SIGNAL_KEYWORDS = ' Facebook Ads , SEO '
    expect(jobKeywordPool()).toEqual(['facebook ads', 'seo'])
  })
})

// ── B2: location → CITY_COORDS seed key ───────────────────────────────────────
describe('normaliseLocationToSeedKey', () => {
  it('maps Auckland suburbs to the right sub-area seed', () => {
    expect(normaliseLocationToSeedKey('Manurewa, Auckland')).toBe('south_auckland')
    expect(normaliseLocationToSeedKey('Takapuna, Auckland')).toBe('north_shore')
    expect(normaliseLocationToSeedKey('Auckland CBD, Auckland')).toBe('central_auckland')
    expect(normaliseLocationToSeedKey('Te Rapa, Waikato')).toBe('hamilton')
  })
  it('maps other regions to their metro seed', () => {
    expect(normaliseLocationToSeedKey('Lower Hutt, Wellington')).toBe('wellington')
    expect(normaliseLocationToSeedKey('Christchurch Central, Canterbury')).toBe('christchurch')
    expect(normaliseLocationToSeedKey('Mount Maunganui, Bay of Plenty')).toBe('tauranga')
    expect(normaliseLocationToSeedKey('Bell Block, Taranaki')).toBe('new_plymouth')
  })
  it('returns null for empty or unknown locations (no free text in the city column)', () => {
    expect(normaliseLocationToSeedKey('')).toBeNull()
    expect(normaliseLocationToSeedKey('Somewhere, Nowhere')).toBeNull()
  })
})

// ── B1: industry slug is never a raw generic Places type ──────────────────────
describe('deriveIndustrySlug', () => {
  it('picks the first meaningful Places type', () => {
    expect(deriveIndustrySlug(['restaurant', 'food', 'point_of_interest'])).toBe('restaurant')
    expect(deriveIndustrySlug(['clothing_store', 'store'])).toBe('clothing_store')
  })
  it('falls back to a readable slug when only generic types exist', () => {
    expect(deriveIndustrySlug(['point_of_interest', 'establishment'])).toBe(JOB_SIGNAL_INDUSTRY_FALLBACK)
    expect(deriveIndustrySlug([])).toBe(JOB_SIGNAL_INDUSTRY_FALLBACK)
    expect(deriveIndustrySlug(null)).toBe(JOB_SIGNAL_INDUSTRY_FALLBACK)
  })
})

// ── H2: resolution name-match guard (mismatch = accident, prefer miss) ─────────
describe('nameMatchStrength', () => {
  it('strong only when all distinctive tokens are present', () => {
    expect(nameMatchStrength('Downlow Burgers', 'Downlow Burgers Mount Wellington')).toBe('strong')
    expect(nameMatchStrength('3 Wise Men', '3 Wise Men NZ')).toBe('strong')
  })
  it('does not strong-match a vague name onto an unrelated business', () => {
    // "Kiwi NZ Venture" → distinctive [kiwi, venture]; "Kiwi Construction" shares
    // only "kiwi" → must NOT be a strong (auto-accept) match.
    expect(nameMatchStrength('Kiwi NZ Venture', 'Kiwi Construction')).not.toBe('strong')
    expect(nameMatchStrength('Downlow Burgers', 'Downlow Cafe')).not.toBe('strong')
    expect(nameMatchStrength('Wilson Parking', 'Auckland Transport')).toBe('none')
  })
})
