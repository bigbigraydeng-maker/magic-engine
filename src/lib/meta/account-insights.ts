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
  const fields = [
    'spend',
    'impressions',
    'clicks',
    'purchase_roas',
    'actions',
    'cost_per_action_type',
    'outbound_clicks_ctr',
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
  } catch (err) {
    console.error('[meta/client] fetch error:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/client] HTTP ${res.status}:`, body.slice(0, 300))
    return null
  }

  const json = await res.json() as { data?: GraphInsightsData[] }
  const row = json.data?.[0]
  if (!row) return null

  return parseInsights(row)
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
  const ctr = impressions > 0 && clicks > 0 ? clicks / impressions : null

  // Objective-dependent costs, straight from Meta's cost_per_action_type.
  // All null for objectives that cannot produce the matching action — a
  // Messenger campaign has no cost-per-purchase, and inventing one would feed
  // attribution a number nobody measured.
  const objectiveCosts = parseObjectiveCosts(row)

  return { spend, impressions, clicks, conversions, roas, cpc, ctr, ...objectiveCosts }
}
