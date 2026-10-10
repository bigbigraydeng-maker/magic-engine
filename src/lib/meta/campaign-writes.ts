/** Meta campaign-level writes. Import only from Kernel capabilities. */

import { GRAPH_BASE } from './graph-base'

/** Update the daily budget on a CBO campaign, in the ad account currency's minor unit. */
export async function setCampaignDailyBudget(
  campaignId: string,
  accessToken: string,
  dailyBudgetMinor: number,
): Promise<boolean> {
  if (!/^\d{1,32}$/.test(campaignId) || !Number.isSafeInteger(dailyBudgetMinor) || dailyBudgetMinor < 0) {
    return false
  }
  let response: Response
  try {
    response = await fetch(`${GRAPH_BASE}/${campaignId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        daily_budget: String(dailyBudgetMinor),
        access_token: accessToken,
      }).toString(),
    })
  } catch (error) {
    console.error('[meta/campaign-writes] setCampaignDailyBudget fetch error:', error)
    return false
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error(`[meta/campaign-writes] setCampaignDailyBudget HTTP ${response.status}:`, body.slice(0, 300))
    return false
  }
  const payload = await response.json() as { success?: boolean }
  return payload.success === true
}

/** Restore a campaign that Meta automatically paused as a side effect of a budget update. */
export async function setCampaignStatus(
  campaignId: string,
  accessToken: string,
  status: 'ACTIVE' | 'PAUSED',
): Promise<boolean> {
  if (!/^\d{1,32}$/.test(campaignId)) return false
  let response: Response
  try {
    response = await fetch(`${GRAPH_BASE}/${campaignId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status, access_token: accessToken }).toString(),
    })
  } catch (error) {
    console.error('[meta/campaign-writes] setCampaignStatus fetch error:', error)
    return false
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error(`[meta/campaign-writes] setCampaignStatus HTTP ${response.status}:`, body.slice(0, 300))
    return false
  }
  const payload = await response.json() as { success?: boolean }
  return payload.success === true
}
