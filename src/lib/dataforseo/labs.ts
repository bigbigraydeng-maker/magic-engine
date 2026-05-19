/**
 * DataForSEO Labs API — keyword intelligence + competitor discovery.
 *
 * Reference: ROADMAP.md P8.13.A.1
 *
 * Replaces Claude web_search guessing for:
 *   - Seed keyword discovery (Keywords For Site)
 *   - Competitor domain discovery (Competitors Domain)
 *   - Competitor traffic enrichment (Bulk Traffic Estimation)
 *
 * Authentication: Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD) —
 * same credentials as src/lib/dataforseo/client.ts, no new env vars required.
 *
 * Default location: AU (2036). Pass location_code 2554 for NZ.
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// AU=2036, NZ=2554  (matches client.ts LOCATION_CODE_BY_DB)
const DEFAULT_LOCATION_CODE = 2036
const DEFAULT_LANGUAGE_CODE = 'en'

// ─── Return types ─────────────────────────────────────────────────────────────

export interface LabsKeyword {
  keyword: string
  /** Monthly search volume (Google, location-specific). null = no data */
  search_volume: number | null
  /** Keyword difficulty 0–100 (higher = harder to rank). null = no data */
  keyword_difficulty: number | null
  /** Cost-per-click in USD. null = no data */
  cpc: number | null
  /** Competition density 0–1 (paid search competition). null = no data */
  competition: number | null
}

export interface LabsCompetitor {
  /** Competitor domain, no protocol/trailing slash */
  domain: string
  /** Average organic position across intersecting keywords */
  avg_position: number | null
  /** Number of shared keywords with the target */
  intersections: number
  /** Estimated monthly organic traffic (ETV) */
  monthly_traffic: number | null
  /** Number of organic ranking keywords */
  keyword_count: number | null
}

export interface BulkTrafficResult {
  domain: string
  /** Estimated monthly organic traffic (ETV). null = no data */
  monthly_traffic: number | null
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader(): string {
  const login    = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch the top organic keywords that a domain ranks for.
 *
 * DataForSEO endpoint: /dataforseo_labs/google/keywords_for_site/live
 *
 * @param domain        Target domain, e.g. "oztop.com.au"
 * @param locationCode  DataForSEO location_code (default 2036 = AU)
 * @param limit         Max keywords to return (default 50, max 1000)
 */
export async function getKeywordsForSite(
  domain: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
  limit: number = 50,
): Promise<LabsKeyword[]> {
  const res = await fetch(`${DATAFORSEO_API_BASE}/dataforseo_labs/google/keywords_for_site/live`, {
    method:  'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        target:         domain,
        location_code:  locationCode,
        language_code:  DEFAULT_LANGUAGE_CODE,
        limit,
        order_by:       ['keyword_info.search_volume,desc'],
      },
    ]),
  })

  if (!res.ok) throw new Error(`DataForSEO Labs keywords_for_site error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          keyword_data?: {
            keyword?: string
            keyword_info?: {
              search_volume?: number | null
              cpc?:           number | null
              competition?:   number | null
            }
            keyword_difficulty?: number | null
          }
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(it => it.keyword_data?.keyword)
    .map(it => {
      const kd = it.keyword_data!
      return {
        keyword:            kd.keyword ?? '',
        search_volume:      kd.keyword_info?.search_volume ?? null,
        keyword_difficulty: kd.keyword_difficulty ?? null,
        cpc:                kd.keyword_info?.cpc ?? null,
        competition:        kd.keyword_info?.competition ?? null,
      }
    })
}

/**
 * Discover organic competitor domains for a target site.
 *
 * DataForSEO endpoint: /dataforseo_labs/google/competitors_domain/live
 *
 * @param domain        Target domain, e.g. "oztop.com.au"
 * @param locationCode  DataForSEO location_code (default 2036 = AU)
 * @param limit         Max competitors to return (default 10, max 1000)
 */
export async function getSerpCompetitors(
  domain: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
  limit: number = 10,
): Promise<LabsCompetitor[]> {
  const res = await fetch(`${DATAFORSEO_API_BASE}/dataforseo_labs/google/competitors_domain/live`, {
    method:  'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        target:        domain,
        location_code: locationCode,
        language_code: DEFAULT_LANGUAGE_CODE,
        limit,
      },
    ]),
  })

  if (!res.ok) throw new Error(`DataForSEO Labs competitors_domain error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          domain?:       string
          avg_position?: number | null
          intersections?: number
          metrics?: {
            organic?: {
              etv?:   number | null
              count?: number | null
            }
          }
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(it => it.domain && it.domain !== domain)
    .map(it => ({
      domain:          it.domain ?? '',
      avg_position:    it.avg_position ?? null,
      intersections:   it.intersections ?? 0,
      monthly_traffic: it.metrics?.organic?.etv ?? null,
      keyword_count:   it.metrics?.organic?.count ?? null,
    }))
}

/**
 * Bulk-fetch estimated organic traffic for a list of competitor domains.
 * Useful for enriching competitor entries discovered by other means.
 *
 * DataForSEO endpoint: /dataforseo_labs/google/bulk_traffic_estimation/live
 *
 * @param domains       Up to 1000 domain strings
 * @param locationCode  DataForSEO location_code (default 2036 = AU)
 */
export async function getBulkTrafficEstimation(
  domains: string[],
  locationCode: number = DEFAULT_LOCATION_CODE,
): Promise<BulkTrafficResult[]> {
  if (domains.length === 0) return []

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/bulk_traffic_estimation/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          targets:       domains,
          location_code: locationCode,
          language_code: DEFAULT_LANGUAGE_CODE,
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO Labs bulk_traffic_estimation error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        target?:  string
        metrics?: {
          organic?: { etv?: number | null }
        }
      }>
    }>
  }

  const results = json.tasks?.[0]?.result ?? []

  return results
    .filter(r => r.target)
    .map(r => ({
      domain:          r.target ?? '',
      monthly_traffic: r.metrics?.organic?.etv ?? null,
    }))
}
