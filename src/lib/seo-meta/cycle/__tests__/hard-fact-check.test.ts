import { describe, expect, it } from 'vitest'
import { checkHardFactsPreserved } from '../hard-fact-check'

describe('checkHardFactsPreserved — regex-only fact preservation, no AI involved', () => {
  it('🔴 real 2026-09-23 incident shape (CTS /china-tours): dropping the departure city, price, date and accreditation is caught', () => {
    const result = checkHardFactsPreserved(
      'China Tours from New Zealand | CTS',
      'Auckland & Christchurch departures, from $6,188pp, 22 Dec 2026. TAANZ accredited, backed by our 1928 parent company.',
      'China Tours from Auckland | CTS',
      'Discover authentic China tours with expert local guides. Book your trip with CTS today.',
    )
    expect(result.consistent).toBe(false)
    expect(result.droppedFacts).toEqual(expect.arrayContaining(['$6,188', '22 Dec 2026', 'TAANZ', 'Christchurch', 'New Zealand']))
  })

  it('a reword that keeps every price/date/place/acronym is not flagged', () => {
    const result = checkHardFactsPreserved(
      'Leshan Giant Buddha Day Trip Guide',
      'Everything you need to know about visiting the Leshan Giant Buddha near Chengdu.',
      'Leshan Giant Buddha Day Trip: Complete 2026 Guide',
      'Plan your Leshan Giant Buddha visit near Chengdu with this complete guide.',
    )
    expect(result.consistent).toBe(true)
    expect(result.droppedFacts).toEqual([])
  })

  it('formatting differences alone ($6,188 vs $6188, different comma/spacing) are NOT treated as a drop', () => {
    const result = checkHardFactsPreserved(
      'Auckland City Tour',
      'Book now for $6,188 per person.',
      'Auckland City Tour — Best Value',
      'Book now for $6188 per person.',
    )
    expect(result.consistent).toBe(true)
  })

  it('a dropped price alone (no date/place change) is enough to fail', () => {
    const result = checkHardFactsPreserved(
      'Auckland City Tour — $199pp',
      'Half-day guided tour of Auckland city centre.',
      'Auckland City Tour',
      'Half-day guided tour of Auckland city centre.',
    )
    expect(result.consistent).toBe(false)
    expect(result.droppedFacts).toContain('$199')
  })

  it('a dropped departure/coverage city alone (the exact china-tours failure mode) is enough to fail, even with no price or date involved', () => {
    const result = checkHardFactsPreserved(
      'Wellington & Queenstown Adventure Tour',
      'Visit Wellington and Queenstown on this two-day adventure.',
      'Wellington Adventure Tour',
      'Visit Wellington on this two-day adventure.',
    )
    expect(result.consistent).toBe(false)
    expect(result.droppedFacts).toContain('Queenstown')
  })

  it('🔴 魏征 复审 2026-09-23: catches the same narrowing incident when the original says "NZ" instead of "New Zealand" (short form, not in the full-name list)', () => {
    const result = checkHardFactsPreserved(
      'China Tours across NZ | CTS',
      'Departures from multiple NZ cities.',
      'China Tours from Auckland | CTS',
      'Departures from Auckland.',
    )
    expect(result.consistent).toBe(false)
    expect(result.droppedFacts).toContain('NZ')
  })

  it('"NZ"/"AU" abbreviation matching does not false-positive inside a lowercase domain or a longer word (ctstours.co.nz, AUCKLAND)', () => {
    const result = checkHardFactsPreserved(
      'Auckland City Tour — ctstours.co.nz',
      'Book now.',
      'Auckland City Tour: New Edition — ctstours.co.nz',
      'Book now, updated for 2026.',
    )
    expect(result.consistent).toBe(true)
  })

  it('common short acronyms (SEO, UK, AI) never trigger a false positive on their own', () => {
    const result = checkHardFactsPreserved(
      'SEO Tips for Small Business',
      'Written for readers in the UK using AI-assisted research.',
      'SEO Tips for Small Business Owners',
      'A practical guide using AI-assisted research.',
    )
    expect(result.consistent).toBe(true)
  })
})

