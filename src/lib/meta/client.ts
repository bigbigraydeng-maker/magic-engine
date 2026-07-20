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

// ── Campaign daily time series (P21.K.1 — Ad Strategy Engine data spine) ──────

/**
 * One campaign's metrics for one calendar day.
 *
 * P21.K.1: feeds `ad_daily_insights`, the time series the Ad Strategy Engine
 * needs for relative-baseline fatigue detection (7d median vs the campaign's
 * own best 7d). The pre-existing `getAdCampaignInsights` cannot serve this —
 * it returns a single 30-day rolling aggregate capped at 10 campaigns.
 */
export interface MetaCampaignDailyRow {
  campaign_id:   string
  campaign_name: string
  insight_date:  string        // YYYY-MM-DD
  spend:         number
  impressions:   number
  reach:         number | null
  clicks:        number
  frequency:     number | null // impressions / reach, as reported by Meta
  cpm:           number | null
  ctr:           number | null // fraction (0.0318 = 3.18%), outbound CTR preferred
  cpc:           number | null
  leads:         number        // action_type 'lead' (Lead Form submissions)
  messaging_conversations: number // CTWA conversations started
  results:       number        // leads + messaging_conversations (the north-star unit)
  cost_per_result: number | null
}

interface GraphCampaignDailyRow extends GraphCampaignRow {
  date_start?: string
  reach?:      string
  frequency?:  string
  cpm?:        string
}

// Meta's `actions` array is HIERARCHICAL: parent and child action types both
// appear for the same conversions and their values overlap. `lead` is the
// aggregate; `onsite_conversion.lead_grouped` is the Instant-Form child of it.
// SUMMING them double-counts (leads inflate up to 2×, halving cost_per_result).
// So each metric picks ONE type by priority, never adds across the list.
// Ref: https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/
const LEAD_ACTION_PRIORITY = ['lead', 'onsite_conversion.lead_grouped']
const MESSAGING_ACTION_PRIORITY = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
]

/** Return the value of the first action type present, by priority. Never sums. */
function pickAction(
  actions: Array<{ action_type: string; value: string }> | undefined,
  priority: string[],
): number {
  if (!actions) return 0
  for (const wanted of priority) {
    const hit = actions.find(a => a.action_type === wanted)
    if (hit) return parseInt(hit.value, 10) || 0
  }
  return 0
}

function parseCampaignDailyRow(row: GraphCampaignDailyRow): MetaCampaignDailyRow | null {
  if (!row.campaign_id || !row.date_start) return null

  const base  = parseInsights(row)
  const reach = row.reach !== undefined ? parseInt(row.reach, 10) || null : null

  // Prefer Meta's own outbound CTR (percent → fraction); fall back to clicks/impressions.
  const outbound = row.outbound_clicks_ctr?.[0]
  const ctr = outbound ? (parseFloat(outbound.value) / 100 || null) : base.ctr

  const leads     = pickAction(row.actions, LEAD_ACTION_PRIORITY)
  const messaging = pickAction(row.actions, MESSAGING_ACTION_PRIORITY)
  const results   = leads + messaging

  return {
    campaign_id:   row.campaign_id,
    campaign_name: row.campaign_name ?? row.campaign_id,
    insight_date:  row.date_start,
    spend:         base.spend,
    impressions:   base.impressions,
    reach,
    clicks:        base.clicks,
    frequency:     row.frequency !== undefined ? parseFloat(row.frequency) || null : null,
    cpm:           row.cpm !== undefined ? parseFloat(row.cpm) || null : null,
    ctr,
    cpc:           base.cpc,
    leads,
    messaging_conversations: messaging,
    results,
    cost_per_result: results > 0 ? base.spend / results : null,
  }
}

const DAILY_FIELDS = [
  'campaign_id',
  'campaign_name',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'frequency',
  'cpm',
  'actions',
  'outbound_clicks_ctr',
].join(',')

/** Hard cap on pagination follows — a runaway-loop backstop, not a real limit. */
const MAX_INSIGHT_PAGES = 25

/**
 * Fetch per-campaign, per-day insights across a date range, following pagination.
 *
 * Unlike `getAdCampaignInsights` this returns EVERY campaign (no spend-sorted
 * top-N truncation) broken down by day, which is what a time series requires.
 *
 * Returns [] on any transport/HTTP error, matching this module's convention of
 * degrading rather than throwing (callers treat [] as "nothing to write").
 */
export async function getCampaignDailyInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<MetaCampaignDailyRow[]> {
  const params = new URLSearchParams({
    fields: DAILY_FIELDS,
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'campaign',
    time_increment: '1',
    limit: '500',
  })

  let url: string | undefined = `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`
  const rows: MetaCampaignDailyRow[] = []

  for (let page = 0; page < MAX_INSIGHT_PAGES && url; page++) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      console.error('[meta/client] campaign daily fetch error:', err)
      return rows
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[meta/client] campaign daily HTTP ${res.status}:`, body.slice(0, 300))
      return rows
    }

    const json = await res.json() as {
      data?: GraphCampaignDailyRow[]
      paging?: { next?: string }
    }

    for (const raw of json.data ?? []) {
      const parsed = parseCampaignDailyRow(raw)
      if (parsed) rows.push(parsed)
    }

    url = json.paging?.next
  }

  return rows
}

/**
 * Fetch each campaign's frequency over a whole window (typically 7 days).
 *
 * Frequency is impressions/reach and is NOT additive — averaging seven daily
 * frequencies does not give the 7-day frequency, because reach deduplicates
 * people across the window. It must be requested for the window itself.
 */
export async function getCampaignWindowFrequency(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<Map<string, number>> {
  const params = new URLSearchParams({
    fields: 'campaign_id,frequency',
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'campaign',
    limit: '500',
  })

  const out = new Map<string, number>()
  let url: string | undefined = `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`

  for (let page = 0; page < MAX_INSIGHT_PAGES && url; page++) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      console.error('[meta/client] window frequency fetch error:', err)
      return out
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[meta/client] window frequency HTTP ${res.status}:`, body.slice(0, 300))
      return out
    }

    const json = await res.json() as {
      data?: Array<{ campaign_id?: string; frequency?: string }>
      paging?: { next?: string }
    }

    for (const row of json.data ?? []) {
      if (!row.campaign_id || row.frequency === undefined) continue
      const freq = parseFloat(row.frequency)
      if (Number.isFinite(freq)) out.set(row.campaign_id, freq)
    }

    url = json.paging?.next
  }

  return out
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

