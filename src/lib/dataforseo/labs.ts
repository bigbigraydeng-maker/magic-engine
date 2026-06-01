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
  /** Search intent — derived from CPC when not provided by API.
   *  'informational' | 'navigational' | 'commercial' | 'transactional' */
  intent: string
  /** Organic rank position when returned by ranked-keywords endpoints */
  position?: number | null
}

export interface DomainTrendPoint {
  /** 'YYYY-MM' format */
  month: string
  organic_traffic: number
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
      const cpc = kd.keyword_info?.cpc ?? null
      return {
        keyword:            kd.keyword ?? '',
        search_volume:      kd.keyword_info?.search_volume ?? null,
        keyword_difficulty: kd.keyword_difficulty ?? null,
        cpc,
        competition:        kd.keyword_info?.competition ?? null,
        intent:             deriveIntent(cpc),
        position:           null,
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

// ─── Keyword volume + ideas (replaces SEMrush batchKeywordOverview / getRelatedKeywords) ──

/**
 * Batch search volume + difficulty for a list of keywords.
 * Replaces: SEMrush batchKeywordOverview
 *
 * DataForSEO endpoint: /dataforseo_labs/google/bulk_keyword_search_volume/live
 *
 * @param keywords     Up to 1 000 keywords
 * @param locationCode DataForSEO location_code (default 2036 = AU)
 */
export async function bulkKeywordVolume(
  keywords: string[],
  locationCode: number = DEFAULT_LOCATION_CODE,
): Promise<LabsKeyword[]> {
  if (keywords.length === 0) return []

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/bulk_keyword_search_volume/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          keywords:      keywords,
          location_code: locationCode,
          language_code: DEFAULT_LANGUAGE_CODE,
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO bulk_keyword_search_volume error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          keyword?:            string
          keyword_info?: {
            search_volume?: number | null
            cpc?:           number | null
            competition?:   number | null
          }
          keyword_difficulty?: number | null
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(it => it.keyword)
    .map(it => {
      const cpc = it.keyword_info?.cpc ?? null
      return {
        keyword:            it.keyword ?? '',
        search_volume:      it.keyword_info?.search_volume ?? null,
        keyword_difficulty: it.keyword_difficulty ?? null,
        cpc,
        competition:        it.keyword_info?.competition ?? null,
        intent:             deriveIntent(cpc),
        position:           null,
      }
    })
}

/**
 * Keyword ideas for a seed term — related keywords with volume, difficulty, CPC.
 * Replaces: SEMrush getRelatedKeywords + getQuestionKeywords
 *
 * DataForSEO endpoint: /dataforseo_labs/google/keyword_ideas/live
 *
 * @param seed         Seed keyword, e.g. "vinyl flooring"
 * @param locationCode DataForSEO location_code (default 2036 = AU)
 * @param limit        Max keywords to return (default 50)
 * @param questionsOnly If true, filters for question-form keywords (who/what/how…)
 */
export async function getKeywordIdeas(
  seed: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
  limit: number = 50,
  questionsOnly = false,
): Promise<LabsKeyword[]> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/keyword_ideas/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          keyword:       seed,
          location_code: locationCode,
          language_code: DEFAULT_LANGUAGE_CODE,
          limit,
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO keyword_ideas error: ${res.status}`)

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

  const QUESTION_STARTERS = /^(who|what|where|when|why|how|can|is|are|does|do|will|should|which)\b/i

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(it => it.keyword_data?.keyword)
    .filter(it => !questionsOnly || QUESTION_STARTERS.test(it.keyword_data!.keyword!))
    .map(it => {
      const kd  = it.keyword_data!
      const cpc = kd.keyword_info?.cpc ?? null
      return {
        keyword:            kd.keyword ?? '',
        search_volume:      kd.keyword_info?.search_volume ?? null,
        keyword_difficulty: kd.keyword_difficulty ?? null,
        cpc,
        competition:        kd.keyword_info?.competition ?? null,
        intent:             deriveIntent(cpc),
        position:           null,
      }
    })
}

// ─── Keyword gap (replaces SEMrush getKeywordGap) ───────────────────────────

/**
 * Find keywords where competitors rank but the client does not.
 * Replaces: SEMrush getKeywordGap
 *
 * DataForSEO Labs has no dedicated keyword-gap endpoint. This uses
 * /dataforseo_labs/google/domain_intersection/live with intersections:false,
 * which returns keywords target1 ranks for but target2 does not — i.e. the gap.
 * One call per competitor (target1 = competitor, target2 = client), run in
 * parallel; results are merged, de-duplicated by keyword, and sorted by volume.
 *
 * @param clientDomain       Primary domain to find gaps for
 * @param competitorDomains  Competitor domains to compare against
 * @param locationCode       DataForSEO location_code (default 2036 = AU)
 * @param limit              Max gap keywords to return (default 100)
 */
export async function getKeywordsGap(
  clientDomain: string,
  competitorDomains: string[],
  locationCode: number = DEFAULT_LOCATION_CODE,
  limit: number = 100,
): Promise<LabsKeyword[]> {
  if (competitorDomains.length === 0) return []

  const perCompetitor = await Promise.allSettled(
    competitorDomains.map(competitor =>
      fetchDomainIntersectionGap(competitor, clientDomain, locationCode, limit),
    ),
  )

  // Merge competitor results, keeping the highest-volume entry per keyword.
  const byKeyword = new Map<string, LabsKeyword>()
  for (const settled of perCompetitor) {
    if (settled.status !== 'fulfilled') continue
    for (const kw of settled.value) {
      const existing = byKeyword.get(kw.keyword)
      if (!existing || (kw.search_volume ?? 0) > (existing.search_volume ?? 0)) {
        byKeyword.set(kw.keyword, kw)
      }
    }
  }

  return Array.from(byKeyword.values())
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
    .slice(0, limit)
}

/**
 * One competitor-vs-client gap query via the domain_intersection endpoint.
 * intersections:false → keywords the competitor (target1) ranks for but the
 * client (target2) does not. Restricted to organic SERP results.
 */
async function fetchDomainIntersectionGap(
  competitorDomain: string,
  clientDomain: string,
  locationCode: number,
  limit: number,
): Promise<LabsKeyword[]> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/domain_intersection/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          target1:       competitorDomain,
          target2:       clientDomain,
          location_code: locationCode,
          language_code: DEFAULT_LANGUAGE_CODE,
          intersections: false,
          item_types:    ['organic'],
          limit,
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO domain_intersection error: ${res.status}`)

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
            keyword_properties?: {
              keyword_difficulty?: number | null
            }
          }
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(it => it.keyword_data?.keyword)
    .filter(it => (it.keyword_data!.keyword_info?.search_volume ?? 0) > 0)
    .map(it => {
      const kd  = it.keyword_data!
      const cpc = kd.keyword_info?.cpc ?? null
      return {
        keyword:            kd.keyword ?? '',
        search_volume:      kd.keyword_info?.search_volume ?? null,
        keyword_difficulty: kd.keyword_properties?.keyword_difficulty ?? null,
        cpc,
        competition:        kd.keyword_info?.competition ?? null,
        intent:             deriveIntent(cpc),
        position:           null,
      }
    })
}

