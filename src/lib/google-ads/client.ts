/**
 * Google Ads API client — thin wrapper over Google Ads REST API (v17).
 *
 * P18.B.1: Authentication via OAuth2 Service Account + developer token.
 *
 * Required env vars (all server-side only, never NEXT_PUBLIC_*):
 *   GOOGLE_ADS_DEVELOPER_TOKEN  — developer token from Google Ads Manager account
 *   GOOGLE_ADS_CLIENT_ID        — OAuth2 client ID
 *   GOOGLE_ADS_CLIENT_SECRET    — OAuth2 client secret
 *   GOOGLE_ADS_REFRESH_TOKEN    — long-lived refresh token (from OAuth consent flow)
 *   GOOGLE_ADS_MANAGER_ID       — (optional) MCC / manager account ID (no dashes)
 *
 * Note: All amounts are in micro-units (1 unit = 1,000,000 micro-units).
 *   $1.00 AUD = 1_000_000 micros
 *
 * Reference: https://developers.google.com/google-ads/api/docs/rest/overview
 */

const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v17'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoogleAdsCampaign {
  id: string
  name: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
  biddingStrategyType?: string
  campaignBudget?: {
    amountMicros: string   // budget in micro-units
    deliveryMethod: string
  }
}

export interface GoogleAdsKeyword {
  id: string
  adGroupId: string
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  cpcBidMicros?: string   // keyword-level CPC in micro-units (null if using ad group default)
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
}

export interface GoogleAdsCreds {
  developerToken: string
  clientId: string
  clientSecret: string
  refreshToken: string
  customerId: string       // 10-digit account ID, no dashes
  managerCustomerId?: string  // MCC account ID, no dashes
}

interface TokenResponse {
  access_token: string
  expires_in:   number
  token_type:   string
}

interface GoogleAdsError {
  error?: {
    code?:    number
    message?: string
    status?:  string
    details?: Array<{ '@type'?: string; errors?: Array<{ message?: string }> }>
  }
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Exchange a refresh token for a short-lived access token.
 * Throws on failure.
 */
export async function getAccessToken(creds: Omit<GoogleAdsCreds, 'customerId' | 'managerCustomerId'>): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type:    'refresh_token',
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const json = await res.json() as TokenResponse
  return json.access_token
}

/**
 * Build standard request headers for Google Ads API calls.
 */
function buildHeaders(creds: GoogleAdsCreds, accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization':         `Bearer ${accessToken}`,
    'developer-token':       creds.developerToken,
    'Content-Type':          'application/json',
  }
  if (creds.managerCustomerId) {
    headers['login-customer-id'] = creds.managerCustomerId
  }
  return headers
}

// ── Campaign operations ───────────────────────────────────────────────────────

/**
 * List campaigns for a customer account using Google Ads Query Language (GAQL).
 * Returns up to `limit` campaigns, active/paused only (excludes REMOVED).
 */
export async function listCampaigns(
  creds: GoogleAdsCreds,
  limit: number = 20,
): Promise<GoogleAdsCampaign[]> {
  const accessToken = await getAccessToken(creds)
  const url = `${GOOGLE_ADS_API_BASE}/customers/${creds.customerId}/googleAds:search`

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.bidding_strategy_type,
      campaign_budget.amount_micros,
      campaign_budget.delivery_method
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.name ASC
    LIMIT ${limit}
  `.trim()

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(creds, accessToken),
      body: JSON.stringify({ query }),
    })
  } catch (err) {
    console.error('[google-ads/client] listCampaigns fetch error:', err)
    return []
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[google-ads/client] listCampaigns HTTP ${res.status}:`, body.slice(0, 300))
    return []
  }

  const json = await res.json() as {
    results?: Array<{
      campaign?: { id?: string; name?: string; status?: string; biddingStrategyType?: string }
      campaignBudget?: { amountMicros?: string; deliveryMethod?: string }
    }>
  }

  return (json.results ?? []).map(row => ({
    id:     row.campaign?.id ?? '',
    name:   row.campaign?.name ?? '',
    status: (row.campaign?.status ?? 'UNKNOWN') as GoogleAdsCampaign['status'],
    biddingStrategyType: row.campaign?.biddingStrategyType,
    campaignBudget: row.campaignBudget
      ? {
          amountMicros:   row.campaignBudget.amountMicros ?? '0',
          deliveryMethod: row.campaignBudget.deliveryMethod ?? 'STANDARD',
        }
      : undefined,
  })).filter(c => c.id !== '')
}

/**
 * Fetch a single campaign's details by campaign ID.
 */
