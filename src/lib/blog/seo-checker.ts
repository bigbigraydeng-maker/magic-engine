/**
 * SEO + GEO dual-signal content quality checker.
 *
 * Two independent check suites:
 *   checkSeoCompliance  — 8 SEO items (only enforced for unified + seo_only)
 *   checkGeoCompliance  — 3 GEO items (enforced for ALL modes)
 *
 * The auditBlogPost() adapter wires mode → correct suite selection and
 * derives the single `approved` flag according to CLAUDE.md §十四 rules.
 *
 * Security: All public functions enforce input size limits before running
 * regex operations to prevent ReDoS attacks on large or crafted inputs.
 *
 * Reference: ROADMAP.md Track 1.E, CLAUDE.md §十四
 */

// ─── Input Size Limits (DoS prevention) ───────────────────────────────────────

/** Maximum allowed HTML body length in characters (~1 MB). */
const MAX_HTML_BODY_CHARS = 1_000_000

/** Maximum allowed brand name length in characters. */
const MAX_BRAND_NAME_CHARS = 200

/** Maximum allowed source query text length in characters. */
const MAX_QUERY_TEXT_CHARS = 2_000

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface CheckResult {
  /** Per-check pass/fail — index matches the spec's numbered list */
  passed: boolean[]
  /** Human-readable detail per check (same index) */
  details: string[]
  summary: {
    totalChecks: number
    passedChecks: number
    /** 0-1, fraction of checks that failed */
    failureRate: number
  }
}

// ─── SEO Checklist (8 items) ──────────────────────────────────────────────────

/**
 * Run all 8 SEO checks against the provided HTML and metadata.
 *
 * Check order (index = position in passed[]):
 *   0 Meta Title          — 50-60 chars, contains primaryKeyword
 *   1 Meta Description    — 120-160 chars, contains CTA phrase
 *   2 H1 Tag              — unique, contains keyword, ≤60 chars
 *   3 Keyword Density     — primaryKeyword appears 2-4× in body
 *   4 Internal Links      — ≥3 <a> with relative or same-domain href
 *   5 Image ALT           — every <img> has a non-empty alt attribute
 *   6 Paragraph Structure — ≥5 <p> elements, none > 500 chars
 *   7 Schema JSON-LD      — <script type="application/ld+json"> with @type=Article
 */
export function checkSeoCompliance(
  htmlBody: string,
  metadata: {
    primaryKeyword: string
    metaTitle: string
    metaDescription: string
  }
): CheckResult {
  // Guard: reject oversized inputs to prevent ReDoS
  if (htmlBody.length > MAX_HTML_BODY_CHARS) {
    return buildResult(
      Array(8).fill({
        passed: false,
        detail: `HTML body too large: ${htmlBody.length} chars (limit: ${MAX_HTML_BODY_CHARS}). Reduce content size.`,
      })
    )
  }

  const { primaryKeyword, metaTitle, metaDescription } = metadata

  const checks: Array<{ passed: boolean; detail: string }> = [
    checkMetaTitle(metaTitle, primaryKeyword),
    checkMetaDescription(metaDescription),
    checkH1Tag(htmlBody, primaryKeyword),
    checkKeywordDensity(htmlBody, primaryKeyword),
    checkInternalLinks(htmlBody),
    checkImageAlt(htmlBody),
    checkParagraphStructure(htmlBody),
    checkSchemaJsonLd(htmlBody),
  ]

  return buildResult(checks)
}

// ─── GEO Checklist (3 items) ──────────────────────────────────────────────────

/**
 * Run all 3 GEO checks against the provided HTML.
 *
 * Check order (index = position in passed[]):
 *   0 GEO Directive Block — <!-- GEO DIRECTIVE --> … <!-- /GEO DIRECTIVE --> present and non-empty
 *   1 Brand Entity        — brandName appears ≥3× anywhere in HTML (case-insensitive)
 *   2 Weak Query Answered — sourceQueryText core keywords present in body *outside* GEO block
 */
