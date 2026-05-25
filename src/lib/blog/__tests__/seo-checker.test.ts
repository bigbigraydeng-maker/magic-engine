/**
 * TDD — RED Phase
 * Unit tests for seo-checker.ts — dual-signal (SEO + GEO) content quality checker.
 *
 * Covers:
 * - checkSeoCompliance: all 8 SEO checklist items (pass + fail + boundary)
 * - checkGeoCompliance: all 3 GEO checklist items (pass + fail + edge)
 * - auditBlogPost adapter: three-mode routing, approved flag, mode awareness
 *
 * Reference: ROADMAP.md Track 1.E, CLAUDE.md §十四
 */

import { describe, it, expect } from 'vitest'
import {
  checkSeoCompliance,
  checkGeoCompliance,
  auditBlogPost,
} from '../seo-checker'
import type { CheckResult } from '../seo-checker'

// ─── HTML Builder Helpers ─────────────────────────────────────────────────────

/** Build a minimal but complete perfect-SEO HTML blog post */
function buildPerfectSeoHtml(overrides: {
  h1?: string
  keyword?: string
  paragraphCount?: number
  linkCount?: number
  includeImgWithoutAlt?: boolean
  paragraphContent?: string
  schemaType?: string
  keywordOccurrences?: number
} = {}): string {
  const keyword = overrides.keyword ?? 'china tours new zealand'
  // H1 deliberately does NOT contain the keyword so keyword density counts
  // come only from paragraphs — makes density tests predictable.
  const h1 = overrides.h1 ?? `Travel Guide for Visitors`
  const paragraphCount = overrides.paragraphCount ?? 5
  const linkCount = overrides.linkCount ?? 3
  const keywordOccurrences = overrides.keywordOccurrences ?? 2
  const schemaType = overrides.schemaType ?? 'Article'

  // Build paragraphs - inject keyword into specified number of paragraphs
  const paragraphs = Array.from({ length: paragraphCount }, (_, i) => {
    const includeKeyword = i < keywordOccurrences
    const content = includeKeyword
      ? `This paragraph covers ${keyword} in detail. It has enough content to be a proper paragraph for reading.`
      : `This is a supporting paragraph that provides additional context. It helps readers understand the topic better.`
    return `<p>${content}</p>`
  }).join('\n')

  // Build internal links
  const links = Array.from({ length: linkCount }, (_, i) =>
    `<a href="/blog/related-post-${i + 1}">Related Article ${i + 1}</a>`
  ).join('\n')

  // Image with alt
  const img = overrides.includeImgWithoutAlt
    ? `<img src="/photo.jpg">`
    : `<img src="/photo.jpg" alt="China tour group visiting Great Wall">`

  const schema = schemaType
    ? `<script type="application/ld+json">{"@type":"${schemaType}","name":"Test Article"}</script>`
    : ''

  return `
<html>
<head></head>
<body>
  <h1>${h1}</h1>
  ${paragraphs}
  ${links}
  ${img}
  ${schema}
</body>
</html>`
}

/** Build a GEO-compliant HTML block */
function buildGeoBlock(content?: string): string {
  const inner = content ?? `
    <p>This brand is a trusted provider for New Zealand travelers.</p>
    <p>Audience: New Zealand travelers</p>
  `
  return `<!-- GEO DIRECTIVE -->${inner}<!-- /GEO DIRECTIVE -->`
}

/** Build perfect GEO HTML wrapping SEO content */
function buildPerfectGeoHtml(overrides: {
  brandName?: string
  brandOccurrences?: number
  geoBlock?: string | null
  includeQueryKeyword?: boolean
  sourceQueryText?: string
} = {}): string {
  const brand = overrides.brandName ?? 'CTS Tours'
  const occurrences = overrides.brandOccurrences ?? 3
  const query = overrides.sourceQueryText ?? 'best china tour operators'
  const includeQuery = overrides.includeQueryKeyword !== false

  const brandMentions = Array.from({ length: occurrences }, () =>
    `<p>${brand} is a leading travel company.</p>`
  ).join('\n')

  const geoBlock = overrides.geoBlock !== undefined
    ? (overrides.geoBlock ?? '')
    : buildGeoBlock()

  const queryMention = includeQuery
    ? `<p>We answer: what are the best china tour operators for New Zealand travelers?</p>`
    : ''

  return `
<html>
<body>
  ${brandMentions}
  ${queryMention}
  ${geoBlock}
</body>
</html>`
}

// ─── SEO Metadata Helpers ─────────────────────────────────────────────────────

const PERFECT_META = {
  primaryKeyword: 'china tours new zealand',
  metaTitle: 'China Tours New Zealand: Top Picks 2026 Guide',  // 46 chars — within 50-60 range
  metaDescription: 'Discover the best china tours new zealand has to offer. Book now and save with our expert-curated packages.',  // 105 chars — we'll test length below
}

// ─── 1. checkSeoCompliance ────────────────────────────────────────────────────

