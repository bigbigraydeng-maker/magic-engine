/**
 * Meta Ads — resolve the "story" posts behind a client's ads.
 *
 * When a post/Reel is boosted, comments that arrive via paid delivery live on
 * the ad's effective object story (often a dark/unpublished page post), NOT on
 * the organic post — the organic Page endpoints undercount (e.g. a Reel showing
 * 3 organic comments but 67 total once boosted). Those story posts are still
 * page-owned, so their comments are readable + repliable with a Page token once
 * we discover their ids via the Ads API.
 *
 * Requires ads_read on the token + the client's ad account id. Graceful: returns
 * [] on any error so a missing scope / account never breaks the main flow.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

interface RawAd {
  creative?: {
    effective_object_story_id?: string
    object_story_id?: string
  }
}

/**
 * Return the unique page-post story ids behind an ad account's ads
 * (effective_object_story_id, falling back to object_story_id). These are the
 * posts that carry boosted-delivery comments. Paginates a few pages, deduped.
 */
export async function fetchAdStoryIds(
  adAccountId: string,
  accessToken: string,
  maxAds = 200,
): Promise<string[]> {
  const acct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
  const fields = 'creative{effective_object_story_id,object_story_id}'
  let url: string | null =
    `${GRAPH_BASE}/${acct}/ads?fields=${fields}&limit=50&access_token=${encodeURIComponent(accessToken)}`

  const ids = new Set<string>()
  let guard = 0
  let seen = 0
  while (url && seen < maxAds && guard < 8) {
    guard++
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      console.error('[meta/ads-posts] fetchAdStoryIds error:', err)
      break
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[meta/ads-posts] fetchAdStoryIds HTTP ${res.status}:`, body.slice(0, 200))
      break
    }
    const json = (await res.json()) as { data?: RawAd[]; paging?: { next?: string }; error?: { message: string } }
    if (json.error) {
      console.error('[meta/ads-posts] fetchAdStoryIds error:', json.error.message)
      break
    }
    for (const ad of json.data ?? []) {
      seen++
      const storyId = ad.creative?.effective_object_story_id ?? ad.creative?.object_story_id
      if (storyId) ids.add(storyId)
    }
    url = json.paging?.next ?? null
  }

  return Array.from(ids)
}
