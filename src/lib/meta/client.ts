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

export interface MetaCampaignInsight {
  campaign_id:   string
  campaign_name: string
  spend:         number
  impressions:   number
  clicks:        number
  roas:          number | null
  ctr:           number | null
  cpc:           number | null
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

interface GraphCampaignRow extends GraphInsightsData {
  campaign_id?:   string
  campaign_name?: string
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

/**
 * Fetch campaign-level ad insights from Meta Graph API.
 * Returns up to `limit` campaigns sorted by spend descending.
 *
 * @param adAccountId  e.g. "act_123456789"
 * @param accessToken  Meta system user access token
 * @param since        ISO date string e.g. "2026-04-01"
 * @param until        ISO date string e.g. "2026-04-30"
 * @param limit        Max campaigns to return (default 10)
 */
export async function getAdCampaignInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
  limit: number = 10,
): Promise<MetaCampaignInsight[]> {
  const fields = [
    'campaign_id',
    'campaign_name',
    'spend',
    'impressions',
    'clicks',
    'purchase_roas',
    'outbound_clicks_ctr',
  ].join(',')

  const params = new URLSearchParams({
    fields,
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'campaign',
    sort:  'spend_descending',
    limit: String(limit),
  })

  const url = `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.error('[meta/client] campaign fetch error:', err)
    return []
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/client] campaign HTTP ${res.status}:`, body.slice(0, 300))
    return []
  }

  const json = await res.json() as { data?: GraphCampaignRow[] }
  return (json.data ?? []).map(parseCampaignRow).filter(Boolean) as MetaCampaignInsight[]
}

function parseCampaignRow(row: GraphCampaignRow): MetaCampaignInsight | null {
  if (!row.campaign_id) return null

  const base    = parseInsights(row)
  const ctr     = row.outbound_clicks_ctr?.[0]
    ? parseFloat(row.outbound_clicks_ctr[0].value) / 100 || null
    : base.ctr

  return {
    campaign_id:   row.campaign_id,
    campaign_name: row.campaign_name ?? row.campaign_id,
    spend:         base.spend,
    impressions:   base.impressions,
    clicks:        base.clicks,
    roas:          base.roas,
    ctr,
    cpc:           base.cpc,
  }
}

// ── Campaign management ───────────────────────────────────────────────────────

export interface CampaignDetails {
  id: string
  name: string
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED'
  daily_budget?: string   // Meta returns as string of cents e.g. "5000" = $50.00
  lifetime_budget?: string
  objective?: string
}

/**
 * Fetch basic campaign details (status, budget, name).
 * Used to read "before" state before executing a Fix action.
 */
export async function getCampaignDetails(
  campaignId: string,
  accessToken: string,
): Promise<CampaignDetails | null> {
  const params = new URLSearchParams({
    fields: 'id,name,status,daily_budget,lifetime_budget,objective',
    access_token: accessToken,
  })
  const url = `${GRAPH_BASE}/${campaignId}?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.error('[meta/client] getCampaignDetails fetch error:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/client] getCampaignDetails HTTP ${res.status}:`, body.slice(0, 300))
    return null
  }

  return res.json() as Promise<CampaignDetails>
}

/**
 * Set campaign status to ACTIVE or PAUSED.
 * Returns true on success.
 */
export async function setCampaignStatus(
  campaignId: string,
  accessToken: string,
  status: 'ACTIVE' | 'PAUSED',
): Promise<boolean> {
  const url = `${GRAPH_BASE}/${campaignId}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status, access_token: accessToken }).toString(),
    })
  } catch (err) {
    console.error('[meta/client] setCampaignStatus fetch error:', err)
    return false
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/client] setCampaignStatus HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  const json = await res.json() as { success?: boolean }
  return json.success === true
}

/**
 * Update campaign daily budget (only works for CBO campaigns).
 * dailyBudget is in the account's minor currency unit (e.g. cents for USD).
 */
export async function setCampaignDailyBudget(
  campaignId: string,
  accessToken: string,
  dailyBudgetCents: number,
): Promise<boolean> {
  const url = `${GRAPH_BASE}/${campaignId}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        daily_budget: String(Math.round(dailyBudgetCents)),
        access_token: accessToken,
      }).toString(),
    })
  } catch (err) {
    console.error('[meta/client] setCampaignDailyBudget fetch error:', err)
    return false
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/client] setCampaignDailyBudget HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  const json = await res.json() as { success?: boolean }
  return json.success === true
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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
