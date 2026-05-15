export interface MetaAdData {
  domain: string
  activeAdsCount: number
  adTypes: string[]       // e.g. ['image', 'video', 'carousel']
  estimatedSpend: 'low' | 'medium' | 'high' | 'unknown'
  topAdCopy: string[]     // up to 3 headlines
}

/**
 * Scrape Meta Ad Library for a business's active ads.
 *
 * @param domain  brand name or domain to search the Ad Library for
 * @param country two-letter Meta Ad Library country code (default 'AU').
 *                Pass the brand's home market (e.g. 'SG', 'GB', 'US') for
 *                multi-market brands whose AU activity is sparse.
 */
export async function scrapeCompetitorMetaAds(
  domain: string,
  country: string = 'AU',
): Promise<MetaAdData> {
  const apiToken = process.env.APIFY_API_KEY
  if (!apiToken) throw new Error('APIFY_API_KEY is not set')

  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~facebook-ads-scraper/runs?token=${apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(country)}&q=${encodeURIComponent(domain)}&search_type=keyword_unordered` }],
        maxItems: 20,
      }),
    },
  )

  if (!res.ok) throw new Error(`Apify run error: ${res.status}`)

  const run = await res.json() as { data?: { id?: string } }
  const runId = run.data?.id
  if (!runId) throw new Error('Apify run did not return a run ID')

  // Poll for completion (max 30s)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000))
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`,
    )
    const status = await statusRes.json() as { data?: { status?: string; defaultDatasetId?: string } }
    if (status.data?.status === 'SUCCEEDED') {
      const datasetId = status.data.defaultDatasetId
      const itemsRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=20`,
      )
      const items = await itemsRes.json() as Array<{
        ad_creative_body?: string
        ad_creative_link_title?: string
        ad_delivery_type?: string
        spend?: string
      }>
      return normalizeAdData(domain, items)
    }
    if (status.data?.status === 'FAILED' || status.data?.status === 'ABORTED') {
      throw new Error(`Apify run ${runId} failed`)
    }
  }

  throw new Error(`Apify run ${runId} timed out`)
}

function normalizeAdData(
  domain: string,
  items: Array<{ ad_creative_body?: string; ad_creative_link_title?: string; ad_delivery_type?: string; spend?: string }>,
): MetaAdData {
  const adTypesSet = new Set(items.map(i => i.ad_delivery_type ?? 'image').filter(Boolean))
  const adTypes = Array.from(adTypesSet)
  const topAdCopy = items
    .slice(0, 3)
    .map(i => i.ad_creative_link_title ?? i.ad_creative_body ?? '')
    .filter(Boolean)

  const spendValues = items.map(i => i.spend ?? '').filter(Boolean)
  const estimatedSpend: MetaAdData['estimatedSpend'] =
    spendValues.length === 0 ? 'unknown'
    : spendValues.some(s => parseInt(s) > 5000) ? 'high'
    : spendValues.some(s => parseInt(s) > 500) ? 'medium'
    : 'low'

  return { domain, activeAdsCount: items.length, adTypes, estimatedSpend, topAdCopy }
}
