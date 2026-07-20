/**
 * Job-board scrapers — reuse the existing Apify wrapper (src/lib/apify/client).
 *
 * Phase 1 ships Seek (seek.co.nz) via the bovi/seek-jobs-scraper actor, proven
 * on live data. Indeed and TradeMe are stubbed source-extensibly and return []
 * until their actors are wired — the ingest pipeline is already board-agnostic.
 */

import { runActorAndGetResults } from '@/lib/apify/client'
import type { JobBoard, JobPosting } from './types'

// bovi/seek-jobs-scraper — zero-auth Seek v5 search API wrapper. Actor id (hash)
// is stable; the username~name slug ("bovi~seek-jobs-scraper") also resolves.
const SEEK_ACTOR_ID = 'vewdUX0xT82kKEPPd'
const SEEK_TIMEOUT_MS = 90_000

/** Raw Seek dataset item shape (subset we consume). */
interface SeekItem {
  company?: string | null
  title?: string | null
  location?: string | null
  classification?: string | null
  url?: string | null
  listing_date?: string | null
}

function toPosting(item: SeekItem, keyword: string): JobPosting | null {
  const company = item.company?.trim()
  const title = item.title?.trim()
  if (!company || !title) return null
  return {
    board:          'seek',
    company,
    title,
    location_raw:   item.location?.trim() ?? '',
    classification: item.classification?.trim() ?? null,
    url:            item.url ?? null,
    posted_at:      item.listing_date ?? null,
    keyword_matched: keyword,
  }
}

/**
 * Scrape one Seek search for NZ marketing-type roles. `maxItems` caps billed
 * results (each ~$0.001). Never throws — a failed run returns [] and is logged
 * by the caller so one bad board can't sink the whole ingest.
 */
export async function scrapeSeek(keywords: string[], maxItems: number): Promise<JobPosting[]> {
  const result = await runActorAndGetResults<SeekItem>(
    SEEK_ACTOR_ID,
    {
      searchQueries: keywords,
      siteKey: 'NZ-Main',
      where: 'All New Zealand',
      maxItems,
      includeDescriptions: false,
    },
    SEEK_TIMEOUT_MS,
  )
  if (!result.success) {
    console.error(`[job-boards/seek] scrape failed: ${result.error ?? 'unknown'}`)
    return []
  }
  // Tag each row with the first keyword that plausibly matches its title, else
  // the search's first term — good enough for provenance; exact per-query
  // attribution isn't worth a query-per-keyword cost blow-up.
  return result.data
    .map(item => {
      const kw = keywords.find(k => (item.title ?? '').toLowerCase().includes(k)) ?? keywords[0] ?? ''
      return toPosting(item, kw)
    })
    .filter((p): p is JobPosting => p !== null)
}

/** Placeholder — Indeed actor not yet wired (Phase 1 = Seek only). */
export async function scrapeIndeed(_keywords: string[], _maxItems: number): Promise<JobPosting[]> {
  return []
}

/** Placeholder — TradeMe Jobs actor not yet wired (Phase 1 = Seek only). */
export async function scrapeTradeMe(_keywords: string[], _maxItems: number): Promise<JobPosting[]> {
  return []
}

export const BOARD_SCRAPERS: Record<JobBoard, (keywords: string[], maxItems: number) => Promise<JobPosting[]>> = {
  seek:    scrapeSeek,
  indeed:  scrapeIndeed,
  trademe: scrapeTradeMe,
}
