/**
 * DataForSEO Labs API — traffic estimation + history.
 *
 * Split out of labs.ts (2026-09-23). labs.ts remains the barrel.
 */

import {
  DATAFORSEO_API_BASE,
  DEFAULT_LOCATION_CODE,
  DEFAULT_LANGUAGE_CODE,
  authHeader,
  type BulkTrafficResult,
  type DomainTrendPoint,
} from './labs-types'

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
