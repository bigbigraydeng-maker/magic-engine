/**
 * Local directory competitor discovery connector — client.
 *
 * Reference: ROADMAP.md P8.12.S3.5
 *
 * Scrapes two AU-focused business directories via Jina Reader:
 *  - Yellow Pages AU  → fetchUrlAsMarkdown (no extra key)
 *  - Localsearch.com.au → fetchUrlAsMarkdown (no extra key)
 *
 * Design:
 *  - Pure functions exported for testability (buildYellowPagesUrl, buildLocalsearchUrl,
 *    parseDirectoryMarkdown).
 *  - discoverLocalCompetitors is non-fatal: each source is settled independently.
 *  - Parsing is best-effort (Jina markdown structure varies); fields not found are null.
 */

import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import type { DirectoryEntry, DirectorySearchResult, DirectorySource } from './types'

// ─── URL builders ─────────────────────────────────────────────────────────────

export function buildYellowPagesUrl(industry: string, location: string): string {
  const params = new URLSearchParams({
    clue: industry.trim(),
    locationClue: location.trim().replace(/,/g, ''),
  })
  return `https://www.yellowpages.com.au/search/listings?${params}`
}

export function buildLocalsearchUrl(industry: string, location: string): string {
  const slug = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/,/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
  return `https://www.localsearch.com.au/find/${slug(industry)}/${slug(location)}/`
}

// ─── Field extractors ─────────────────────────────────────────────────────────

// AU landlines: 0X XXXX XXXX | mobiles: 04XX XXX XXX
const AU_PHONE_RE =
  /\b(0[2-9][\s-]?\d{4}[\s-]?\d{4}|04\d{2}[\s-]?\d{3}[\s-]?\d{3})\b/

function extractPhone(text: string): string | null {
  const m = text.match(AU_PHONE_RE)
  return m ? m[1].replace(/[\s-]/g, ' ').trim() : null
}

function extractRating(text: string): number | null {
  const m =
    text.match(/([0-5](?:\.\d)?)\s*(?:out of 5|\/\s*5)/i) ||
    text.match(/([0-5](?:\.\d)?)\s*(?:stars?|★)/i) ||
    text.match(/(?:★|⭐)\s*([0-5](?:\.\d)?)/) ||
    text.match(/([0-5](?:\.\d)?)\s*⭐/) ||
    text.match(/\brating[:\s]+([0-5](?:\.\d)?)/i) ||
    // "4.8 (89 ratings)" or "4.8 (89 reviews)" — no trailing keyword on the number itself
    text.match(/([0-5]\.\d)\s*\([\d,]+\s*(?:reviews?|ratings?)/i)
  if (!m) return null
  const v = parseFloat(m[1])
  return Number.isFinite(v) && v >= 0 && v <= 5 ? v : null
}

function extractReviewCount(text: string): number | null {
  const m = text.match(/([\d,]+)\s+(?:reviews?|ratings?)\b/i)
  if (!m) return null
  const v = parseInt(m[1].replace(/,/g, ''), 10)
  return Number.isFinite(v) ? v : null
}

const AU_STATES_RE = /\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/

function extractAddress(text: string): string | null {
  for (const line of text.split('\n')) {
    // Strip common icon/markdown prefixes
    const cleaned = line.replace(/^[\s*_>#+\-📍✅☎️☎📞]+/, '').trim()
    if (AU_STATES_RE.test(cleaned) && cleaned.length > 5 && cleaned.length < 150) {
      return cleaned
    }
  }
  return null
}

// ─── Markdown parser ──────────────────────────────────────────────────────────

// Navigation/UI headings that appear as H2/H3 in directory pages but aren't listings
const NAV_HEADING_RE =
  /^(home|about|contact|search|results|sign in|log in|find|categories|filter|sort|showing|advertisement)/i

/**
 * Parse Jina-scraped directory markdown into business entries.
 *
 * Splits on H2/H3 headings — each section is assumed to be one listing.
 * The first block (page header/nav before the first H2/H3) is always skipped.
 *
 * Exported for unit-testing.
 */
export function parseDirectoryMarkdown(
  markdown: string,
  source: DirectorySource,
  sourceUrl: string,
): DirectoryEntry[] {
  const entries: DirectoryEntry[] = []

  // Split on "## " or "### " at the start of a line
  const blocks = markdown.split(/^#{2,3}\s+/m)

  for (const block of blocks.slice(1)) {
    const lines = block
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
    if (!lines.length) continue

    // First line is the heading — strip Markdown link syntax [Name](url) → Name
    const rawName = lines[0]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[#*_`]/g, '')
      .trim()

    if (!rawName || rawName.length < 2) continue
    if (NAV_HEADING_RE.test(rawName)) continue

    const blockText = lines.join('\n')

    entries.push({
      name: rawName,
      phone: extractPhone(blockText),
      address: extractAddress(blockText),
      rating: extractRating(blockText),
      reviewCount: extractReviewCount(blockText),
      sourceUrl,
      source,
    })

    if (entries.length >= 20) break
  }

  return entries
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function normaliseKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function deduplicateEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  const seen = new Set<string>()
  return entries.filter(e => {
    const key = normaliseKey(e.name)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── High-level wrapper ───────────────────────────────────────────────────────

/**
 * Discover local competitors from Yellow Pages AU + Localsearch.com.au.
 *
 * Non-fatal by design: each source is settled independently so one blocked
 * page never prevents results from the other. Returns empty entries (not throw)
 * when both fail.
 *
 * @param industry  Category in English, e.g. "travel agent", "plumber".
 * @param location  Location in English, e.g. "Sydney NSW", "Melbourne VIC".
 * @param limit     Max entries to return (1–20, default 8).
 */
export async function discoverLocalCompetitors(
  industry: string,
  location: string,
  limit = 8,
): Promise<DirectorySearchResult> {
  const cap = Math.min(Math.max(1, limit), 20)
  const ypUrl = buildYellowPagesUrl(industry, location)
  const lsUrl = buildLocalsearchUrl(industry, location)
  const fetchedAt = new Date().toISOString()

  const [ypResult, lsResult] = await Promise.allSettled([
    fetchUrlAsMarkdown(ypUrl),
    fetchUrlAsMarkdown(lsUrl),
  ])

  const entries: DirectoryEntry[] = []
  const sources: Array<{ url: string; fetched_at: string }> = []

  if (ypResult.status === 'fulfilled') {
    sources.push({ url: ypUrl, fetched_at: fetchedAt })
    entries.push(
      ...parseDirectoryMarkdown(ypResult.value.markdown, 'yellowpages_au', ypUrl),
    )
  } else {
    console.error('[local-directory] Yellow Pages fetch failed', ypResult.reason)
  }

  if (lsResult.status === 'fulfilled') {
    sources.push({ url: lsUrl, fetched_at: fetchedAt })
    entries.push(
      ...parseDirectoryMarkdown(lsResult.value.markdown, 'localsearch', lsUrl),
    )
  } else {
    console.error('[local-directory] Localsearch fetch failed', lsResult.reason)
  }

  return {
    entries: deduplicateEntries(entries).slice(0, cap),
    query: { industry, location },
    sources,
    fetchedAt,
  }
}
