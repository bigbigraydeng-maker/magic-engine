/**
 * DataForSEO SERP API — AI Overview + organic + paid results.
 *
 * Reference: ROADMAP.md P8.13.D.1
 *
 * Replaces the Apify google-search-scraper (src/lib/apify/google-search-scraper.ts)
 * as the primary SERP source. Apify is preserved as a fallback for the case
 * where DataForSEO credentials are unavailable.
 *
 * Returns the same shape as DiscoveredSerpResult so existing types / UI are
 * unaffected by the source swap.
 *
 * Authentication: Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD).
 *
 * Estimated cost: ~$0.005 per call (same as Apify).
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// AU=2036, NZ=2554
const LOCATION_CODE: Record<'au' | 'nz', number> = { au: 2036, nz: 2554 }

// ─── Return type ─────────────────────────────────────────────────────────────

/** Shape matches DiscoveredSerpResult in zhangqian/types.ts. */
export interface DfseSerpResult {
  query:                   string
  organic_results:         Array<{
    position:    number
    title:       string
    url:         string
    description: string
  }>
  paid_advertiser_domains: string[]
  ai_overview_text:        string | null
  ai_overview_sources:     string[]
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader(): string {
  const login    = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch a Google SERP page via DataForSEO: organic results, paid advertisers,
 * and the Google AI Overview answer.
 *
 * DataForSEO endpoint: /serp/google/organic/live/advanced
 *
 * @param query       Search term, e.g. "vinyl flooring brisbane"
 * @param countryCode 'au' (default) or 'nz'
 */
export async function getSerpPage(
  query: string,
  countryCode: 'au' | 'nz' = 'au',
): Promise<DfseSerpResult> {
  const locationCode = LOCATION_CODE[countryCode]

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          keyword:       query,
          location_code: locationCode,
          language_code: 'en',
          depth:         10,
          se_domain:     countryCode === 'nz' ? 'google.co.nz' : 'google.com.au',
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO SERP error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          type?:                  string
          rank_absolute?:         number
          title?:                 string | null
          url?:                   string | null
          description?:           string | null
          domain?:                string | null
          ai_overview?: {
            text?:         string | null
            references?: Array<{
              url?:   string | null
              title?: string | null
            }>
          } | null
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  const organicResults = items
    .filter(it => it.type === 'organic')
    .slice(0, 10)
    .map(it => ({
      position:    it.rank_absolute ?? 0,
      title:       it.title        ?? '',
      url:         it.url          ?? '',
      description: it.description  ?? '',
    }))

  const paidDomains = Array.from(new Set(
    items
      .filter(it => it.type === 'paid')
      .map(it => it.domain ?? '')
      .filter(Boolean),
  ))

  const aiItem = items.find(it => it.type === 'ai_overview')
  const aiOverviewText    = aiItem?.ai_overview?.text ?? null
  const aiOverviewSources = (aiItem?.ai_overview?.references ?? [])
    .map(r => r.url ?? '')
    .filter(Boolean)

  return {
    query,
    organic_results:         organicResults,
    paid_advertiser_domains: paidDomains,
    ai_overview_text:        aiOverviewText,
    ai_overview_sources:     aiOverviewSources,
  }
}