// ── Post Boost ────────────────────────────────────────────────────────────────

export interface BoostPostResult {
  campaign_id: string
  ad_set_id: string
  ad_id: string
}

/**
 * Boost an existing Facebook Page post by creating a minimal
 * Campaign > AdSet > Ad stack targeting the post's page audience.
 *
 * Uses REACH objective (best for awareness/engagement on organic content).
 * The ad creative is the page post itself — no new creative needed.
 *
 * @param adAccountId       e.g. "act_123456789"
 * @param pageId            Facebook Page ID
 * @param postId            Page Post ID (page_id_post_id format or standalone)
 * @param accessToken       Meta system user access token
 * @param dailyBudgetCents  Daily budget in minor currency unit (e.g. 2000 = AUD $20.00)
 * @param durationDays      Campaign duration in days (1–30)
 */
export async function boostPagePost(
  adAccountId: string,
  pageId: string,
  postId: string,
  accessToken: string,
  dailyBudgetCents: number,
  durationDays: number,
): Promise<BoostPostResult | null> {
  const now = new Date()
  const startTime = Math.floor(now.getTime() / 1000)
  const endDate = new Date(now)
  endDate.setDate(endDate.getDate() + durationDays)
  const endTime = Math.floor(endDate.getTime() / 1000)

  // Step 1: Create Campaign
  const campaignRes = await fetch(`${GRAPH_BASE}/${adAccountId}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      name: `Boost — ${postId} — ${now.toISOString().slice(0, 10)}`,
      objective: 'REACH',
      status: 'ACTIVE',
      special_ad_categories: '[]',
      access_token: accessToken,
    }).toString(),
  })

  if (!campaignRes.ok) {
    const body = await campaignRes.text().catch(() => '')
    console.error(`[meta/client] boostPagePost campaign HTTP ${campaignRes.status}:`, body.slice(0, 300))
    return null
  }

  const campaignJson = await campaignRes.json() as { id?: string }
  const campaignId = campaignJson.id
  if (!campaignId) return null

  // Step 2: Create AdSet — target fans of the page, AU/NZ geo
  const adSetRes = await fetch(`${GRAPH_BASE}/${adAccountId}/adsets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      name: `AdSet — boost ${postId}`,
      campaign_id: campaignId,
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'REACH',
      daily_budget: String(Math.round(dailyBudgetCents)),
      start_time: String(startTime),
      end_time: String(endTime),
      targeting: JSON.stringify({
        geo_locations: { countries: ['AU', 'NZ'] },
        age_min: 25,
        age_max: 65,
      }),
      status: 'ACTIVE',
      access_token: accessToken,
    }).toString(),
  })

  if (!adSetRes.ok) {
    const body = await adSetRes.text().catch(() => '')
    console.error(`[meta/client] boostPagePost adset HTTP ${adSetRes.status}:`, body.slice(0, 300))
    return null
  }

  const adSetJson = await adSetRes.json() as { id?: string }
  const adSetId = adSetJson.id
  if (!adSetId) return null

  // Step 3: Create Ad — use the page post as the creative
  const adCreativeRes = await fetch(`${GRAPH_BASE}/${adAccountId}/adcreatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      name: `Creative — boost ${postId}`,
      object_story_id: postId.includes('_') ? postId : `${pageId}_${postId}`,
      access_token: accessToken,
    }).toString(),
  })

  if (!adCreativeRes.ok) {
    const body = await adCreativeRes.text().catch(() => '')
    console.error(`[meta/client] boostPagePost adcreative HTTP ${adCreativeRes.status}:`, body.slice(0, 300))
    return null
  }

  const adCreativeJson = await adCreativeRes.json() as { id?: string }
  const adCreativeId = adCreativeJson.id
  if (!adCreativeId) return null

  const adRes = await fetch(`${GRAPH_BASE}/${adAccountId}/ads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      name: `Ad — boost ${postId}`,
      adset_id: adSetId,
      creative: JSON.stringify({ creative_id: adCreativeId }),
      status: 'ACTIVE',
      access_token: accessToken,
    }).toString(),
  })

  if (!adRes.ok) {
    const body = await adRes.text().catch(() => '')
    console.error(`[meta/client] boostPagePost ad HTTP ${adRes.status}:`, body.slice(0, 300))
    return null
  }

  const adJson = await adRes.json() as { id?: string }
  const adId = adJson.id
  if (!adId) return null

  return { campaign_id: campaignId, ad_set_id: adSetId, ad_id: adId }
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
