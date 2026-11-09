/**
 * Account-level Meta ads insights.
 *
 * Split out of client.ts. `parseInsights` lives here because it is the shared
 * row parser: campaign- and ad-level modules import it rather than re-deriving
 * spend/impressions/clicks/ROAS.
 */

import {
  PURCHASE_ACTION_PRIORITY,
  parseObjectiveCosts,
  pickAction,
  type MetaActionStat,
  type MetaObjectiveCosts,
} from './objective-metrics'
import { GRAPH_BASE } from './graph-base'
import { clickThroughRate } from './ctr'

export interface MetaAdsInsights extends MetaObjectiveCosts {
  spend: number
  impressions: number
  clicks: number
  conversions: number | null
  roas: number | null
  cpc: number | null
  ctr: number | null
}

export interface GraphInsightsData {
  spend?: string
  impressions?: string
  clicks?: string
  purchase_roas?: Array<{ value: string }>
  actions?: MetaActionStat[]
  cost_per_action_type?: MetaActionStat[]
  outbound_clicks_ctr?: MetaActionStat[]
}

export type MetaAccountInsightsFailure =
  | { kind: 'network_error' }
  | { kind: 'http_error'; status: number }
  | { kind: 'invalid_json' }
  | { kind: 'empty_data' }
  | { kind: 'no_delivery' }

export type MetaAccountInsightsResult =
  | { ok: true; insights: MetaAdsInsights }
  | { ok: false; failure: MetaAccountInsightsFailure }

/**
 * Fetch account-level ad insights from Meta Graph API.
 *
 * @param adAccountId  e.g. "act_123456789"
 * @param accessToken  Meta system user access token
 * @param since        ISO date string e.g. "2026-04-01"
 * @param until        ISO date string e.g. "2026-04-30"
 */
export async function getAdAccountInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<MetaAdsInsights | null> {
  const result = await getAdAccountInsightsResult(adAccountId, accessToken, since, until)
  if (result.ok) return result.insights
  const failure = result.failure
  const detail = failure.kind === 'http_error' ? `${failure.kind} (${failure.status})` : failure.kind
  console.error(`[meta/client] account insights failed: ${detail}`)
  return null
}

/** Detailed result for callers that need to distinguish a known data gap from an API failure. */
export async function getAdAccountInsightsResult(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<MetaAccountInsightsResult> {
  const fields = [
    'spend',
    'impressions',
    'clicks',
    'purchase_roas',
    'actions',
    'cost_per_action_type',
  ].join(',')

  const params = new URLSearchParams({
    fields,
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'account',
  })

  const url = `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url)
  } catch {
    return { ok: false, failure: { kind: 'network_error' } }
  }

  if (!res.ok) {
    return { ok: false, failure: { kind: 'http_error', status: res.status } }
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, failure: { kind: 'invalid_json' } }
  }
  if (!json || typeof json !== 'object') return { ok: false, failure: { kind: 'invalid_json' } }
  const data = (json as { data?: unknown }).data
  if (data === undefined) return { ok: false, failure: { kind: 'empty_data' } }
  if (!Array.isArray(data)) return { ok: false, failure: { kind: 'invalid_json' } }
  const row = data[0] as GraphInsightsData | undefined
  if (!row) return { ok: false, failure: { kind: 'no_delivery' } }

  return { ok: true, insights: parseInsights(row) }
}

export function parseInsights(row: GraphInsightsData): MetaAdsInsights {
  const spend       = parseFloat(row.spend ?? '0') || 0
  const impressions = parseInt(row.impressions ?? '0', 10) || 0
  const clicks      = parseInt(row.clicks ?? '0', 10) || 0

  // purchase_roas is an array of {action_type, value} — take first entry
  const roasEntry = row.purchase_roas?.[0]
  const roas = roasEntry ? parseFloat(roasEntry.value) || null : null

  // Purchases: pick ONE action type by priority — `purchase` is the aggregate
  // of the offsite pixel variant, so finding either and summing would
  // double-count. null (not 0) when the objective produces no purchases.
  const purchases = pickAction(row.actions, PURCHASE_ACTION_PRIORITY)
  const conversions = purchases > 0 ? purchases : null

  const cpc = spend > 0 && clicks > 0 ? spend / clicks : null
  const ctr = clickThroughRate(clicks, impressions)

  // Objective-dependent costs, straight from Meta's cost_per_action_type.
  // All null for objectives that cannot produce the matching action — a
  // Messenger campaign has no cost-per-purchase, and inventing one would feed
  // attribution a number nobody measured.
  const objectiveCosts = parseObjectiveCosts(row)

  return { spend, impressions, clicks, conversions, roas, cpc, ctr, ...objectiveCosts }
}