describe('checkHardFactsPreserved — reverse direction: new facts introduced', () => {
  it('🔴 BLOCKER test: "Guided tours" → "from $3,990" — a price the original never stated is caught', () => {
    const result = checkHardFactsPreserved(
      'Guided Tours of China',
      'Explore China with expert guides.',
      'Guided Tours of China from $3,990',
      'Explore China with expert guides.',
    )
    expect(result.consistent).toBe(false)
    expect(result.addedFacts).toContain('$3,990')
    expect(result.droppedFacts).toEqual([])
  })

  it('🔴 BLOCKER test: "from Auckland" → "Auckland & Wellington" — Wellington was not in the original', () => {
    const result = checkHardFactsPreserved(
      'China Tours from Auckland',
      'Depart from Auckland.',
      'China Tours from Auckland & Wellington',
      'Depart from Auckland & Wellington.',
    )
    expect(result.consistent).toBe(false)
    expect(result.addedFacts).toContain('Wellington')
    expect(result.droppedFacts).toEqual([])
  })

  it('🔴 BLOCKER test: "from New Zealand" → "from Auckland, New Zealand" — Auckland is added', () => {
    const result = checkHardFactsPreserved(
      'China Tours from New Zealand',
      'Tours departing from New Zealand.',
      'China Tours from Auckland, New Zealand',
      'Tours departing from Auckland, New Zealand.',
    )
    expect(result.consistent).toBe(false)
    expect(result.addedFacts).toContain('Auckland')
  })

  it('reason string distinguishes "dropped" from "added" facts', () => {
    const result = checkHardFactsPreserved(
      'Auckland City Tour — $199',
      'From Christchurch.',
      'Wellington City Tour — $299',
      'From Hamilton.',
    )
    expect(result.consistent).toBe(false)
    expect(result.reason).toContain('drops fact(s) from the original')
    expect(result.reason).toContain('introduces fact(s) not in the original')
    expect(result.droppedFacts.length).toBeGreaterThan(0)
    expect(result.addedFacts.length).toBeGreaterThan(0)
  })

  it('🔴 BLOCKER test: competitor price copied into CTS title — AI sees "$2,999" in a competitor SERP title and puts it in CTS new title', () => {
    const result = checkHardFactsPreserved(
      'China Tours from New Zealand 2026-27 | CTS Tours',
      'Featured China tours from NZ. Backed by CTS — global travel brand founded in 1928. TAANZ-bonded.',
      'China Tours from $2,999 — NZ Deals | CTS Tours',
      'Featured China tours from NZ. Backed by CTS — global travel brand founded in 1928. TAANZ-bonded.',
    )
    expect(result.consistent).toBe(false)
    expect(result.addedFacts).toContain('$2,999')
  })

  it('🔴 BLOCKER mutation: if reverse check is removed (addedFacts always []), competitor price slips through', () => {
    const result = checkHardFactsPreserved(
      'Auckland City Tour',
      'Half-day guided tour of Auckland.',
      'Auckland City Tour from $499',
      'Half-day guided tour of Auckland.',
    )
    expect(result.consistent).toBe(false)
    expect(result.addedFacts).toContain('$499')
    expect(result.addedFacts.length).toBeGreaterThan(0)
  })

  it('a rewrite that keeps every fact returns addedFacts: []', () => {
    const result = checkHardFactsPreserved(
      'Auckland City Tour — $199',
      'Half-day guided tour.',
      'Auckland City Tour: Best Value — $199',
      'Half-day guided tour of Auckland.',
    )
    expect(result.consistent).toBe(true)
    expect(result.addedFacts).toEqual([])
    expect(result.droppedFacts).toEqual([])
  })
})

