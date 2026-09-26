/**
 * Meta post boost — create a minimal Campaign > AdSet > Ad stack around an
 * existing Page post.
 *
 * Split out of client.ts. This is a write path; the insights modules are
 * read-only.
 */

import { GRAPH_BASE } from './graph-base'

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
