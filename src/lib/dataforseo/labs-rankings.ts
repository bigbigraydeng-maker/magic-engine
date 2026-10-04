/**
 * DataForSEO Labs API — ranked keywords + domain metrics.
 *
 * Split out of labs.ts (2026-09-23). labs.ts remains the barrel.
 */

import {
  DATAFORSEO_API_BASE,
  DEFAULT_LOCATION_CODE,
  DEFAULT_LANGUAGE_CODE,
  authHeader,
  assertTaskOk,
  deriveIntent,
  errorMessage,
  type DomainMetrics,
  type LabsKeyword,
} from './labs-types'

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
            // KD lives under keyword_properties in ranked_keywords responses
            // (same shape as keyword_ideas/suggestions elsewhere in this file).
            keyword_properties?: {
              keyword_difficulty?: number | null
            }
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
        keyword_difficulty: kd.keyword_properties?.keyword_difficulty ?? null,
        cpc,
        competition:        kd.keyword_info?.competition ?? null,
        intent:             deriveIntent(cpc),
        position:           it.ranked_serp_element?.serp_item?.rank_group ?? null,
      }
    })
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

  // A rejected provider call means the composite snapshot is unknowable.
  // Never turn an outage into a believable zero; callers can then record a
  // failed/no-data run and retry according to their own policy.
  if (overviewResult.status === 'rejected') {
    throw new Error(`DataForSEO domain overview unavailable: ${errorMessage(overviewResult.reason)}`)
  }
  if (rankResult.status === 'rejected') {
    throw new Error(`DataForSEO backlink rank unavailable: ${errorMessage(rankResult.reason)}`)
  }

  const overview     = overviewResult.value
  const backlinkRank = rankResult.value

  return {
    organic_keywords: overview?.organic_keywords ?? 0,
    organic_traffic:  overview?.organic_traffic  ?? 0,
    authority_score:  Math.min(100, Math.round(backlinkRank / 10)),
  }
}

/**
 * Single-domain organic rank snapshot: count of ranking keywords +
 * estimated monthly organic traffic. Exposed for callers that need
 * stats for a specific competitor domain (e.g. FDE-configured
 * competitors that don't appear in SERP-discovered list and therefore
 * lack metrics from getSerpCompetitors).
 *
 * DataForSEO has no bulk version of this endpoint; call once per domain
 * in parallel if you need multiple.
 */
export async function fetchDomainRankOverview(
  domain: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
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

  // Actual response shape (verified 2026-06-04 against bunnings.com.au):
  //   tasks[0].result[0].items[0].metrics.organic.{count, etv}
  // Previously we read tasks[0].result[0].metrics.organic which is undefined,
  // causing all stub competitor enrichment to silently return 0/0.
  const json = await res.json() as {
    tasks?: Array<{
      status_code?:    number
      status_message?: string
      result?: Array<{
        items?: Array<{
          metrics?: {
            organic?: { count?: number | null; etv?: number | null }
          }
        }>
      }>
    }>
  }

  assertTaskOk(json.tasks?.[0], 'domain_rank_overview')

  const organic = json.tasks?.[0]?.result?.[0]?.items?.[0]?.metrics?.organic
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
