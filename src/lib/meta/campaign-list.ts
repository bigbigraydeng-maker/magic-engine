/**
 * Meta Graph API — Campaign performance list
 *
 * P18.A.1: Fetches campaign-level insights for a client's ad account.
 * Uses a single /insights call at campaign level to avoid N+1 API calls.
 *
 * Requires META_SYSTEM_USER_TOKEN in env.
 */

import { gradeCampaignByRoas } from './executor'
import type { RoasGrade } from './executor'

const GRAPH_BASE = 'https://graph.facebook.com/v19.0'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CampaignInsightsRow {
  campaign_id:   string
  campaign_name: string
  spend:         number
  impressions:   number
  clicks:        number
  roas:          number | null
  conversions:   number | null
  ctr:           number | null
  grade:         RoasGrade
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

export function parseCampaignInsightsRow(raw: Record<string, unknown>): CampaignInsightsRow {
  const spend       = parseFloat(String(raw.spend       ?? '0')) || 0
  const impressions = parseInt(String(raw.impressions   ?? '0'), 10) || 0
  const clicks      = parseInt(String(raw.clicks        ?? '0'), 10) || 0

  const roasArr = raw.purchase_roas as Array<{ value: string }> | undefined
  const roas    = roasArr?.[0] ? parseFloat(roasArr[0].value) || null : null

  const actionsArr = raw.actions as Array<{ action_type: string; value: string }> | undefined
  const purchaseAct = actionsArr?.find(a =>
    a.action_type === 'purchase' ||
    a.action_type === 'offsite_conversion.fb_pixel_purchase'
  )
  const conversions = purchaseAct ? parseInt(purchaseAct.value, 10) || null : null

  const ctr = impressions > 0 ? clicks / impressions : null

  return {
    campaign_id:   String(raw.campaign_id   ?? ''),
    campaign_name: String(raw.campaign_name ?? ''),
    spend,
    impressions,
    clicks,
    roas,
    conversions,
    ctr,
    grade: gradeCampaignByRoas(roas, spend),
  }
}

const GRADE_ORDER: Record<RoasGrade, number> = { critical: 0, warning: 1, healthy: 2 }

export function sortCampaignsByRisk(rows: CampaignInsightsRow[]): CampaignInsightsRow[] {
  return [...rows].sort((a, b) => {
    const gradeDiff = GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]
    if (gradeDiff !== 0) return gradeDiff
    return b.spend - a.spend
  })
}

// ── HTTP ───────────────────────────────────────────────────────────────────────

/**
 * Fetch last-7-day insights for all campaigns in an ad account.
 * Returns an empty array on any error.
 */
export async function fetchCampaignInsights(adAccountId: string): Promise<CampaignInsightsRow[]> {
  const accessToken = process.env.META_SYSTEM_USER_TOKEN
  if (!accessToken) return []

  const fields = [
    'campaign_id',
    'campaign_name',
    'spend',
    'impressions',
    'clicks',
    'purchase_roas',
    'actions',
  ].join(',')

  const params = new URLSearchParams({
    fields,
    level: 'campaign',
    date_preset: 'last_7_days',
    access_token: accessToken,
    limit: '50',
  })

  try {
    const res = await fetch(`${GRAPH_BASE}/${adAccountId}/insights?${params}`)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[meta/campaign-list] insights ${res.status}:`, body.slice(0, 200))
      return []
    }
    const json = await res.json() as { data?: Record<string, unknown>[] }
    const rows = (json.data ?? []).map(parseCampaignInsightsRow)
    return sortCampaignsByRisk(rows)
  } catch (err) {
    console.error('[meta/campaign-list] fetch error:', err)
    return []
  }
}
