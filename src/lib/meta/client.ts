/**
 * Meta Graph API client — thin wrapper for ads insights.
 *
 * P12.B.2: Used by the /api/clients/[id]/meta-ads/sync route to pull
 * account-level insights and write them to meta_ads_snapshots.
 *
 * Requires META_SYSTEM_USER_TOKEN in env (long-lived system user token).
 * Returns null gracefully when the token is not configured.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v19.0'

export interface MetaAdsInsights {
  spend: number
  impressions: number
  clicks: number
  conversions: number | null
  roas: number | null
  cpc: number | null
  ctr: number | null
}

interface GraphInsightsData {
  spend?: string
  impressions?: string
  clicks?: string
  purchase_roas?: Array<{ value: string }>
  actions?: Array<{ action_type: string; value: string }>
  cost_per_action_type?: Array<{ action_type: string; value: string }>
  outbound_clicks_ctr?: Array<{ action_type: string; value: string }>
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

function parseInsights(row: GraphInsightsData): MetaAdsInsights {
  const spend       = parseFloat(row.spend ?? '0') || 0
  const impressions = parseInt(row.impressions ?? '0', 10) || 0
  const clicks      = parseInt(row.clicks ?? '0', 10) || 0

  // purchase_roas is an array of {action_type, value} — take first entry
  const roasEntry = row.purchase_roas?.[0]
  const roas = roasEntry ? parseFloat(roasEntry.value) || null : null

  // actions: sum purchase / offsite_conversion.fb_pixel_purchase
  const actions = row.actions ?? []
  const purchaseAction = actions.find(a =>
    a.action_type === 'purchase' ||
    a.action_type === 'offsite_conversion.fb_pixel_purchase'
  )
  const conversions = purchaseAction ? parseInt(purchaseAction.value, 10) || null : null

  const cpc = spend > 0 && clicks > 0 ? spend / clicks : null
  const ctr = impressions > 0 && clicks > 0 ? clicks / impressions : null

  return { spend, impressions, clicks, conversions, roas, cpc, ctr }
}
