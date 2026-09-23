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
