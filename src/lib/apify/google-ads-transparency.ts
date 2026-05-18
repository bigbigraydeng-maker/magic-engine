/**
 * Google Ads Transparency Center scraper via Apify.
 *
 * Used by the diagnostic engine to determine whether a brand is actively
 * running Google Ads (Search / Display / YouTube / Shopping), how many ads
 * are live, and what creative formats appear.
 *
 * Apify actor: `easyapi/google-ads-transparency-center-scraper`
 *   (any compatible actor that accepts a brand search and returns ad items
 *   with format/region metadata will work — the runner is generic.)
 */

export interface GoogleAdsData {
  /** Advertiser name or domain queried */
  advertiser: string
  /** Count of active ads observed in the Transparency Center */
  activeAdsCount: number
  /** Distinct creative formats — e.g. ['text', 'image', 'video', 'shopping'] */
  adFormats: string[]
  /** Distinct regions where ads were running (ISO country codes) */
  regions: string[]
  /** Sample headlines / preview text (up to 3) */
  topAdPreviews: string[]
}

const APIFY_BASE = 'https://api.apify.com/v2'
const POLL_INTERVAL_MS = 2_000
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Query the Google Ads Transparency Center for a given advertiser/brand.
 *
 * @param advertiser  brand name or domain (Apify resolves the advertiser ID)
 * @param region      two-letter region code to filter by (default 'AU')
 */
export async function scrapeGoogleAdsTransparency(
  advertiser: string,
  region: string = 'AU',
): Promise<GoogleAdsData> {
  const apiToken = process.env.APIFY_API_KEY
  if (!apiToken) throw new Error('APIFY_API_KEY is not set')

  const startRes = await fetch(
    `${APIFY_BASE}/acts/easyapi~google-ads-transparency-center-scraper/runs?token=${apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchTerms: [advertiser],
        regions: [region],
        maxItems: 20,
      }),
    },
  )

  if (!startRes.ok) throw new Error(`Apify Google Ads run error: ${startRes.status}`)

  const run = (await startRes.json()) as { data?: { id?: string } }
  const runId = run.data?.id
  if (!runId) throw new Error('Apify Google Ads run did not return a run ID')

  const deadline = Date.now() + DEFAULT_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))

    const statusRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apiToken}`)
    const status = (await statusRes.json()) as {
      data?: { status?: string; defaultDatasetId?: string }
    }

    if (status.data?.status === 'SUCCEEDED') {
      const datasetId = status.data.defaultDatasetId
      const itemsRes = await fetch(
        `${APIFY_BASE}/datasets/${datasetId}/items?token=${apiToken}&limit=20`,
      )
      const items = (await itemsRes.json()) as Array<{
        format?: string
        creative_type?: string
        region?: string
        regions?: string[]
        text?: string
        headline?: string
        preview_text?: string
      }>
      return normalizeGoogleAdsData(advertiser, items)
    }

    if (status.data?.status === 'FAILED' || status.data?.status === 'ABORTED') {
      throw new Error(`Apify Google Ads run ${runId} failed`)
    }
  }

  throw new Error(`Apify Google Ads run ${runId} timed out`)
}

function normalizeGoogleAdsData(
  advertiser: string,
  items: Array<{
    format?: string
    creative_type?: string
    region?: string
    regions?: string[]
    text?: string
    headline?: string
    preview_text?: string
  }>,
): GoogleAdsData {
  const formatSet = new Set<string>()
  const regionSet = new Set<string>()

  for (const item of items) {
    const fmt = item.format ?? item.creative_type
    if (fmt) formatSet.add(fmt.toLowerCase())

    if (item.region) regionSet.add(item.region.toUpperCase())
    for (const r of item.regions ?? []) regionSet.add(r.toUpperCase())
  }

  const topAdPreviews = items
    .slice(0, 3)
    .map(i => i.headline ?? i.preview_text ?? i.text ?? '')
    .filter(Boolean)

  return {
    advertiser,
    activeAdsCount: items.length,
    adFormats: Array.from(formatSet),
    regions: Array.from(regionSet),
    topAdPreviews,
  }
}
