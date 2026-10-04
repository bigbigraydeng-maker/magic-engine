/**
 * DataForSEO Labs API — competitor discovery + keyword gap.
 *
 * Split out of labs.ts (2026-09-23). labs.ts remains the barrel.
 */

import {
  DATAFORSEO_API_BASE,
  DEFAULT_LOCATION_CODE,
  DEFAULT_LANGUAGE_CODE,
  authHeader,
  deriveIntent,
  type LabsCompetitor,
  type LabsKeyword,
} from './labs-types'
import { bulkKeywordVolume } from './labs-keywords'

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
  return (await getKeywordsGapWithStatus(clientDomain, competitorDomains, locationCode, limit)).keywords
}

/**
 * Same as getKeywordsGap, but also reports how many per-competitor
 * domain_intersection calls failed so callers can tell a genuinely empty gap
 * (failedCount 0) from a degraded one (failedCount > 0).
 */
export async function getKeywordsGapWithStatus(
  clientDomain: string,
  competitorDomains: string[],
  locationCode: number = DEFAULT_LOCATION_CODE,
  limit: number = 100,
): Promise<{ keywords: LabsKeyword[]; failedCount: number }> {
  if (competitorDomains.length === 0) return { keywords: [], failedCount: 0 }

  const perCompetitor = await Promise.allSettled(
    competitorDomains.map(competitor =>
      fetchDomainIntersectionGap(competitor, clientDomain, locationCode, limit),
    ),
  )

  // Merge competitor results, keeping the highest-volume entry per keyword.
  const failedCount = perCompetitor.filter(r => r.status !== 'fulfilled').length
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

  const sorted = Array.from(byKeyword.values())
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
    .slice(0, limit)

  // Batch-enrich KD: domain_intersection doesn't return keyword_difficulty,
  // so we call bulkKeywordVolume for keywords missing KD.
  const missingKd = sorted.filter(kw => kw.keyword_difficulty == null)
  if (missingKd.length > 0) {
    try {
      const enriched = await bulkKeywordVolume(
        missingKd.map(kw => kw.keyword),
        locationCode,
      )
      const kdMap = new Map(enriched.map(e => [e.keyword, e.keyword_difficulty]))
      for (const kw of sorted) {
        if (kw.keyword_difficulty == null) {
          kw.keyword_difficulty = kdMap.get(kw.keyword) ?? null
        }
      }
    } catch (err) {
      console.warn('[labs/getKeywordsGap] KD enrichment failed', {
        clientDomain,
        competitorCount: competitorDomains.length,
        missingKdCount: missingKd.length,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { keywords: sorted, failedCount }
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
        from_competitor:    competitorDomain,
      }
    })
}
