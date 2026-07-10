/**
 * Meta Ads Manager — thin CRUD wrapper for Ad operations.
 *
 * Used by winner-reel-sync engine to inspect an Ad Set's current Ads,
 * create fresh Ads from Page posts, and pause fatigued Ads.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

export interface AdSummary {
  adId: string
  name: string
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED'
  effectiveObjectStoryId: string | null   // "<page_id>_<post_id>"
  createdTime: string                     // ISO
  ctr: number | null                      // fetched separately via insights
}

interface RawAd {
  id: string
  name: string
  status: string
  created_time?: string
  creative?: {
    effective_object_story_id?: string
    object_story_id?: string
  }
}

/**
 * List all Ads in an Ad Set with their current creative's post binding.
 */
export async function listAdsInAdSet(
  adsetId: string,
  accessToken: string,
): Promise<AdSummary[]> {
  const fields = 'id,name,status,created_time,creative{effective_object_story_id,object_story_id}'
  const url = `${GRAPH_BASE}/${adsetId}/ads?fields=${fields}&limit=100&access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`listAdsInAdSet ${adsetId}: ${res.status}`)
  const body = (await res.json()) as { data?: RawAd[]; error?: { message: string } }
  if (body.error) throw new Error(`listAdsInAdSet ${adsetId}: ${body.error.message}`)

  return (body.data ?? []).map((a) => ({
    adId:  a.id,
    name:  a.name,
    status: (a.status as AdSummary['status']) ?? 'PAUSED',
    effectiveObjectStoryId:
      a.creative?.effective_object_story_id ?? a.creative?.object_story_id ?? null,
    createdTime: a.created_time ?? new Date().toISOString(),
    ctr: null,
  }))
}

/**
 * Create a new Ad in the given Ad Set that promotes an existing Page post.
 * object_story_id format is "<page_id>_<post_id>" (post must be published + promotable).
 */
export async function createAdFromPost(input: {
  adAccountId: string        // e.g. "act_2775766642787274"
  adsetId: string
  pageId: string
  postId: string
  name: string
  status?: 'PAUSED' | 'ACTIVE'
  accessToken: string
}): Promise<{ adId: string }> {
  const status = input.status ?? 'PAUSED'
  const body = new URLSearchParams({
    name: input.name,
    adset_id: input.adsetId,
    creative: JSON.stringify({ object_story_id: `${input.pageId}_${input.postId}` }),
    status,
    access_token: input.accessToken,
  })
  const res = await fetch(`${GRAPH_BASE}/${input.adAccountId}/ads`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await res.json()) as { id?: string; error?: { message: string; error_user_msg?: string } }
  if (!res.ok || json.error) {
    const msg = json.error?.error_user_msg || json.error?.message || `${res.status}`
    throw new Error(`createAdFromPost ${input.name}: ${msg}`)
  }
  if (!json.id) throw new Error(`createAdFromPost ${input.name}: no id returned`)
  return { adId: json.id }
}

/**
 * Pause an Ad (soft off — creative + insights preserved for later analysis).
 */
export async function pauseAd(adId: string, accessToken: string): Promise<void> {
  const body = new URLSearchParams({ status: 'PAUSED', access_token: accessToken })
  const res = await fetch(`${GRAPH_BASE}/${adId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`pauseAd ${adId}: ${res.status} ${await res.text()}`)
}

/**
 * Batch-fetch CTR for a list of Ad IDs over the last N days.
 * Returns a map keyed by adId (missing IDs = insufficient data → null).
 */
export async function fetchCTRForAds(
  adIds: string[],
  accessToken: string,
  lookbackDays = 7,
): Promise<Record<string, number | null>> {
  if (adIds.length === 0) return {}
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10)
  const until = new Date().toISOString().slice(0, 10)
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }))
  const fields = 'ad_id,ctr,impressions'

  const out: Record<string, number | null> = {}
  await Promise.all(
    adIds.map(async (adId) => {
      const url = `${GRAPH_BASE}/${adId}/insights?fields=${fields}&time_range=${timeRange}&access_token=${encodeURIComponent(accessToken)}`
      const res = await fetch(url)
      if (!res.ok) { out[adId] = null; return }
      const body = (await res.json()) as { data?: Array<{ ctr?: string; impressions?: string }> }
      const row = body.data?.[0]
      if (!row || Number(row.impressions ?? 0) < 100) { out[adId] = null; return } // low-signal → skip
      out[adId] = Number(row.ctr ?? 0)
    }),
  )
  return out
}
