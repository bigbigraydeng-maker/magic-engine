import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
}))

import { analyzeCompetitorSite, parseSignals } from '../competitor-site-analyzer'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'

const mockFetch = vi.mocked(fetchUrlAsMarkdown)

beforeEach(() => vi.clearAllMocks())

const SAMPLE_MD = `
# Premium NZ Tours Direct from Auckland

## Our Most Popular Itineraries

- [Book China Tour](/book/china) — 14 days
- [Enquire about Japan](/enquire/japan)
- [Contact us](/contact)
- [Privacy](/privacy)
- [Terms](/terms)

Our services cover all of Asia.

## What we do

[Get a quote](/quote) for a custom plan.
[Subscribe](/news) for travel deals.

Some longer paragraph here with more than 300 words to bump up the word count.
`.repeat(3)

describe('parseSignals()', () => {
  it('extracts up to 3 USP candidates from H1/H2 headings', () => {
    const s = parseSignals('example.com', SAMPLE_MD)
    expect(s.usp_candidates.length).toBeGreaterThan(0)
    expect(s.usp_candidates.length).toBeLessThanOrEqual(3)
    expect(s.usp_candidates[0]).toContain('Premium NZ Tours')
  })

  it('counts CTA links by conversion verbs', () => {
    const s = parseSignals('example.com', SAMPLE_MD)
    // Book, Enquire, Contact, Get a quote, Subscribe → 5 CTA verbs per repetition (×3 = 15)
    expect(s.cta_count).toBeGreaterThanOrEqual(5)
    expect(s.cta_examples.length).toBeLessThanOrEqual(5)
  })

  it('ignores non-CTA links like Privacy / Terms', () => {
    const s = parseSignals('example.com', SAMPLE_MD)
    const lowered = s.cta_examples.map(e => e.toLowerCase())
    expect(lowered.some(e => e.includes('privacy'))).toBe(false)
    expect(lowered.some(e => e.includes('terms'))).toBe(false)
  })

  it('classifies landing_page_type=homepage for content-rich pages', () => {
    const s = parseSignals('example.com', SAMPLE_MD)
    expect(['homepage', 'service']).toContain(s.landing_page_type)
  })

  it('classifies landing_page_type=product when SKU/price markers present', () => {
    const md = '# Product\n\nIn stock — SKU 12345 — $99.99\nAdd to cart now'
    const s = parseSignals('example.com', md)
    expect(s.landing_page_type).toBe('product')
  })

  it('computes word_count and category_depth', () => {
    const s = parseSignals('example.com', SAMPLE_MD)
    expect(s.word_count).toBeGreaterThan(50)
    expect(s.category_depth).toBeGreaterThan(0)
  })

  it('always stamps fetched_at as ISO timestamp', () => {
    const s = parseSignals('example.com', SAMPLE_MD)
    expect(s.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('analyzeCompetitorSite()', () => {
  it('prepends https:// when missing', async () => {
    mockFetch.mockResolvedValue({ url: 'x', title: 't', markdown: '# Hello', chars: 7 })
    await analyzeCompetitorSite('example.com')
    expect(mockFetch).toHaveBeenCalledWith('https://example.com')
  })

  it('preserves protocol when present', async () => {
    mockFetch.mockResolvedValue({ url: 'x', title: 't', markdown: '# Hello', chars: 7 })
    await analyzeCompetitorSite('http://example.com')
    expect(mockFetch).toHaveBeenCalledWith('http://example.com')
  })

  it('returns null when Jina throws', async () => {
    mockFetch.mockRejectedValue(new Error('Jina 500'))
    const result = await analyzeCompetitorSite('example.com')
    expect(result).toBeNull()
  })

  it('returns parsed signals on success', async () => {
    mockFetch.mockResolvedValue({ url: 'x', title: 't', markdown: SAMPLE_MD, chars: SAMPLE_MD.length })
    const result = await analyzeCompetitorSite('example.com')
    expect(result).not.toBeNull()
    expect(result?.domain).toBe('example.com')
    expect(result?.cta_count).toBeGreaterThan(0)
  })
})