export function checkGeoCompliance(
  htmlBody: string,
  sourceQueryText: string | null,
  brandName: string
): CheckResult {
  // Guard: reject oversized html to prevent ReDoS
  if (htmlBody.length > MAX_HTML_BODY_CHARS) {
    return buildResult(
      Array(3).fill({
        passed: false,
        detail: `HTML body too large: ${htmlBody.length} chars (limit: ${MAX_HTML_BODY_CHARS}). Reduce content size.`,
      })
    )
  }

  // Guard: reject oversized brand name to prevent ReDoS via regex
  if (brandName && brandName.length > MAX_BRAND_NAME_CHARS) {
    return buildResult([
      checkGeoBlock(htmlBody),
      {
        passed: false,
        detail: `Brand name exceeds limit: ${brandName.length} chars (limit: ${MAX_BRAND_NAME_CHARS}).`,
      },
      checkWeakQueryAnswered(
        htmlBody,
        sourceQueryText && sourceQueryText.length <= MAX_QUERY_TEXT_CHARS
          ? sourceQueryText
          : null
      ),
    ])
  }

  // Guard: truncate oversized sourceQueryText instead of rejecting entirely
  const safeQueryText =
    sourceQueryText && sourceQueryText.length > MAX_QUERY_TEXT_CHARS
      ? sourceQueryText.slice(0, MAX_QUERY_TEXT_CHARS)
      : sourceQueryText

  const checks: Array<{ passed: boolean; detail: string }> = [
    checkGeoBlock(htmlBody),
    checkBrandFrequency(htmlBody, brandName),
    checkWeakQueryAnswered(htmlBody, safeQueryText),
  ]

  return buildResult(checks)
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Mode-aware audit that wires SEO + GEO checks according to mode rules:
 *
 *   geo_only — GEO only (seo === undefined); approved iff all GEO pass
 *   seo_only — both SEO + GEO; approved iff all SEO AND all GEO pass
 *   unified  — both SEO + GEO; approved iff all SEO AND all GEO pass
 */
export function auditBlogPost(
  htmlBody: string,
  mode: 'unified' | 'geo_only' | 'seo_only',
  metadata: {
    primaryKeyword: string
    metaTitle: string
    metaDescription: string
    sourceQueryText?: string | null
    brandName: string
  }
): { seo?: CheckResult; geo: CheckResult; approved: boolean } {
  const { primaryKeyword, metaTitle, metaDescription, sourceQueryText = null, brandName } = metadata

  const geo = checkGeoCompliance(htmlBody, sourceQueryText ?? null, brandName)

  if (mode === 'geo_only') {
    const approved = geo.passed.every(Boolean)
    return { geo, approved }
  }

  const seo = checkSeoCompliance(htmlBody, { primaryKeyword, metaTitle, metaDescription })
  const approved = seo.passed.every(Boolean) && geo.passed.every(Boolean)

  return { seo, geo, approved }
}

// ─── SEO Check Implementations ────────────────────────────────────────────────

/**
 * Check 0: Meta Title
 * Must be 50-60 characters and contain the primary keyword (case-insensitive).
 */
function checkMetaTitle(
  title: string,
  keyword: string
): { passed: boolean; detail: string } {
  const len = title.length
  const hasKeyword = title.toLowerCase().includes(keyword.toLowerCase())

  if (len < 50) {
    return { passed: false, detail: `Meta title too short: ${len} chars (need 50-60).` }
  }
  if (len > 60) {
    return { passed: false, detail: `Meta title too long: ${len} chars (need 50-60).` }
  }
  if (!hasKeyword) {
    return { passed: false, detail: `Meta title does not contain the primary keyword "${keyword}".` }
  }
  return { passed: true, detail: `Meta title is ${len} chars and contains the keyword.` }
}

/**
 * Check 1: Meta Description
 * Must be 120-160 characters and contain a recognisable call-to-action phrase.
 *
 * CTA pattern: action verbs commonly used in CTAs.
 */
const CTA_PATTERN = /\b(action|call|book|learn|get|discover|find|try|start|explore|now|today)\b/i

function checkMetaDescription(desc: string): { passed: boolean; detail: string } {
  const len = desc.length

  if (len < 120) {
    return { passed: false, detail: `Meta description too short: ${len} chars (need 120-160).` }
  }
  if (len > 160) {
    return { passed: false, detail: `Meta description too long: ${len} chars (need 120-160).` }
  }
  if (!CTA_PATTERN.test(desc)) {
    return { passed: false, detail: 'Meta description lacks a call-to-action phrase.' }
  }
  return { passed: true, detail: `Meta description is ${len} chars with CTA.` }
}

/**
 * Check 2: H1 Tag
 * Exactly one H1 in the page, containing the keyword (case-insensitive), ≤60 chars.
 */
function checkH1Tag(html: string, keyword: string): { passed: boolean; detail: string } {
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi
  const matches: string[] = []
  let m: RegExpExecArray | null

  while ((m = h1Regex.exec(html)) !== null) {
    // Strip inner tags to get text content
    matches.push(m[1].replace(/<[^>]+>/g, '').trim())
  }

  if (matches.length === 0) {
    return { passed: false, detail: 'No H1 tag found.' }
  }
  if (matches.length > 1) {
    return { passed: false, detail: `Multiple H1 tags found (${matches.length}). Only one is allowed.` }
  }

  const h1Text = matches[0]

  if (h1Text.length > 60) {
    return { passed: false, detail: `H1 is ${h1Text.length} chars (limit: 60).` }
  }
  if (!h1Text.toLowerCase().includes(keyword.toLowerCase())) {
    return { passed: false, detail: `H1 does not contain the primary keyword "${keyword}".` }
  }

  return { passed: true, detail: `H1 is unique, ${h1Text.length} chars, contains keyword.` }
}

/**
 * Check 3: Keyword Density
 * Primary keyword must appear 2-4 times in the full body text.
 * (Density target is 1-2%; we use the count rule as the primary gate.)
 */
function checkKeywordDensity(html: string, keyword: string): { passed: boolean; detail: string } {
  // Strip all HTML tags to get plain text
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  const kw = keyword.toLowerCase()

  let count = 0
  let start = 0
  while ((start = text.indexOf(kw, start)) !== -1) {
    count++
    start += kw.length
  }

  if (count < 2) {
    return { passed: false, detail: `Keyword appears ${count} times (need 2-4).` }
  }
  if (count > 4) {
    return { passed: false, detail: `Keyword appears ${count} times (max 4 — possible over-optimisation).` }
  }
  return { passed: true, detail: `Keyword appears ${count} times.` }
}

/**
 * Check 4: Internal Links
 * At least 3 anchor tags with a href that starts with "/" (relative path) or
 * does not start with "http" (so it's a site-relative link, not external).
 *
 * External links (href starts with "https?://") are excluded from the count.
 */
function checkInternalLinks(html: string): { passed: boolean; detail: string } {
  const anchorRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi
  let count = 0
  let m: RegExpExecArray | null

  while ((m = anchorRegex.exec(html)) !== null) {
    const href = m[1].trim()
    // Count as internal if not an absolute external URL
    if (!href.match(/^https?:\/\//i)) {
      count++
    }
  }

  if (count < 3) {
    return { passed: false, detail: `Only ${count} internal links found (need ≥3).` }
  }
  return { passed: true, detail: `${count} internal links found.` }
}

/**
 * Check 5: Image ALT Text
 * Every <img> tag must have a non-empty, non-whitespace-only alt attribute.
 * If there are no images the check passes vacuously.
 */
function checkImageAlt(html: string): { passed: boolean; detail: string } {
  // Match img tags — use a two-pass approach to be robust against ordering of attributes
  const imgTagRegex = /<img\s[^>]*>/gi
  const altAttrRegex = /\balt=["']([^"']*)["']/i

  let imgCount = 0
  let failCount = 0
  let m: RegExpExecArray | null

  while ((m = imgTagRegex.exec(html)) !== null) {
    imgCount++
    const imgTag = m[0]
    const altMatch = altAttrRegex.exec(imgTag)

    if (!altMatch || altMatch[1].trim() === '') {
      failCount++
    }
  }

  if (imgCount === 0) {
    return { passed: true, detail: 'No images found — vacuously passed.' }
  }
  if (failCount > 0) {
    return {
      passed: false,
      detail: `${failCount} of ${imgCount} images missing a descriptive alt attribute.`,
    }
  }
  return { passed: true, detail: `All ${imgCount} images have alt text.` }
}

/**
 * Check 6: Paragraph Structure
 * At least 5 <p> elements, and none of them exceeds 500 characters (text only).
 */
function checkParagraphStructure(html: string): { passed: boolean; detail: string } {
  const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi
  const paragraphs: string[] = []
  let m: RegExpExecArray | null

  while ((m = paraRegex.exec(html)) !== null) {
    // Strip inner tags
    const text = m[1].replace(/<[^>]+>/g, '').trim()
    paragraphs.push(text)
  }

  if (paragraphs.length < 5) {
    return { passed: false, detail: `Only ${paragraphs.length} paragraphs found (need ≥5).` }
  }

  const tooLong = paragraphs.filter(p => p.length > 500)
  if (tooLong.length > 0) {
    return {
      passed: false,
      detail: `${tooLong.length} paragraph(s) exceed 500 chars (longest: ${Math.max(...tooLong.map(p => p.length))} chars).`,
    }
  }

  return { passed: true, detail: `${paragraphs.length} paragraphs, all ≤500 chars.` }
}

/**
 * Check 7: Schema JSON-LD
 * A <script type="application/ld+json"> must be present and contain "@type":"Article"
 * (allowing for whitespace variations around the colon and quotes).
 */
function checkSchemaJsonLd(html: string): { passed: boolean; detail: string } {
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
  const schemaMatch = scriptRegex.exec(html)

  if (!schemaMatch) {
    return { passed: false, detail: 'No application/ld+json script tag found.' }
  }

  const schemaContent = schemaMatch[1]
  // Accept both "Article" and "BlogPosting" — both are valid Article schema subtypes.
  const hasArticleType = /"@type"\s*:\s*"(?:Article|BlogPosting)"/i.test(schemaContent)

  if (!hasArticleType) {
    return { passed: false, detail: 'Schema found but @type is not "Article" or "BlogPosting".' }
  }

  return { passed: true, detail: 'Article schema JSON-LD is present.' }
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Common English stop words excluded from GEO query keyword matching.
 * These words are too generic to serve as meaningful coverage signals.
 */
const GEO_STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','how','what','why','when','who',
  'do','does','did','will','would','can','could','should','may','might',
  'your','my','our','their','its','this','that','these','those',
  'from','by','about','which','get','have','has','had','not','no','yes',
  'best','top','good','great','most','more','some','many','very',
])

// ─── GEO Check Implementations ────────────────────────────────────────────────

/**
 * Check 0: GEO Directive Block
 * HTML must contain <!-- GEO DIRECTIVE --> … <!-- /GEO DIRECTIVE --> with non-empty content.
 */
function checkGeoBlock(html: string): { passed: boolean; detail: string } {
  const geoBlockRegex = /<!--\s*GEO DIRECTIVE\s*-->([\s\S]*?)<!--\s*\/GEO DIRECTIVE\s*-->/i
  const match = geoBlockRegex.exec(html)

  if (!match) {
    return { passed: false, detail: 'No <!-- GEO DIRECTIVE --> block found.' }
  }

  const content = match[1].trim()
  if (content === '') {
    return { passed: false, detail: 'GEO DIRECTIVE block exists but is empty.' }
  }

  return { passed: true, detail: 'GEO DIRECTIVE block present and non-empty.' }
}

/**
 * Check 1: Brand Entity Frequency
 * Brand name (case-insensitive) must appear ≥3 times anywhere in the full HTML.
 */
function checkBrandFrequency(html: string, brandName: string): { passed: boolean; detail: string } {
  if (!brandName || brandName.trim() === '') {
    return { passed: false, detail: 'Brand name is empty — cannot check frequency.' }
  }

  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const brandRegex = new RegExp(escaped, 'gi')
  const matches = html.match(brandRegex) ?? []
  const count = matches.length

  if (count < 3) {
    return { passed: false, detail: `Brand "${brandName}" appears ${count} times (need ≥3).` }
  }
  return { passed: true, detail: `Brand "${brandName}" appears ${count} times.` }
}

/**
 * Check 2: Weak Query Answered
 * After removing the GEO block, at least one significant word from sourceQueryText
 * must appear in the remaining body text as a whole word (word-boundary match).
 *
 * Returns false if sourceQueryText is null.
 */
function checkWeakQueryAnswered(
  html: string,
  sourceQueryText: string | null
): { passed: boolean; detail: string } {
  if (!sourceQueryText) {
    return { passed: false, detail: 'No source query provided — cannot verify coverage.' }
  }

  // Strip GEO block first
  const bodyWithoutGeo = html
    .replace(/<!--\s*GEO DIRECTIVE\s*-->[\s\S]*?<!--\s*\/GEO DIRECTIVE\s*-->/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()

  // Extract significant query words (length > 3, not stop words)
  const queryWords = sourceQueryText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !GEO_STOP_WORDS.has(w))

  if (queryWords.length === 0) {
    return { passed: false, detail: 'Source query has no significant keywords to verify.' }
  }

  // Use word-boundary regex to avoid partial matches (e.g. "tour" inside "tours")
  const found = queryWords.filter(w => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`).test(bodyWithoutGeo)
  })

  if (found.length === 0) {
    return {
      passed: false,
      detail: `None of the query keywords [${queryWords.join(', ')}] appear in body (outside GEO block).`,
    }
  }

  return {
    passed: true,
    detail: `Query keywords found in body: [${found.join(', ')}].`,
  }
}

// ─── Result Builder ───────────────────────────────────────────────────────────

function buildResult(checks: Array<{ passed: boolean; detail: string }>): CheckResult {
  const passed = checks.map(c => c.passed)
  const details = checks.map(c => c.detail)
  const passedChecks = passed.filter(Boolean).length
  const totalChecks = passed.length

  return {
    passed,
    details,
    summary: {
      totalChecks,
      passedChecks,
      failureRate: totalChecks === 0 ? 0 : (totalChecks - passedChecks) / totalChecks,
    },
  }
}
