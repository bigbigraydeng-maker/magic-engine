/**
 * Local directory competitor discovery connector — type definitions.
 *
 * Reference: ROADMAP.md P8.12.S3.5
 *
 * Discovers local business competitors from two AU-focused directories:
 *  - Yellow Pages AU  (https://www.yellowpages.com.au)
 *  - Localsearch.com.au (https://www.localsearch.com.au)
 *
 * Both are scraped via Jina Reader (no additional API key required).
 * Parsing is best-effort; fields not extractable from markdown are null.
 */

export type DirectorySource = 'yellowpages_au' | 'localsearch'

/** One business listing extracted from a directory search result. */
export interface DirectoryEntry {
  name: string
  phone: string | null
  address: string | null
  /** Overall star rating (1–5), or null if not found. */
  rating: number | null
  reviewCount: number | null
  /** URL of the directory search page this entry came from. */
  sourceUrl: string
  source: DirectorySource
}

/** Aggregated result from one or both directory sources. */
export interface DirectorySearchResult {
  entries: DirectoryEntry[]
  query: { industry: string; location: string }
  /** Which source URLs were successfully fetched. */
  sources: Array<{ url: string; fetched_at: string }>
  fetchedAt: string
}