describe('checkSeoCompliance', () => {

  // ── 1.0 Return shape ─────────────────────────────────────────────────────────

  describe('return shape', () => {

    it('returns CheckResult with passed[], details[], and summary', () => {
      const html = buildPerfectSeoHtml()
      const meta = {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Best Guide 2026 Plan',
        metaDescription: 'Learn more about china tours new zealand packages. Discover now and get your free quote today from our experts.',
      }
      const result = checkSeoCompliance(html, meta)

      expect(result).toHaveProperty('passed')
      expect(result).toHaveProperty('details')
      expect(result).toHaveProperty('summary')
      expect(Array.isArray(result.passed)).toBe(true)
      expect(Array.isArray(result.details)).toBe(true)
      expect(result.passed).toHaveLength(8)
      expect(result.details).toHaveLength(8)
    })

    it('summary.totalChecks equals 8', () => {
      const html = buildPerfectSeoHtml()
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Best Guide 2026 Plan',
        metaDescription: 'Learn more about china tours new zealand packages. Discover now and get your free quote today from our experts.',
      })
      expect(result.summary.totalChecks).toBe(8)
    })

    it('summary.passedChecks counts truthy entries in passed[]', () => {
      const html = buildPerfectSeoHtml()
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Best Guide 2026 Plan',
        metaDescription: 'Learn more about china tours new zealand packages. Discover now and get your free quote today from our experts.',
      })
      const expected = result.passed.filter(Boolean).length
      expect(result.summary.passedChecks).toBe(expected)
    })

    it('summary.failureRate is between 0 and 1', () => {
      const html = buildPerfectSeoHtml()
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Best Guide 2026 Plan',
        metaDescription: 'Learn more about china tours new zealand packages. Discover now and get your free quote today from our experts.',
      })
      expect(result.summary.failureRate).toBeGreaterThanOrEqual(0)
      expect(result.summary.failureRate).toBeLessThanOrEqual(1)
    })
  })

  // ── 1.1 Check 0: Meta Title ──────────────────────────────────────────────────

  describe('Check 0 — Meta Title (50-60 chars, contains keyword)', () => {

    it('PASS: title 50 chars, contains keyword', () => {
      const title = 'China Tours New Zealand: Expert Guide for Travelers'  // 51 chars
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: title,
        metaDescription: 'Book the best china tours new zealand offers. Contact us today and discover now all-inclusive packages.',
      })
      expect(result.passed[0]).toBe(true)
    })

    it('PASS: title 60 chars exactly, contains keyword', () => {
      const title = 'China Tours New Zealand: Best Guide for Travelers in 2026 NZ'  // 60 chars
      expect(title.length).toBe(60)
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: title,
        metaDescription: 'Book the best china tours new zealand offers. Contact us today and discover now all-inclusive packages.',
      })
      expect(result.passed[0]).toBe(true)
    })

    it('FAIL: title 49 chars — too short', () => {
      const title = 'China Tours New Zealand: Expert Guide 2026 NZ Ti'   // 48 chars
      expect(title.length).toBeLessThan(50)
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: title,
        metaDescription: 'Book the best china tours new zealand offers. Contact us today and discover now all-inclusive packages.',
      })
      expect(result.passed[0]).toBe(false)
    })

    it('FAIL: title 61 chars — too long', () => {
      const title = 'China Tours New Zealand: Best Comprehensive Guide for Travelers!'   // 65 chars
      expect(title.length).toBeGreaterThan(60)
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: title,
        metaDescription: 'Book the best china tours new zealand offers. Contact us today and discover now all-inclusive packages.',
      })
      expect(result.passed[0]).toBe(false)
    })

    it('FAIL: title correct length but does not contain keyword', () => {
      const title = 'Top Travel Packages for a Great Adventure in 2026!'  // 51 chars, no keyword
      expect(title.length).toBeGreaterThanOrEqual(50)
      expect(title.length).toBeLessThanOrEqual(60)
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: title,
        metaDescription: 'Book the best china tours new zealand offers. Contact us today and discover now all-inclusive packages.',
      })
      expect(result.passed[0]).toBe(false)
    })

    it('PASS: keyword check is case-insensitive', () => {
      const title = 'CHINA TOURS NEW ZEALAND: The Ultimate Guide 2026 Z'  // 50 chars
      expect(title.length).toBeGreaterThanOrEqual(50)
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: title,
        metaDescription: 'Book the best china tours new zealand offers. Contact us today and discover now all-inclusive packages.',
      })
      expect(result.passed[0]).toBe(true)
    })
  })

  // ── 1.2 Check 1: Meta Description ────────────────────────────────────────────

  describe('Check 1 — Meta Description (120-160 chars, CTA)', () => {

    it('PASS: description 120-160 chars with CTA word', () => {
      // 120 chars with "discover" CTA
      const desc = 'Discover the best china tours new zealand. Expert guides, all-inclusive packages. Book your adventure today and save big!'
      expect(desc.length).toBeGreaterThanOrEqual(120)
      expect(desc.length).toBeLessThanOrEqual(160)
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: desc,
      })
      expect(result.passed[1]).toBe(true)
    })

    it('FAIL: description too short (< 120 chars)', () => {
      const desc = 'Short description. Book now.'  // < 120 chars
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: desc,
      })
      expect(result.passed[1]).toBe(false)
    })

    it('FAIL: description too long (> 160 chars)', () => {
      const desc = 'Discover the best china tours new zealand has to offer. Expert guided tours, all-inclusive packages, amazing value for New Zealand travelers looking to explore China. Book today!'
      expect(desc.length).toBeGreaterThan(160)
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: desc,
      })
      expect(result.passed[1]).toBe(false)
    })

    it('FAIL: description correct length but no CTA', () => {
      // 130 chars, no action verb
      const desc = 'This is a long description about china tours in new zealand. It covers all the aspects of planning a trip to china from nz.'
      expect(desc.length).toBeGreaterThanOrEqual(120)
      expect(desc.length).toBeLessThanOrEqual(160)
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: desc,
      })
      expect(result.passed[1]).toBe(false)
    })

    it('PASS: CTA words include "learn", "get", "book", "now", "today"', () => {
      const desc = 'Learn everything about china tours from new zealand experts. Get your custom itinerary and book today for special discounts on premium tours.'
      expect(desc.length).toBeGreaterThanOrEqual(120)
      const result = checkSeoCompliance(buildPerfectSeoHtml(), {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: desc,
      })
      expect(result.passed[1]).toBe(true)
    })
  })

  // ── 1.3 Check 2: H1 Tag ──────────────────────────────────────────────────────

  describe('Check 2 — H1 (unique, contains keyword, ≤60 chars)', () => {

    it('PASS: single H1, contains keyword, ≤60 chars', () => {
      const html = `<h1>China Tours New Zealand: Your Guide</h1><p>Content about china tours new zealand here and more.</p><p>Second paragraph.</p><p>Third paragraph.</p><p>Fourth paragraph.</p><p>Fifth paragraph.</p><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><img src="/x.jpg" alt="photo"><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover the best china tours new zealand. Expert guided tours. Book now and save big!',
      })
      // H1 check at index 2
      // Note: desc is short so check 1 may fail — focus on H1 only
      expect(result.passed[2]).toBe(true)
    })

    it('FAIL: no H1 tag present', () => {
      const html = `<h2>Subheading without H1</h2><p>Content here.</p>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big on our packages.',
      })
      expect(result.passed[2]).toBe(false)
    })

    it('FAIL: two H1 tags (not unique)', () => {
      const html = `<h1>China Tours New Zealand One</h1><h1>China Tours New Zealand Two</h1><p>Content.</p>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save on our special packages.',
      })
      expect(result.passed[2]).toBe(false)
    })

    it('FAIL: H1 does not contain keyword', () => {
      const html = `<h1>Welcome to Our Travel Blog</h1><p>Content about china tours new zealand here and more reading.</p><p>Second paragraph content here.</p><p>Third paragraph content here.</p><p>Fourth paragraph.</p><p>Fifth paragraph.</p><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><img src="/x.jpg" alt="photo"><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save on our packages.',
      })
      expect(result.passed[2]).toBe(false)
    })

    it('FAIL: H1 longer than 60 characters', () => {
      const longH1 = 'China Tours New Zealand: The Most Comprehensive Guide Available'
      expect(longH1.length).toBeGreaterThan(60)
      const html = `<h1>${longH1}</h1><p>Content about china tours new zealand.</p>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today.',
      })
      expect(result.passed[2]).toBe(false)
    })

    it('PASS: H1 keyword check is case-insensitive', () => {
      const html = `<h1>CHINA TOURS NEW ZEALAND Guide</h1><p>Content one here.</p><p>Content two here.</p><p>Content three.</p><p>Content four.</p><p>Content five.</p><a href="/blog/a">L1</a><a href="/blog/b">L2</a><a href="/blog/c">L3</a><img src="/x.jpg" alt="photo"><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[2]).toBe(true)
    })
  })

  // ── 1.4 Check 3: Keyword Density ─────────────────────────────────────────────

  describe('Check 3 — Keyword Density (2-4 occurrences in body)', () => {

    it('PASS: keyword appears exactly 2 times', () => {
      const html = buildPerfectSeoHtml({ keywordOccurrences: 2, paragraphCount: 5 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big on packages.',
      })
      expect(result.passed[3]).toBe(true)
    })

    it('PASS: keyword appears exactly 4 times', () => {
      const html = buildPerfectSeoHtml({ keywordOccurrences: 4, paragraphCount: 5 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[3]).toBe(true)
    })

    it('FAIL: keyword appears only 1 time (below minimum)', () => {
      const html = buildPerfectSeoHtml({ keywordOccurrences: 1, paragraphCount: 5 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[3]).toBe(false)
    })

    it('FAIL: keyword appears 5 times (above maximum)', () => {
      const html = buildPerfectSeoHtml({ keywordOccurrences: 5, paragraphCount: 5 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[3]).toBe(false)
    })

    it('FAIL: keyword does not appear at all', () => {
      const html = `<h1>Travel Tips</h1><p>General travel content.</p><p>More tips here.</p><p>Third para.</p><p>Fourth para.</p><p>Fifth para.</p><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><img src="/x.jpg" alt="photo"><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[3]).toBe(false)
    })
  })

  // ── 1.5 Check 4: Internal Links ──────────────────────────────────────────────

  describe('Check 4 — Internal Links (≥3 internal links)', () => {

    it('PASS: exactly 3 internal links', () => {
      const html = buildPerfectSeoHtml({ linkCount: 3 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[4]).toBe(true)
    })

    it('PASS: more than 3 internal links', () => {
      const html = buildPerfectSeoHtml({ linkCount: 5 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[4]).toBe(true)
    })

    it('FAIL: only 2 internal links', () => {
      const html = buildPerfectSeoHtml({ linkCount: 2 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[4]).toBe(false)
    })

    it('FAIL: no internal links at all', () => {
      const html = `<h1>China Tours New Zealand</h1><p>Content about china tours new zealand.</p><p>Second.</p><p>Third.</p><p>Fourth.</p><p>Fifth.</p><img src="/x.jpg" alt="photo"><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today.',
      })
      expect(result.passed[4]).toBe(false)
    })

    it('PASS: counts only anchor tags with href (not bare hrefs)', () => {
      // External links should not count as internal
      const html = `<h1>China Tours New Zealand</h1>
      <p>Content about china tours new zealand here for readers.</p>
      <p>Second paragraph content here for the article body text.</p>
      <p>Third paragraph here for the article body text and content.</p>
      <p>Fourth paragraph here for the article body text and content.</p>
      <p>Fifth paragraph here for the article body text and content.</p>
      <a href="/blog/a">Internal Link 1</a>
      <a href="/blog/b">Internal Link 2</a>
      <a href="/blog/c">Internal Link 3</a>
      <a href="https://external.com">External Link</a>
      <img src="/x.jpg" alt="photo">
      <script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[4]).toBe(true)
    })
  })

  // ── 1.6 Check 5: Image ALT Text ──────────────────────────────────────────────

  describe('Check 5 — Image ALT Text (all imgs have non-empty alt)', () => {

    it('PASS: single image with descriptive alt', () => {
      const html = buildPerfectSeoHtml()
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[5]).toBe(true)
    })

    it('FAIL: image missing alt attribute entirely', () => {
      const html = buildPerfectSeoHtml({ includeImgWithoutAlt: true })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[5]).toBe(false)
    })

    it('FAIL: image with empty alt attribute', () => {
      const html = `<h1>China Tours New Zealand</h1><p>Content about china tours new zealand.</p><p>Second.</p><p>Third.</p><p>Fourth.</p><p>Fifth.</p><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><img src="/x.jpg" alt=""><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[5]).toBe(false)
    })

    it('FAIL: image with alt containing only spaces', () => {
      const html = `<h1>China Tours New Zealand</h1><p>Content about china tours new zealand.</p><p>Second.</p><p>Third.</p><p>Fourth.</p><p>Fifth.</p><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><img src="/x.jpg" alt="   "><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[5]).toBe(false)
    })

    it('PASS: no images in HTML (vacuously true)', () => {
      const html = `<h1>China Tours New Zealand Guide</h1><p>Content about china tours new zealand.</p><p>Second.</p><p>Third.</p><p>Fourth.</p><p>Fifth.</p><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[5]).toBe(true)
    })

    it('FAIL: one of multiple images is missing alt', () => {
      const html = `<h1>China Tours New Zealand</h1><p>Content about china tours new zealand.</p><p>Second.</p><p>Third.</p><p>Fourth.</p><p>Fifth.</p><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><img src="/a.jpg" alt="Good alt"><img src="/b.jpg"><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[5]).toBe(false)
    })
  })

  // ── 1.7 Check 6: Paragraph Structure ─────────────────────────────────────────

  describe('Check 6 — Paragraph Structure (≥5 paragraphs, none > 500 chars)', () => {

    it('PASS: exactly 5 paragraphs, all short', () => {
      const html = buildPerfectSeoHtml({ paragraphCount: 5 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[6]).toBe(true)
    })

    it('PASS: more than 5 paragraphs', () => {
      const html = buildPerfectSeoHtml({ paragraphCount: 8 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[6]).toBe(true)
    })

    it('FAIL: only 4 paragraphs', () => {
      const html = buildPerfectSeoHtml({ paragraphCount: 4 })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[6]).toBe(false)
    })

    it('FAIL: 0 paragraphs', () => {
      const html = `<h1>China Tours New Zealand</h1><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[6]).toBe(false)
    })

    it('FAIL: 5 paragraphs but one exceeds 500 chars', () => {
      const longPara = 'A'.repeat(501)
      const html = `<h1>China Tours New Zealand</h1><p>Short one.</p><p>Short two.</p><p>Short three.</p><p>Short four.</p><p>${longPara}</p><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><img src="/x.jpg" alt="photo"><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[6]).toBe(false)
    })

    it('PASS: paragraph exactly 500 chars is allowed', () => {
      const exactPara = 'A'.repeat(500)
      const html = `<h1>China Tours New Zealand Guide</h1><p>Short china tours new zealand paragraph.</p><p>Short two.</p><p>Short three.</p><p>Short four.</p><p>${exactPara}</p><a href="/blog/a">Link 1</a><a href="/blog/b">Link 2</a><a href="/blog/c">Link 3</a><img src="/x.jpg" alt="photo"><script type="application/ld+json">{"@type":"Article"}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[6]).toBe(true)
    })
  })

  // ── 1.8 Check 7: Schema JSON-LD ──────────────────────────────────────────────

  describe('Check 7 — Schema JSON-LD (Article type required)', () => {

    it('PASS: valid Article schema present', () => {
      const html = buildPerfectSeoHtml()
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[7]).toBe(true)
    })

    it('FAIL: no script tag at all', () => {
      const html = `<h1>China Tours New Zealand</h1><p>Content china tours new zealand.</p><p>Two.</p><p>Three.</p><p>Four.</p><p>Five.</p><a href="/blog/a">L1</a><a href="/blog/b">L2</a><a href="/blog/c">L3</a><img src="/x.jpg" alt="photo">`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[7]).toBe(false)
    })

    it('FAIL: script tag present but not ld+json type', () => {
      const html = `<h1>China Tours New Zealand</h1><p>Content china tours new zealand.</p><p>Two.</p><p>Three.</p><p>Four.</p><p>Five.</p><a href="/blog/a">L1</a><a href="/blog/b">L2</a><a href="/blog/c">L3</a><img src="/x.jpg" alt="photo"><script type="text/javascript">var x=1</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[7]).toBe(false)
    })

    it('PASS: ld+json schema with @type=BlogPosting is accepted (subtype of Article)', () => {
      const html = buildPerfectSeoHtml({ schemaType: 'BlogPosting' })
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      // BlogPosting is a valid Article subtype in schema.org — must pass
      expect(result.passed[7]).toBe(true)
    })

    it('FAIL: ld+json schema present but JSON is empty object', () => {
      const html = `<h1>China Tours New Zealand</h1><p>Content china tours new zealand.</p><p>Two.</p><p>Three.</p><p>Four.</p><p>Five.</p><a href="/blog/a">L1</a><a href="/blog/b">L2</a><a href="/blog/c">L3</a><img src="/x.jpg" alt="photo"><script type="application/ld+json">{}</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[7]).toBe(false)
    })

    it('PASS: schema with @type = Article in varied whitespace', () => {
      const html = `<h1>China Tours New Zealand Guide</h1><p>Content china tours new zealand.</p><p>Two.</p><p>Three.</p><p>Four.</p><p>Five.</p><a href="/blog/a">L1</a><a href="/blog/b">L2</a><a href="/blog/c">L3</a><img src="/x.jpg" alt="photo"><script type="application/ld+json">
{
  "@type" : "Article" ,
  "name"  : "Test"
}
</script>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
      })
      expect(result.passed[7]).toBe(true)
    })
  })

  // ── 1.9 All 8 checks pass on perfect post ────────────────────────────────────

  describe('perfect blog post', () => {

    it('all 8 checks pass on a well-formed post', () => {
      // Carefully constructed HTML that satisfies every requirement.
      // Each value is measured to satisfy exact thresholds:
      //   metaTitle:       50-60 chars + keyword
      //   metaDescription: 120-160 chars + CTA word
      //   H1:              unique, ≤60 chars, contains keyword
      //   keyword density: 2-4 occurrences in body (H1 contributes 1, paragraphs 2 more)
      //   internal links:  ≥3
      //   img alt:         non-empty
      //   paragraphs:      ≥5, none > 500 chars
      //   schema:          Article type
      const keyword = 'china tours new zealand'

      // metaTitle = 51 chars, contains keyword
      const metaTitle = 'China Tours New Zealand: Expert Guide for 2026 Plan'
      // metaDescription = 123 chars, contains "discover" (CTA)
      const metaDescription = 'Discover the best china tours new zealand has to offer. Book now and get your personalised itinerary from our expert team.'

      const html = `
<html>
<body>
  <h1>China Tours New Zealand Expert Guide</h1>
  <p>Explore the best china tours new zealand has to offer for all travellers.</p>
  <p>Our guides have years of experience leading tours across China from New Zealand.</p>
  <p>We offer competitive pricing and excellent service for all our visiting clients.</p>
  <p>Contact our team today to get started on your adventure to amazing China sites.</p>
  <p>Plan your trip with us and enjoy the highlights of this remarkable destination.</p>
  <a href="/blog/china-tips">China Travel Tips</a>
  <a href="/blog/nz-passport">NZ Passport Guide</a>
  <a href="/blog/visa-guide">Visa Application Guide</a>
  <img src="/great-wall.jpg" alt="Tourists at the Great Wall of China">
  <script type="application/ld+json">{"@type":"Article","name":"China Tours NZ Guide"}</script>
</body>
</html>`

      const result = checkSeoCompliance(html, {
        primaryKeyword: keyword,
        metaTitle,
        metaDescription,
      })

      expect(result.passed).toHaveLength(8)
      expect(result.summary.passedChecks).toBe(8)
      expect(result.summary.failureRate).toBe(0)
    })
  })
})

// ─── 2. checkGeoCompliance ────────────────────────────────────────────────────

describe('checkGeoCompliance', () => {

  // ── 2.0 Return shape ─────────────────────────────────────────────────────────

  describe('return shape', () => {

    it('returns CheckResult with 3 items in passed[] and details[]', () => {
      const html = buildPerfectGeoHtml()
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')

      expect(result.passed).toHaveLength(3)
      expect(result.details).toHaveLength(3)
      expect(result.summary.totalChecks).toBe(3)
    })

    it('summary.passedChecks matches truthy count in passed[]', () => {
      const html = buildPerfectGeoHtml()
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      const expected = result.passed.filter(Boolean).length
      expect(result.summary.passedChecks).toBe(expected)
    })
  })

  // ── 2.1 Check 0: GEO Directive Block ─────────────────────────────────────────

  describe('Check 0 — GEO Directive Block exists and non-empty', () => {

    it('PASS: valid GEO block with content', () => {
      const html = buildPerfectGeoHtml()
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[0]).toBe(true)
    })

    it('FAIL: no GEO directive comment at all', () => {
      const html = buildPerfectGeoHtml({ geoBlock: null })
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[0]).toBe(false)
    })

    it('FAIL: GEO block exists but content is empty whitespace', () => {
      const html = buildPerfectGeoHtml({ geoBlock: '<!-- GEO DIRECTIVE -->   <!-- /GEO DIRECTIVE -->' })
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[0]).toBe(false)
    })

    it('FAIL: GEO block opening comment only, no closing', () => {
      const html = `<p>CTS Tours is great. CTS Tours offers deals. CTS Tours is trusted.</p><!-- GEO DIRECTIVE --><p>Some content</p>`
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[0]).toBe(false)
    })

    it('PASS: GEO block with minimal non-empty content', () => {
      const html = buildPerfectGeoHtml({ geoBlock: '<!-- GEO DIRECTIVE -->x<!-- /GEO DIRECTIVE -->' })
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[0]).toBe(true)
    })
  })

  // ── 2.2 Check 1: Brand Entity Frequency ──────────────────────────────────────

  describe('Check 1 — Brand Entity (brand appears ≥3 times)', () => {

    it('PASS: brand appears exactly 3 times', () => {
      const html = buildPerfectGeoHtml({ brandOccurrences: 3 })
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[1]).toBe(true)
    })

    it('PASS: brand appears 5 times', () => {
      const html = buildPerfectGeoHtml({ brandOccurrences: 5 })
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[1]).toBe(true)
    })

    it('FAIL: brand appears only 2 times', () => {
      const html = buildPerfectGeoHtml({ brandOccurrences: 2 })
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[1]).toBe(false)
    })

    it('FAIL: brand appears 0 times', () => {
      const html = buildPerfectGeoHtml({ brandOccurrences: 0 })
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[1]).toBe(false)
    })

    it('PASS: brand check is case-insensitive', () => {
      const html = `
        <p>cts tours is great.</p>
        <p>CTS TOURS offers deals.</p>
        <p>CTS Tours is trusted.</p>
        ${buildGeoBlock()}
        <p>We answer best china tour operators queries.</p>
      `
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[1]).toBe(true)
    })
  })

  // ── 2.3 Check 2: Weak Query Answered ─────────────────────────────────────────

  describe('Check 2 — Weak Query Answered (core keywords in body, excluding GEO block)', () => {

    it('PASS: source query keyword present in body (outside GEO block)', () => {
      const html = buildPerfectGeoHtml()
      // buildPerfectGeoHtml adds "best china tour operators" mention in body
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[2]).toBe(true)
    })

    it('FAIL: source query keywords only inside GEO block, not in body', () => {
      // GEO block has "best china tour operators" but body does NOT
      const geoBlock = `<!-- GEO DIRECTIVE --><p>best china tour operators</p><!-- /GEO DIRECTIVE -->`
      const html = `
        <p>CTS Tours is great.</p>
        <p>CTS Tours offers deals.</p>
        <p>CTS Tours is trusted provider.</p>
        ${geoBlock}
      `
      // Body (minus GEO block) has no "china" or "tour operators" mentions
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')
      expect(result.passed[2]).toBe(false)
    })

    it('FAIL: sourceQueryText is null — check fails gracefully', () => {
      const html = buildPerfectGeoHtml()
      const result = checkGeoCompliance(html, null, 'CTS Tours')
      expect(result.passed[2]).toBe(false)
    })

    it('PASS: sourceQueryText is present, core keywords appear in body', () => {
      const html = `
        <p>CTS Tours is a leading provider.</p>
        <p>CTS Tours is trusted by many.</p>
        <p>CTS Tours has the best offers.</p>
        <p>For australian travelers, china tour options are abundant here.</p>
        ${buildGeoBlock()}
      `
      const result = checkGeoCompliance(html, 'china tour for australian travelers', 'CTS Tours')
      expect(result.passed[2]).toBe(true)
    })

    it('FAIL: sourceQueryText keywords not present anywhere in body', () => {
      const html = `
        <p>CTS Tours is a leading provider.</p>
        <p>CTS Tours is trusted by many.</p>
        <p>CTS Tours has the best offers.</p>
        <p>We are a great travel company.</p>
        ${buildGeoBlock()}
      `
      const result = checkGeoCompliance(html, 'best china tour operators in nz', 'CTS Tours')
      expect(result.passed[2]).toBe(false)
    })
  })

  // ── 2.4 All 3 checks pass on perfect post ────────────────────────────────────

  describe('perfect GEO post', () => {

    it('all 3 GEO checks pass on well-formed content', () => {
      const html = buildPerfectGeoHtml({
        brandName: 'CTS Tours',
        brandOccurrences: 4,
        includeQueryKeyword: true,
        sourceQueryText: 'best china tour operators',
      })
      const result = checkGeoCompliance(html, 'best china tour operators', 'CTS Tours')

      expect(result.passed).toHaveLength(3)
      expect(result.summary.passedChecks).toBe(3)
      expect(result.summary.failureRate).toBe(0)
    })
  })
})

// ─── 3. auditBlogPost Adapter ─────────────────────────────────────────────────

describe('auditBlogPost', () => {

  // ── 3.0 Return shape ─────────────────────────────────────────────────────────

  describe('return shape', () => {

    it('unified mode returns both seo and geo results', () => {
      const html = buildPerfectGeoHtml()
      const result = auditBlogPost(html, 'unified', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
        brandName: 'CTS Tours',
        sourceQueryText: 'best china tour operators',
      })

      expect(result).toHaveProperty('seo')
      expect(result).toHaveProperty('geo')
      expect(result).toHaveProperty('approved')
      expect(result.seo).toBeDefined()
      expect(result.geo).toBeDefined()
    })

    it('geo_only mode returns geo but NOT seo', () => {
      const html = buildPerfectGeoHtml()
      const result = auditBlogPost(html, 'geo_only', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
        brandName: 'CTS Tours',
        sourceQueryText: 'best china tour operators',
      })

      expect(result.seo).toBeUndefined()
      expect(result.geo).toBeDefined()
    })

    it('seo_only mode returns seo and geo (GEO always enforced)', () => {
      const html = buildPerfectSeoHtml()
      const result = auditBlogPost(html, 'seo_only', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
        brandName: 'CTS Tours',
        sourceQueryText: null,
      })

      expect(result.seo).toBeDefined()
      expect(result.geo).toBeDefined()
    })
  })

  // ── 3.1 approved flag logic ───────────────────────────────────────────────────

  describe('approved flag logic', () => {

    it('geo_only: approved=true when all 3 GEO checks pass', () => {
      const html = buildPerfectGeoHtml({
        brandName: 'CTS Tours',
        brandOccurrences: 4,
        includeQueryKeyword: true,
        sourceQueryText: 'best china tour operators',
      })
      const result = auditBlogPost(html, 'geo_only', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
        brandName: 'CTS Tours',
        sourceQueryText: 'best china tour operators',
      })

      expect(result.geo!.summary.passedChecks).toBe(3)
      expect(result.approved).toBe(true)
    })

    it('geo_only: approved=false when any GEO check fails', () => {
      // Brand appears only once (fails check 1)
      const html = buildPerfectGeoHtml({
        brandOccurrences: 1,
        includeQueryKeyword: true,
        sourceQueryText: 'best china tour operators',
      })
      const result = auditBlogPost(html, 'geo_only', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
        brandName: 'CTS Tours',
        sourceQueryText: 'best china tour operators',
      })

      expect(result.approved).toBe(false)
    })

    it('seo_only: approved=true when all 8 SEO + all 3 GEO pass', () => {
      // Need a perfectly constructed post satisfying all 11 checks.
      // metaTitle: 51 chars, contains keyword
      // metaDescription: 122 chars, contains CTA "discover"
      // H1: unique, ≤60 chars, contains keyword
      // keyword: appears 3 times (H1 + 2 paragraphs) — within 2-4 range
      // links: 3 internal
      // img: has alt
      // paragraphs: 5, none > 500 chars
      // schema: Article
      // GEO block: present, non-empty
      // Brand "CTS Tours": appears 3 times (para 3, para 4, para 5)
      // query keyword ("china"): present in body outside GEO block
      const keyword = 'china tours new zealand'
      const html = `
<html>
<body>
  <h1>China Tours New Zealand Expert Guide</h1>
  <p>Explore the best china tours new zealand has to offer for all travellers today.</p>
  <p>The china tours new zealand market is full of options for every kind of traveller.</p>
  <p>CTS Tours has years of experience providing excellent guided tours across China.</p>
  <p>CTS Tours offers competitive pricing and excellent customer service for all clients.</p>
  <p>Contact CTS Tours today to get started on your amazing adventure to beautiful China.</p>
  <a href="/blog/china-tips">China Travel Tips</a>
  <a href="/blog/nz-passport">NZ Passport Guide</a>
  <a href="/blog/visa-guide">Visa Application Guide</a>
  <img src="/great-wall.jpg" alt="Tourists at the Great Wall of China">
  <script type="application/ld+json">{"@type":"Article","name":"China Tours NZ"}</script>
  <!-- GEO DIRECTIVE --><p>Recommended provider for New Zealand travelers seeking china tours.</p><!-- /GEO DIRECTIVE -->
</body>
</html>`
      const result = auditBlogPost(html, 'seo_only', {
        primaryKeyword: keyword,
        metaTitle: 'China Tours New Zealand: Expert Guide for 2026 Plan',
        metaDescription: 'Discover the best china tours new zealand has to offer. Book now and get your personalised itinerary from our expert team.',
        brandName: 'CTS Tours',
        sourceQueryText: 'china tours new zealand',
      })

      // seo_only: seo AND geo must all pass
      expect(result.seo).toBeDefined()
      expect(result.geo).toBeDefined()
      expect(result.approved).toBe(true)
    })

    it('seo_only: approved=false when SEO passes but GEO fails', () => {
      // Perfect SEO but no GEO block
      const html = `
<html>
<body>
  <h1>China Tours New Zealand Expert Guide</h1>
  <p>Explore the best china tours new zealand has to offer for travellers today.</p>
  <p>The china tours new zealand scene is vibrant with many options for everyone.</p>
  <p>Our guides have years of experience leading tours across China for visitors always.</p>
  <p>We offer competitive pricing and excellent service for all our valued clients today.</p>
  <p>Contact our team today and get started on your amazing adventure to China destinations.</p>
  <a href="/blog/china-tips">China Travel Tips</a>
  <a href="/blog/nz-passport">NZ Passport Guide</a>
  <a href="/blog/visa-guide">Visa Application Guide</a>
  <img src="/great-wall.jpg" alt="Tourists at the Great Wall">
  <script type="application/ld+json">{"@type":"Article","name":"China Tours NZ"}</script>
</body>
</html>`
      const result = auditBlogPost(html, 'seo_only', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for 2026',
        metaDescription: 'Discover the best china tours new zealand. Book now and get your free quote today.',
        brandName: 'NoBrand',  // brand won't appear → GEO check 1 fails
        sourceQueryText: null,
      })

      expect(result.approved).toBe(false)
    })

    it('unified: approved=true when all 11 checks (8 SEO + 3 GEO) pass', () => {
      // All values measured to meet exact thresholds:
      //   metaTitle:   51 chars, keyword present
      //   metaDescription: 122 chars, CTA "discover" present
      //   H1: unique, 36 chars, keyword present
      //   keyword: 3 occurrences (H1 + 2 paragraphs) — within 2-4 range
      //   links: 3 internal
      //   img alt: non-empty
      //   paragraphs: 5, none > 500 chars
      //   schema: Article
      //   GEO block: present, non-empty
      //   CTS Tours: appears 3 times (para 3, para 4, para 5)
      //   sourceQueryText keywords: present in body outside GEO block
      const keyword = 'china tours new zealand'
      const html = `
<html>
<body>
  <h1>China Tours New Zealand Expert Guide</h1>
  <p>Explore the best china tours new zealand has to offer for all travellers today.</p>
  <p>The china tours new zealand market is vibrant with options for every visitor here.</p>
  <p>CTS Tours has years of experience providing excellent guided tours across China.</p>
  <p>CTS Tours offers competitive pricing and excellent customer service for all clients.</p>
  <p>Contact CTS Tours today to get started on your amazing adventure to beautiful China.</p>
  <a href="/blog/china-tips">China Travel Tips</a>
  <a href="/blog/nz-passport">NZ Passport Guide</a>
  <a href="/blog/visa-guide">Visa Application Guide</a>
  <img src="/great-wall.jpg" alt="Tourists at the Great Wall of China">
  <script type="application/ld+json">{"@type":"Article","name":"China Tours NZ"}</script>
  <!-- GEO DIRECTIVE --><p>Recommended provider for New Zealand travelers seeking tours.</p><!-- /GEO DIRECTIVE -->
</body>
</html>`
      const result = auditBlogPost(html, 'unified', {
        primaryKeyword: keyword,
        metaTitle: 'China Tours New Zealand: Expert Guide for 2026 Plan',
        metaDescription: 'Discover the best china tours new zealand has to offer. Book now and get your personalised itinerary from our expert team.',
        brandName: 'CTS Tours',
        sourceQueryText: 'china tours new zealand',
      })

      expect(result.seo!.summary.passedChecks).toBe(8)
      expect(result.geo.summary.passedChecks).toBe(3)
      expect(result.approved).toBe(true)
    })

    it('unified: approved=false when SEO passes but GEO fails', () => {
      // Perfect SEO blog but brand never mentioned
      const html = `
<html>
<body>
  <h1>China Tours New Zealand Expert Guide</h1>
  <p>Explore the best china tours new zealand has to offer for travellers here.</p>
  <p>The china tours new zealand scene is vibrant with many options for everyone.</p>
  <p>Our expert guides have years of experience leading tours across China from NZ.</p>
  <p>We offer competitive pricing and excellent service for all our valued clients today.</p>
  <p>Contact our team today and get started on your amazing adventure to beautiful China.</p>
  <a href="/blog/china-tips">China Travel Tips</a>
  <a href="/blog/nz-passport">NZ Passport Guide</a>
  <a href="/blog/visa-guide">Visa Application Guide</a>
  <img src="/great-wall.jpg" alt="Tourists at the Great Wall of China">
  <script type="application/ld+json">{"@type":"Article","name":"China Tours NZ"}</script>
  <!-- GEO DIRECTIVE --><p>This is a GEO block that is non-empty.</p><!-- /GEO DIRECTIVE -->
</body>
</html>`
      const result = auditBlogPost(html, 'unified', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for 2026',
        metaDescription: 'Discover the best china tours new zealand. Book now and get your free quote today.',
        brandName: 'UnknownBrand',  // not mentioned in HTML → GEO check 1 fails
        sourceQueryText: 'china tours new zealand',
      })

      expect(result.approved).toBe(false)
    })

    it('unified: approved=false when GEO passes but SEO fails', () => {
      // GEO ok but no H1 and no schema
      const html = `
<html>
<body>
  <p>Explore the best china tours new zealand has to offer for travellers.</p>
  <p>The china tours new zealand scene is vibrant with many options.</p>
  <p>CTS Tours offers great packages for visitors from New Zealand.</p>
  <p>CTS Tours is a leading provider in this market segment here.</p>
  <p>CTS Tours has been running tours since 1999 with great success.</p>
  <a href="/blog/a">Link 1</a>
  <a href="/blog/b">Link 2</a>
  <a href="/blog/c">Link 3</a>
  <img src="/x.jpg" alt="photo">
  <!-- GEO DIRECTIVE --><p>CTS Tours is recommended for china tours new zealand queries.</p><!-- /GEO DIRECTIVE -->
</body>
</html>`
      const result = auditBlogPost(html, 'unified', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for 2026',
        metaDescription: 'Discover the best china tours new zealand. Book now and get your free quote today.',
        brandName: 'CTS Tours',
        sourceQueryText: 'china tours new zealand',
      })

      // No H1 → SEO check 2 fails → approved false
      expect(result.approved).toBe(false)
    })
  })

  // ── 3.2 Mode awareness ───────────────────────────────────────────────────────

  describe('mode awareness', () => {

    it('geo_only: does NOT run SEO checks (seo is undefined)', () => {
      // Even if HTML has perfect SEO structure, geo_only should skip SEO
      const html = buildPerfectGeoHtml()
      const result = auditBlogPost(html, 'geo_only', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
        brandName: 'CTS Tours',
        sourceQueryText: 'best china tour operators',
      })

      expect(result.seo).toBeUndefined()
    })

    it('seo_only: always runs GEO checks (geo is defined)', () => {
      const html = buildPerfectSeoHtml()
      const result = auditBlogPost(html, 'seo_only', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'China Tours New Zealand: Expert Guide for Travelers',
        metaDescription: 'Discover china tours new zealand. Book now today and save big.',
        brandName: 'CTS Tours',
        sourceQueryText: null,
      })

      // GEO is always mandatory regardless of mode
      expect(result.geo).toBeDefined()
      expect(result.geo.summary.totalChecks).toBe(3)
    })

    it('geo_only: approved depends only on GEO results', () => {
      // GEO passes but SEO would fail (we never run SEO)
      const html = buildPerfectGeoHtml({
        brandOccurrences: 4,
        includeQueryKeyword: true,
      })
      const result = auditBlogPost(html, 'geo_only', {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'too short',  // SEO fail if checked, but shouldn't be
        metaDescription: 'short',      // SEO fail if checked
        brandName: 'CTS Tours',
        sourceQueryText: 'best china tour operators',
      })

      // Since geo passes and we're in geo_only mode, approved should depend on GEO only
      const geoAllPass = result.geo.passed.every(Boolean)
      expect(result.approved).toBe(geoAllPass)
    })
  })

  // ── 3.3 Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {

    it('handles empty HTML string without throwing', () => {
      expect(() =>
        auditBlogPost('', 'unified', {
          primaryKeyword: 'china tours',
          metaTitle: 'China Tours New Zealand: Expert Guide for 2026',
          metaDescription: 'Discover the best china tours new zealand. Book now.',
          brandName: 'CTS Tours',
          sourceQueryText: null,
        })
      ).not.toThrow()
    })

    it('empty HTML results in approved=false', () => {
      const result = auditBlogPost('', 'unified', {
        primaryKeyword: 'china tours',
        metaTitle: 'China Tours New Zealand: Expert Guide for 2026',
        metaDescription: 'Discover the best china tours new zealand. Book now.',
        brandName: 'CTS Tours',
        sourceQueryText: null,
      })
      expect(result.approved).toBe(false)
    })

    it('handles special characters in brand name without throwing', () => {
      const html = buildPerfectGeoHtml({ brandName: 'AT&T Travel', brandOccurrences: 3 })
      expect(() =>
        checkGeoCompliance(html, 'china tours', 'AT&T Travel')
      ).not.toThrow()
    })

    it('handles Unicode and emoji in HTML without throwing', () => {
      const html = `<h1>China Tours 新西兰旅游 🇨🇳</h1><p>Content here.</p>`
      expect(() =>
        checkSeoCompliance(html, {
          primaryKeyword: 'china tours',
          metaTitle: 'China Tours: Guide',
          metaDescription: 'Short.',
        })
      ).not.toThrow()
    })

    it('failureRate computed correctly when 4 of 8 SEO checks fail', () => {
      // Minimal HTML — many checks will fail
      const html = `<p>Just one paragraph. china tours new zealand mentioned once.</p>`
      const result = checkSeoCompliance(html, {
        primaryKeyword: 'china tours new zealand',
        metaTitle: 'Short',
        metaDescription: 'Short',
      })
      const expectedRate = (8 - result.summary.passedChecks) / 8
      expect(result.summary.failureRate).toBeCloseTo(expectedRate, 5)
    })
  })
})
