/**
 * Meta campaign management — read "before" state, then mutate status / budget.
 *
 * Split out of client.ts. These are the only write paths in the module; the
 * insights modules are read-only.
 */

import { GRAPH_BASE } from './graph-base'

export interface CampaignDetails {
  id: string
  name: string
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED'
  daily_budget?: string   // Meta returns as string of cents e.g. "5000" = $50.00
  lifetime_budget?: string
  objective?: string
  /** 裸数字（无 "act_" 前缀）—— 归属校验用（见 campaign-ownership.ts）。 */
  account_id?: string
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
    fields: 'id,name,status,daily_budget,lifetime_budget,objective,account_id',
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
