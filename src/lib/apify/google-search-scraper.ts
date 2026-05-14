/**
 * Apify Google Search Results scraper wrapper.
 *
 * Reference: ROADMAP.md P8.12.S1.6c
 *
 * Scrapes a Google SERP for one query via the apify/google-search-scraper
 * actor — organic ranking, paid advertiser domains, and the Google AI Mode
 * answer (the latter feeds Zhangqian's "AI visibility" diagnosis dimension).
 *
 * Design mirrors src/lib/apify/social-scraper.ts: credentials read at call
 * time, low-level fetcher throws on transport errors; the Zhangqian tool
 * handler wraps this and degrades non-fatally.
 */

const APIFY_BASE = 'https://api.apify.com/v2'

export interface SerpOrganicResult {
  position: number
  title: string
  url: string
  description: string
}

export interface SerpResult {
  query: string
  /** Top organic results for the query (capped at 10). */
  organic_results: SerpOrganicResult[]
  /** Distinct domains that ran paid ads for this query. */
  paid_advertiser_domains: string[]
  /** Google AI Mode answer text; null when Google did not surface one. */
  ai_overview_text: string | null
  /** Source URLs cited in the AI Mode answer. */
  ai_overview_sources: string[]
}

type RawRecord = Record<string, unknown>

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function parseOrganic(raw: unknown): SerpOrganicResult[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 10).map((r) => {
    const o = r as RawRecord
    return {
      position: typeof o.position === 'number' ? o.position : 0,
      title: asString(o.title),
      url: asString(o.url),
      description: asString(o.description),
    }
  })
}

function parsePaidDomains(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const domains = raw
    .map((r) => asString((r as RawRecord).displayedUrl))
    .filter((d) => d.length > 0)
  return Array.from(new Set(domains))
}

function parseAiSources(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((s) => asString((s as RawRecord).url))
    .filter((u) => u.length > 0)
}

/**
 * Scrape one Google SERP. Throws on transport/HTTP errors.
 *
 * @param query        the search term
 * @param countryCode  'au' or 'nz' — picks the Google search domain
 */
export async function scrapeGoogleSerp(
  query: string,
  countryCode: 'au' | 'nz' = 'au',
): Promise<SerpResult> {
  const token = process.env.APIFY_API_KEY
  if (!token) throw new Error('APIFY_API_KEY not configured')

  const res = await fetch(
    `${APIFY_BASE}/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${token}&timeout=90`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        queries: query,
        countryCode,
        resultsPerPage: 10,
        maxPagesPerQuery: 1,
      }),
    },
  )

  if (!res.ok) throw new Error(`Apify Google Search error: ${res.status}`)

  const items = (await res.json()) as RawRecord[]
  const page = items[0] ?? {}
  const aiMode = page.aiModeResult as RawRecord | undefined

  return {
    query,
    organic_results: parseOrganic(page.organicResults),
    paid_advertiser_domains: parsePaidDomains(page.paidResults),
    ai_overview_text: aiMode && typeof aiMode.text === 'string' ? aiMode.text : null,
    ai_overview_sources: parseAiSources(aiMode?.sources),
  }
}
