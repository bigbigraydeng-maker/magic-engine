import { describe, it, expect } from 'vitest'
import { flattenEnquiryTerms } from '../travel-enquiry-terms'

describe('flattenEnquiryTerms', () => {
  it('returns lowercase terms covering asking-about-price and money-already-changed-hands', () => {
    const terms = flattenEnquiryTerms()
    for (const t of ['quote', 'how much', 'itinerary', 'availability', 'paid', 'payment', 'deposit', 'receipt', '报价', '定金']) {
      expect(terms).toContain(t)
    }
    expect(terms.every((t) => t === t.toLowerCase())).toBe(true)
  })

  it('deliberately omits generic words that vendor pitches are full of', () => {
    const terms = flattenEnquiryTerms()
    for (const t of ['tour', 'book', 'depart', 'travelling', 'transfer']) {
      expect(terms).not.toContain(t)
    }
  })
})