describe('checkHardFactsPreserved — format normalization', () => {
  it('place name comparison is case-insensitive (e.g. "auckland" matches "Auckland")', () => {
    const result = checkHardFactsPreserved(
      'Tours from AUCKLAND',
      'Depart from auckland city.',
      'Tours from Auckland',
      'Depart from Auckland city.',
    )
    expect(result.consistent).toBe(true)
  })

  it('full-width dollar sign ＄ is normalized to half-width $', () => {
    const result = checkHardFactsPreserved(
      'Tour — ＄199',
      'Book now.',
      'Tour — $199',
      'Book now.',
    )
    expect(result.consistent).toBe(true)
  })

  it('DD/MM/YYYY date format is detected', () => {
    const result = checkHardFactsPreserved(
      'Tour starts 22/12/2026',
      'Book early.',
      'Tour starts soon',
      'Book early.',
    )
    expect(result.consistent).toBe(false)
    expect(result.droppedFacts).toContain('22/12/2026')
  })

  it('month-day without year is detected (e.g. "December 22")', () => {
    const result = checkHardFactsPreserved(
      'Tour starts December 22',
      'Book early.',
      'Tour starts soon',
      'Book early.',
    )
    expect(result.consistent).toBe(false)
    expect(result.droppedFacts).toContain('December 22')
  })

  it('"Dec 22" without a year is also detected', () => {
    const result = checkHardFactsPreserved(
      'Available from Dec 22',
      'Limited spots.',
      'Available soon',
      'Limited spots.',
    )
    expect(result.consistent).toBe(false)
    expect(result.droppedFacts).toContain('Dec 22')
  })

  it('"22 Dec 2026" still works (existing format, not broken by new patterns)', () => {
    const result = checkHardFactsPreserved(
      'Tour on 22 Dec 2026',
      'Book now.',
      'Tour coming soon',
      'Book now.',
    )
    expect(result.consistent).toBe(false)
    expect(result.droppedFacts).toContain('22 Dec 2026')
  })
})

describe('checkHardFactsPreserved — DR48-1: multi-currency, promotions, quantities', () => {
  it('catches €2,999 added by rewrite', () => {
    const result = checkHardFactsPreserved(
      'China Tours', 'Explore China.',
      'China Tours from €2,999', 'Explore China.',
    )
    expect(result.consistent).toBe(false)
    expect(result.addedFacts).toEqual(expect.arrayContaining(['€2,999']))
  })

  it('catches ¥19,999 added by rewrite', () => {
    const result = checkHardFactsPreserved(
      'China Tours', 'Explore China.',
      'China Tours — ¥19,999', 'Explore China.',
    )
    expect(result.consistent).toBe(false)
    expect(result.addedFacts).toEqual(expect.arrayContaining(['¥19,999']))
  })

  it('catches "3,990 dollars" (currency word) added by rewrite', () => {
    const result = checkHardFactsPreserved(
      'China Tours', 'Explore China.',
      'China Tours', 'Explore China from 3,990 dollars.',
    )
    expect(result.consistent).toBe(false)
  })

  it('catches bare "from 3990" (no currency symbol, ≥3 digits)', () => {
    const result = checkHardFactsPreserved(
      'China Tours', 'Explore China.',
      'China Tours from 3990', 'Explore China.',
    )
    expect(result.consistent).toBe(false)
  })

  it('catches "save 20%" promotion added by rewrite', () => {
    const result = checkHardFactsPreserved(
      'China Tours — Best Value', 'Explore China.',
      'China Tours — save 20%', 'Explore China.',
    )
    expect(result.consistent).toBe(false)
  })

  it('catches "2-for-1" promotion added by rewrite', () => {
    const result = checkHardFactsPreserved(
      'China Tours', 'Explore China.',
      'China Tours — 2-for-1 Deal', 'Explore China.',
    )
    expect(result.consistent).toBe(false)
  })

  it('catches "14 days" quantity added by rewrite', () => {
    const result = checkHardFactsPreserved(
      'China Discovery Tour', 'Explore China.',
      'China Discovery Tour in 14 days', 'Explore China.',
    )
    expect(result.consistent).toBe(false)
  })

  it('catches "12-day" quantity added by rewrite', () => {
    const result = checkHardFactsPreserved(
      'China Discovery Tour', 'Explore China.',
      '12-day China Discovery Tour', 'Explore China.',
    )
    expect(result.consistent).toBe(false)
  })

  it('NZD currency code is detected: "NZD 2999" added', () => {
    const result = checkHardFactsPreserved(
      'China Tours', 'Explore China.',
      'China Tours', 'Explore China. NZD 2999 per person.',
    )
    expect(result.consistent).toBe(false)
  })

  it('price format equivalence: $3,990 = NZD 3990 = 3990 dollars', () => {
    const result = checkHardFactsPreserved(
      'Tour — $3,990', 'Book now.',
      'Tour — NZD 3990', 'Book now.',
    )
    expect(result.consistent).toBe(true)
  })
})