export async function getCampaign(
  creds: GoogleAdsCreds,
  campaignId: string,
): Promise<GoogleAdsCampaign | null> {
  const accessToken = await getAccessToken(creds)
  const url = `${GOOGLE_ADS_API_BASE}/customers/${creds.customerId}/googleAds:search`

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.bidding_strategy_type,
      campaign_budget.amount_micros,
      campaign_budget.delivery_method
    FROM campaign
    WHERE campaign.id = ${campaignId}
    LIMIT 1
  `.trim()

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(creds, accessToken),
      body: JSON.stringify({ query }),
    })
  } catch (err) {
    console.error('[google-ads/client] getCampaign fetch error:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[google-ads/client] getCampaign HTTP ${res.status}:`, body.slice(0, 300))
    return null
  }

  const json = await res.json() as {
    results?: Array<{
      campaign?: { id?: string; name?: string; status?: string; biddingStrategyType?: string }
      campaignBudget?: { amountMicros?: string; deliveryMethod?: string }
    }>
  }

  const row = json.results?.[0]
  if (!row?.campaign?.id) return null

  return {
    id:     row.campaign.id,
    name:   row.campaign.name ?? '',
    status: (row.campaign.status ?? 'UNKNOWN') as GoogleAdsCampaign['status'],
    biddingStrategyType: row.campaign.biddingStrategyType,
    campaignBudget: row.campaignBudget
      ? {
          amountMicros:   row.campaignBudget.amountMicros ?? '0',
          deliveryMethod: row.campaignBudget.deliveryMethod ?? 'STANDARD',
        }
      : undefined,
  }
}

/**
 * Enable or pause a campaign.
 * Returns true on success.
 */
export async function setCampaignStatus(
  creds: GoogleAdsCreds,
  campaignId: string,
  status: 'ENABLED' | 'PAUSED',
): Promise<boolean> {
  const accessToken = await getAccessToken(creds)
  const url = `${GOOGLE_ADS_API_BASE}/customers/${creds.customerId}/campaigns:mutate`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(creds, accessToken),
      body: JSON.stringify({
        operations: [{
          update: {
            resourceName: `customers/${creds.customerId}/campaigns/${campaignId}`,
            status,
          },
          updateMask: 'status',
        }],
      }),
    })
  } catch (err) {
    console.error('[google-ads/client] setCampaignStatus fetch error:', err)
    return false
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[google-ads/client] setCampaignStatus HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  return true
}

/**
 * Update a campaign's budget (via shared campaign budget resource).
 * amountMicros: new budget in micro-currency units (e.g. 5000000 = $5.00 AUD).
 * Returns true on success.
 */
export async function setCampaignBudget(
  creds: GoogleAdsCreds,
  budgetResourceName: string,
  amountMicros: number,
): Promise<boolean> {
  const accessToken = await getAccessToken(creds)
  const url = `${GOOGLE_ADS_API_BASE}/customers/${creds.customerId}/campaignBudgets:mutate`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(creds, accessToken),
      body: JSON.stringify({
        operations: [{
          update: {
            resourceName: budgetResourceName,
            amountMicros: String(Math.round(amountMicros)),
          },
          updateMask: 'amount_micros',
        }],
      }),
    })
  } catch (err) {
    console.error('[google-ads/client] setCampaignBudget fetch error:', err)
    return false
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[google-ads/client] setCampaignBudget HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  return true
}

// ── Keyword operations ────────────────────────────────────────────────────────

/**
 * Add a negative keyword to a campaign (broad match by default).
 * Returns the newly created negative keyword's resource name, or null on failure.
 */
export async function addCampaignNegativeKeyword(
  creds: GoogleAdsCreds,
  campaignId: string,
  keywordText: string,
  matchType: 'BROAD' | 'PHRASE' | 'EXACT' = 'BROAD',
): Promise<string | null> {
  const accessToken = await getAccessToken(creds)
  const url = `${GOOGLE_ADS_API_BASE}/customers/${creds.customerId}/campaignCriteria:mutate`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(creds, accessToken),
      body: JSON.stringify({
        operations: [{
          create: {
            campaign:  `customers/${creds.customerId}/campaigns/${campaignId}`,
            negative:  true,
            keyword: {
              text:      keywordText,
              matchType,
            },
          },
        }],
      }),
    })
  } catch (err) {
    console.error('[google-ads/client] addCampaignNegativeKeyword fetch error:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[google-ads/client] addCampaignNegativeKeyword HTTP ${res.status}:`, body.slice(0, 300))
    return null
  }

  const json = await res.json() as {
    results?: Array<{ resourceName?: string }>
  }
  return json.results?.[0]?.resourceName ?? null
}

// ── Env-var credential loader ─────────────────────────────────────────────────

/**
 * Load Google Ads credentials from environment variables.
 * Returns null if any required var is missing (caller should return 424).
 *
 * customerId: the 10-digit Google Ads account ID stored per-client in
 *   the `clients` table column `google_ads_customer_id`.
 */
export function loadGoogleAdsCreds(customerId: string): GoogleAdsCreds | null {
  const developerToken  = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const clientId        = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret    = process.env.GOOGLE_ADS_CLIENT_SECRET
  const refreshToken    = process.env.GOOGLE_ADS_REFRESH_TOKEN
  const managerCustomerId = process.env.GOOGLE_ADS_MANAGER_ID

  if (!developerToken || !clientId || !clientSecret || !refreshToken) {
    return null
  }

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    customerId,
    managerCustomerId: managerCustomerId ?? undefined,
  }
}

// Re-export error type for route use
export type { GoogleAdsError }
