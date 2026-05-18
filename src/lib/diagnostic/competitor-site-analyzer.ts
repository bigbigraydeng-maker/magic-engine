/**
 * P8.10.S2.2 — Competitor site signal extractor.
 *
 * Fetches a domain's homepage via Jina Reader and extracts lightweight signals
 * (USP candidates / CTA count / landing page type / category depth) that feed
 * the competitor diagnostic and downstream Synthesis layer.
 *
 * Parsing is heuristic-only — no LLM call here to keep the per-competitor cost
 * effectively zero. Deeper semantic analysis happens in S3 (Synthesis).
 */

import { fetchUrlAsMarkdown } from '@/lib/brief/jina'

export type LandingPageType = 'homepage' | 'product' | 'service' | 'blog' | 'unknown'

export interface CompetitorSiteSignals {
  domain: string
  fetched_at: string
  usp_candidates: string[]   // first 3 H1/H2 lines, treated as value-prop signals
  cta_count: number          // markdown links whose anchor text contains a conversion verb
  cta_examples: string[]     // up to 5 sample CTA anchor texts
  landing_page_type: LandingPageType
  category_depth: number     // distinct top-level nav category links (heuristic: links in first 3000 chars)
  word_count: number
}

// CTA verb whitelist — kept short and AU/NZ-aware (e.g. "enquire" preferred over "inquire")
const CTA_VERBS = [
  'buy', 'shop', 'order', 'book', 'contact', 'enquire', 'inquire', 'quote',
  'get started', 'sign up', 'subscribe', 'request', 'schedule', 'download',
  'free trial', 'try', 'demo', 'call us', 'learn more',
]

const CATEGORY_DEPTH_SCAN_CHARS = 3000  // first slice of markdown captures nav

export async function analyzeCompetitorSite(
  domain: string,
): Promise<CompetitorSiteSignals | null> {
  const url = domain.startsWith('http') ? domain : `https://${domain}`
  let fetched: Awaited<ReturnType<typeof fetchUrlAsMarkdown>>
  try {
    fetched = await fetchUrlAsMarkdown(url)
  } catch {
    return null
  }
  return parseSignals(domain, fetched.markdown)
}

export function parseSignals(domain: string, markdown: string): CompetitorSiteSignals {
  const headings = extractHeadings(markdown)
  const ctas = extractCtas(markdown)
  const categoryDepth = countTopLevelNavLinks(markdown.slice(0, CATEGORY_DEPTH_SCAN_CHARS))
  const wordCount = markdown.split(/\s+/).filter(Boolean).length

  return {
    domain,
    fetched_at: new Date().toISOString(),
    usp_candidates: headings.slice(0, 3),
    cta_count: ctas.length,
    cta_examples: ctas.slice(0, 5),
    landing_page_type: classifyLandingPage(markdown, headings),
    category_depth: categoryDepth,
    word_count: wordCount,
  }
}

function extractHeadings(markdown: string): string[] {
  const out: string[] = []
  const re = /^#{1,2}\s+(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    const text = match[1].trim().replace(/\[(.+?)\]\([^)]+\)/g, '$1')
    if (text.length >= 3 && text.length <= 140) out.push(text)
  }
  return out
}

function extractCtas(markdown: string): string[] {
  const ctas: string[] = []
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(markdown)) !== null) {
    const anchor = match[1].trim().toLowerCase()
    if (anchor.length === 0 || anchor.length > 60) continue
    if (CTA_VERBS.some(v => anchor.includes(v))) ctas.push(match[1].trim())
  }
  return ctas
}

function countTopLevelNavLinks(slice: string): number {
  const seen = new Set<string>()
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(slice)) !== null) {
    const anchor = match[1].trim().toLowerCase()
    // Skip empty / very long / pure-icon anchors
    if (anchor.length < 2 || anchor.length > 40) continue
    seen.add(anchor)
  }
  return seen.size
}

function classifyLandingPage(markdown: string, headings: string[]): LandingPageType {
  const lower = markdown.toLowerCase()
  const headingText = headings.join(' ').toLowerCase()
  if (/add to cart|in stock|sku|product code|\$\d/.test(lower)) return 'product'
  if (/our services|what we do|services we offer/.test(headingText)) return 'service'
  if (/blog|article|posted on|read more|by\s+\w+\s+on/.test(lower) && lower.split('blog').length > 3) return 'blog'
  if (headings.length >= 3 && lower.length > 1500) return 'homepage'
  return 'unknown'
}