describe('checkHardFactsPreserved — DR48-2: departure points and place aliases', () => {
  it('catches "from Beijing" departure point added by rewrite', () => {
    const result = checkHardFactsPreserved(
      'China Icons Tour', 'Visit the highlights.',
      'China Icons Tour from Beijing', 'Visit the highlights.',
    )
    expect(result.consistent).toBe(false)
  })

  it('"Shanghai departures" triggers departure detection', () => {
    const result = checkHardFactsPreserved(
      'China Tour — Daily Departures', 'Book now.',
      'China Tour — Shanghai Departures', 'Book now.',
    )
    expect(result.consistent).toBe(false)
  })

  it('"New Zealand" ↔ "NZ" does NOT false-flag as drop+add (W48b-5 fix)', () => {
    const result = checkHardFactsPreserved(
      'China Tours from New Zealand', 'Departures from New Zealand.',
      'China Tours from NZ', 'Departures from NZ.',
    )
    expect(result.consistent).toBe(true)
  })

  it('"Australia" ↔ "AU" does NOT false-flag', () => {
    const result = checkHardFactsPreserved(
      'Tours from Australia', 'Departures from Australia.',
      'Tours from AU', 'Departures from AU.',
    )
    expect(result.consistent).toBe(true)
  })

  it('"Christchurch" ↔ "ChCh" does NOT false-flag', () => {
    const result = checkHardFactsPreserved(
      'Tours from Christchurch', 'Depart Christchurch.',
      'Tours from ChCh', 'Depart ChCh.',
    )
    expect(result.consistent).toBe(true)
  })
})

describe('checkHardFactsPreserved — DR48-4: expanded date formats', () => {
  it('catches ISO date 2026-12-22 dropped by rewrite', () => {
    const result = checkHardFactsPreserved(
      'Tour departing 2026-12-22', 'Book now.',
      'Tour departing soon', 'Book now.',
    )
    expect(result.consistent).toBe(false)
    expect(result.droppedFacts).toContain('2026-12-22')
  })

  it('catches "22 Dec" (day-first, no year) dropped by rewrite', () => {
    const result = checkHardFactsPreserved(
      'Tour departing 22 Dec', 'Book now.',
      'Tour departing soon', 'Book now.',
    )
    expect(result.consistent).toBe(false)
  })

  it('catches "Dec 22nd" (ordinal) dropped by rewrite', () => {
    const result = checkHardFactsPreserved(
      'Available Dec 22nd', 'Limited spots.',
      'Available soon', 'Limited spots.',
    )
    expect(result.consistent).toBe(false)
  })

  it('catches "22nd December" (ordinal + full month, day-first) dropped', () => {
    const result = checkHardFactsPreserved(
      'Tour on 22nd December', 'Book now.',
      'Tour coming soon', 'Book now.',
    )
    expect(result.consistent).toBe(false)
  })

  it('"December 22" and "Dec 22" normalize to the same (no false flag)', () => {
    const result = checkHardFactsPreserved(
      'Available December 22', 'Book early.',
      'Available Dec 22', 'Book early.',
    )
    expect(result.consistent).toBe(true)
  })

  it('ordinal "22nd Dec 2026" matches "22 Dec 2026" (no false flag)', () => {
    const result = checkHardFactsPreserved(
      'Tour on 22nd Dec 2026', 'Book now.',
      'Tour on 22 Dec 2026', 'Book now.',
    )
    expect(result.consistent).toBe(true)
  })
})