// ─── Domain traffic history (replaces SEMrush getDomainTrafficTrend) ─────────

/**
 * Monthly organic traffic estimates over a rolling window.
 * Replaces: SEMrush getDomainTrafficTrend
 *
 * DataForSEO endpoint: /dataforseo_labs/google/historical_rank_overview/live
 *
 * @param domain       Target domain, e.g. "oztop.com.au"
 * @param locationCode DataForSEO location_code (default 2036 = AU)
 * @param months       How many months to fetch (default 12, max 24)
 */
export async function getDomainTrafficHistory(
  domain: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
  months: number = 12,
): Promise<DomainTrendPoint[]> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/historical_rank_overview/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          target:        domain,
          location_code: locationCode,
          language_code: DEFAULT_LANGUAGE_CODE,
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO historical_rank_overview error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        target?: string
        items?:  Array<{
          date?:    string
          metrics?: { organic?: { etv?: number | null } }
        }>
      }>
    }>
  }

  const result = json.tasks?.[0]?.result?.[0]
  if (!result?.items) return []

  const points = result.items
    .filter(item => item.date)
    .map(item => ({
      month:           item.date!.slice(0, 7),   // "YYYY-MM-DD ..." → "YYYY-MM"
      organic_traffic: Math.round(item.metrics?.organic?.etv ?? 0),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return points.slice(-Math.min(months, 24))
}

// ─── Ranked keywords (organic positions for a domain) ────────────────────────

/**
 * Fetch keywords a domain currently ranks for, with organic position data.
 *
 * DataForSEO endpoint: /dataforseo_labs/google/ranked_keywords/live
 *
 * @param domain        Target domain, e.g. "ctours.com.au"
 * @param locationCode  DataForSEO location_code (default 2036 = AU)
 * @param limit         Max keywords to return (default 200)
 */
export async function getRankedKeywords(
  domain: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
  limit: number = 200,
): Promise<LabsKeyword[]> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/ranked_keywords/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          target:        domain,
          location_code: locationCode,
          language_code: DEFAULT_LANGUAGE_CODE,
          limit,
          filters: [['ranked_serp_element.serp_item.type', '=', 'organic']],
          order_by: ['ranked_serp_element.serp_item.rank_group,asc'],
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO ranked_keywords error: ${res.status}`)

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
          ranked_serp_element?: {
            serp_item?: {
              type?:       string
              rank_group?: number | null
            }
          }
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(it => it.keyword_data?.keyword)
    .map(it => {
      const kd  = it.keyword_data!
      const cpc = kd.keyword_info?.cpc ?? null
      return {
        keyword:            kd.keyword ?? '',
        search_volume:      kd.keyword_info?.search_volume ?? null,
        keyword_difficulty: kd.keyword_difficulty ?? null,
        cpc,
        competition:        kd.keyword_info?.competition ?? null,
        intent:             deriveIntent(cpc),
        position:           it.ranked_serp_element?.serp_item?.rank_group ?? null,
      }
    })
}

// ─── Domain metrics composite (replaces SEMrush getDomainMetrics) ─────────────

export interface DomainMetrics {
  organic_keywords: number
  organic_traffic:  number
  /** Approximated from DataForSEO backlink rank (0–100). */
  authority_score:  number
}

/**
 * Composite domain health snapshot: organic keyword count, estimated monthly
 * traffic, and an authority score derived from the DataForSEO backlink rank.
 * Replaces: SEMrush getDomainMetrics (domain_ranks endpoint)
 *
 * Composed from:
 *   1. /dataforseo_labs/google/domain_rank_overview/live — organic_keywords + organic_traffic
 *   2. /backlinks/summary/live                          — authority_score (rank / 10, max 100)
 */
export async function getDomainMetrics(
  domain: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
): Promise<DomainMetrics> {
  const [overviewResult, rankResult] = await Promise.allSettled([
    fetchDomainRankOverview(domain, locationCode),
    fetchBacklinkRank(domain),
  ])

  const overview     = overviewResult.status === 'fulfilled' ? overviewResult.value : null
  const backlinkRank = rankResult.status     === 'fulfilled' ? rankResult.value     : 0

  return {
    organic_keywords: overview?.organic_keywords ?? 0,
    organic_traffic:  overview?.organic_traffic  ?? 0,
    authority_score:  Math.min(100, Math.round(backlinkRank / 10)),
  }
}

async function fetchDomainRankOverview(
  domain: string,
  locationCode: number,
): Promise<{ organic_keywords: number; organic_traffic: number }> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/domain_rank_overview/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          target:        domain,
          location_code: locationCode,
          language_code: DEFAULT_LANGUAGE_CODE,
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO domain_rank_overview error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        metrics?: {
          organic?: { count?: number | null; etv?: number | null }
        }
      }>
    }>
  }

  const organic = json.tasks?.[0]?.result?.[0]?.metrics?.organic
  return {
    organic_keywords: Math.round(organic?.count ?? 0),
    organic_traffic:  Math.round(organic?.etv   ?? 0),
  }
}

async function fetchBacklinkRank(domain: string): Promise<number> {
  const res = await fetch(`${DATAFORSEO_API_BASE}/backlinks/summary/live`, {
    method:  'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify([{ target: domain, internal_list_limit: 10 }]),
  })

  if (!res.ok) throw new Error(`DataForSEO backlinks error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{ result?: Array<{ rank?: number }> }>
  }

  return json.tasks?.[0]?.result?.[0]?.rank ?? 0
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Derive search intent from CPC as a proxy when the API doesn't return intent.
 * CPC proxy: high CPC → commercial/transactional, low → informational.
 */
function deriveIntent(cpc: number | null): string {
  if (cpc === null || cpc === 0) return 'informational'
  if (cpc < 1)  return 'informational'
  if (cpc < 3)  return 'commercial'
  return 'transactional'
}
