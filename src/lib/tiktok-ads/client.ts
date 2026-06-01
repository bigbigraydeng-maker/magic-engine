/**
 * TikTok Marketing API v2 client — thin wrapper for TikTok Ads operations.
 *
 * P18.C: Used by /api/clients/[id]/tiktok-ads/* routes.
 *
 * Authentication: long-term access token (TIKTOK_ADS_ACCESS_TOKEN env var).
 * Unlike Meta / Google, TikTok Ads uses a single advertiser-scoped long-term
 * access token — no OAuth refresh flow is needed for server-side operations.
 *
 * API reference: https://business-api.tiktok.com/portal/docs
 * Base URL: https://business-api.tiktok.com/open_api/v1.3
 */

const TIKTOK_ADS_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TikTokAdsCreds {
  accessToken:   string
  advertiserId:  string
}

export interface TikTokCampaign {
  campaign_id:     string
  campaign_name:   string
  status:          string   // 'ENABLE' | 'DISABLE' | 'DELETE' | 'FROZEN'
  budget:          number   // daily budget in advertiser currency units
  budget_mode:     string   // 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL' | 'BUDGET_MODE_INFINITE'
  objective_type:  string   // 'REACH' | 'TRAFFIC' | 'CONVERSIONS' etc.
  create_time:     string
  modify_time:     string
}

export interface TikTokCampaignDetails extends TikTokCampaign {
  advertiser_id: string
}

// ─── Response wrappers ────────────────────────────────────────────────────────

interface TikTokApiResponse<T> {
  code:    number
  message: string
  data:    T | null
}

interface CampaignListData {
  list:      TikTokCampaign[]
  page_info: { total_number: number; page: number; page_size: number; total_page: number }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type':  'application/json',
    'Access-Token':  accessToken,
  }
}

async function apiGet<T>(path: string, params: Record<string, string>, accessToken: string): Promise<TikTokApiResponse<T>> {
  const url = new URL(`${TIKTOK_ADS_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), {
    method:  'GET',
    headers: buildHeaders(accessToken),
    signal:  AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    throw new Error(`TikTok Ads API error: ${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<TikTokApiResponse<T>>
}

async function apiPost<T>(path: string, body: unknown, accessToken: string): Promise<TikTokApiResponse<T>> {
  const res = await fetch(`${TIKTOK_ADS_BASE}${path}`, {
    method:  'POST',
    headers: buildHeaders(accessToken),
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    throw new Error(`TikTok Ads API error: ${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<TikTokApiResponse<T>>
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List campaigns for an advertiser account.
 *
 * @param creds      TikTok Ads credentials
 * @param limit      Max campaigns to return (default 20, max 100)
 */
export async function listCampaigns(creds: TikTokAdsCreds, limit = 20): Promise<TikTokCampaign[]> {
  const safeLimit = Math.min(limit, 100)
  const resp = await apiGet<CampaignListData>(
    '/campaign/get/',
    {
      advertiser_id: creds.advertiserId,
      page_size:     String(safeLimit),
      fields:        JSON.stringify([
        'campaign_id', 'campaign_name', 'status', 'budget',
        'budget_mode', 'objective_type', 'create_time', 'modify_time',
      ]),
    },
    creds.accessToken,
  )

  if (resp.code !== 0 || !resp.data) return []
  return resp.data.list ?? []
}

/**
 * Get a single campaign's details by ID.
 *
 * Returns null if the campaign is not found or the API call fails.
 */
export async function getCampaign(creds: TikTokAdsCreds, campaignId: string): Promise<TikTokCampaignDetails | null> {
  const resp = await apiGet<CampaignListData>(
    '/campaign/get/',
    {
      advertiser_id: creds.advertiserId,
      filtering:     JSON.stringify({ campaign_ids: [campaignId] }),
      fields:        JSON.stringify([
        'campaign_id', 'campaign_name', 'status', 'budget',
        'budget_mode', 'objective_type', 'create_time', 'modify_time',
      ]),
    },
    creds.accessToken,
  )

  if (resp.code !== 0 || !resp.data || !resp.data.list.length) return null
  return { ...resp.data.list[0], advertiser_id: creds.advertiserId }
}

/**
 * Set a campaign's status to ENABLE or DISABLE.
 *
 * Returns true on success, false on failure.
 */
export async function setCampaignStatus(
  creds: TikTokAdsCreds,
  campaignId: string,
  status: 'ENABLE' | 'DISABLE',
): Promise<boolean> {
  const resp = await apiPost<unknown>(
    '/campaign/status/update/',
    {
      advertiser_id: creds.advertiserId,
      campaign_ids:  [campaignId],
      opt_status:    status,
    },
    creds.accessToken,
  )
  return resp.code === 0
}

/**
 * Update a campaign's daily budget.
 *
 * @param newBudget  New daily budget in advertiser currency (whole units, e.g. AUD)
 */
export async function setCampaignBudget(
  creds: TikTokAdsCreds,
  campaignId: string,
  newBudget: number,
): Promise<boolean> {
  const resp = await apiPost<unknown>(
    '/campaign/update/',
    {
      advertiser_id: creds.advertiserId,
      campaign_id:   campaignId,
      budget:        newBudget,
    },
    creds.accessToken,
  )
  return resp.code === 0
}

/**
 * Load TikTok Ads credentials from environment variables.
 *
 * Returns null (gracefully) when any required env var is missing — callers
 * should return 424 rather than throw.
 *
 * Required env vars:
 *   TIKTOK_ADS_ACCESS_TOKEN  — long-term access token from TikTok Marketing API app
 *   TIKTOK_ADS_ADVERTISER_ID — advertiser account ID (numeric string)
 *
 * Per-client override: if the client row carries tiktok_ad_account_id, use that
 * as advertiserId; otherwise fall back to the env var.
 */
export function loadTikTokAdsCreds(advertiserId?: string): TikTokAdsCreds | null {
  const accessToken  = process.env.TIKTOK_ADS_ACCESS_TOKEN
  const envAdvertiserId = process.env.TIKTOK_ADS_ADVERTISER_ID
  const resolvedAdvertiserId = advertiserId ?? envAdvertiserId

  if (!accessToken || !resolvedAdvertiserId) return null

  return { accessToken, advertiserId: resolvedAdvertiserId }
}
