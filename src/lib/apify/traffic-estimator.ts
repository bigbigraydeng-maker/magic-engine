import { getDatasetItems, runActor, waitForRun } from './client'

/**
 * Public, third-party traffic direction signal. This is not first-party
 * analytics and must never be presented as exact visits or sales impact.
 * Actor build verified 2026-09-12: themineworks/similarweb-scraper 0.1.11.
 */
export const TRAFFIC_ESTIMATOR_ACTOR = 'themineworks/similarweb-scraper'
export const TRAFFIC_ESTIMATOR_BUILD = '0.1.11'

export type TrafficEstimate = {
  domain: string
  total_visits: string | null
  visits_change_pct: number | null
  bounce_rate_pct: number | null
  pages_per_visit: number | null
  avg_visit_duration: string | null
  top_country: string | null
  top_countries: Array<{ country: string; share_pct: number }>
  traffic_sources: Record<string, number>
  checked_at: string
  source: 'similarweb_public_estimate_via_apify'
  confidence: 'low'
}

export type TrafficEstimateResult = {
  data: TrafficEstimate[]
  run_id: string
  dataset_id: string
  cost_usd: number
}

type RawTrafficEstimate = {
  domain?: unknown
  total_visits?: unknown
  visits_change_pct?: unknown
  bounce_rate_pct?: unknown
  pages_per_visit?: unknown
  avg_visit_duration?: unknown
  top_country?: unknown
  top_countries?: unknown
  traffic_sources?: unknown
  checked_at?: unknown
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeDomain(value: string): string | null {
  const candidate = value.trim().toLowerCase()
  if (!candidate) return null
  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null
    const hostname = url.hostname.replace(/^www\./, '')
    if (!hostname.includes('.') || hostname.includes('..')) return null
    return hostname
  } catch {
    return null
  }
}

function parsePercent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number.parseFloat(value.replace('%', '').replace('+', ''))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeRow(raw: RawTrafficEstimate, checkedAt: string): TrafficEstimate | null {
  if (typeof raw.domain !== 'string') return null
  const domain = normalizeDomain(raw.domain)
  if (!domain) return null
  const countries = Array.isArray(raw.top_countries)
    ? raw.top_countries.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const value = item as Record<string, unknown>
      return typeof value.country === 'string' && finiteNumber(value.share_pct) !== null
        ? [{ country: value.country, share_pct: finiteNumber(value.share_pct)! }]
        : []
    }).slice(0, 10)
    : []
  const sources = raw.traffic_sources && typeof raw.traffic_sources === 'object' && !Array.isArray(raw.traffic_sources)
    ? Object.fromEntries(Object.entries(raw.traffic_sources as Record<string, unknown>).flatMap(([key, value]) => {
      const parsed = finiteNumber(value)
      return parsed === null ? [] : [[key, parsed]]
    }))
    : {}
  return {
    domain,
    total_visits: typeof raw.total_visits === 'string' ? raw.total_visits : null,
    visits_change_pct: parsePercent(raw.visits_change_pct),
    bounce_rate_pct: finiteNumber(raw.bounce_rate_pct),
    pages_per_visit: finiteNumber(raw.pages_per_visit),
    avg_visit_duration: typeof raw.avg_visit_duration === 'string' ? raw.avg_visit_duration : null,
    top_country: typeof raw.top_country === 'string' ? raw.top_country : null,
    top_countries: countries,
    traffic_sources: sources,
    checked_at: typeof raw.checked_at === 'string' ? raw.checked_at : checkedAt,
    source: 'similarweb_public_estimate_via_apify',
    confidence: 'low',
  }
}

export async function estimateWebsiteTraffic(domains: string[], options: { maxChargeUsd?: number } = {}): Promise<TrafficEstimateResult> {
  const uniqueDomains = [...new Set(domains.map(normalizeDomain).filter((domain): domain is string => domain !== null))]
  if (!uniqueDomains.length || uniqueDomains.length > 20) throw new Error('traffic_estimator_domain_limit')
  const maxChargeUsd = options.maxChargeUsd ?? Math.min(0.15, 0.01 + uniqueDomains.length * 0.01)
  if (!Number.isFinite(maxChargeUsd) || maxChargeUsd <= 0) throw new Error('traffic_estimator_budget_invalid')
  const run = await runActor(TRAFFIC_ESTIMATOR_ACTOR, { domains: uniqueDomains, maxItems: uniqueDomains.length }, {
    build: TRAFFIC_ESTIMATOR_BUILD, timeout: 120, memory: 512, maxTotalChargeUsd: maxChargeUsd,
  })
  const completed = await waitForRun(TRAFFIC_ESTIMATOR_ACTOR, run.id, 120_000)
  if (completed.status !== 'SUCCEEDED' || !completed.defaultDatasetId) throw new Error(`traffic_estimator_run_${completed.status.toLowerCase()}`)
  const rows = await getDatasetItems<RawTrafficEstimate>(completed.defaultDatasetId)
  const checkedAt = new Date().toISOString()
  return {
    data: rows.map(row => normalizeRow(row, checkedAt)).filter((row): row is TrafficEstimate => row !== null),
    run_id: run.id,
    dataset_id: completed.defaultDatasetId,
    cost_usd: completed.usageTotalUsd ?? 0,
  }
}

export { normalizeRow as normalizeTrafficEstimate }
