/**
 * DataForSEO SERP API — AI Overview + organic + paid results.
 *
 * Reference: ROADMAP.md P8.13.D.1
 *
 * Replaces the Apify google-search-scraper (src/lib/apify/google-search-scraper.ts)
 * as the primary SERP source. Apify is preserved as a fallback for the case
 * where DataForSEO credentials are unavailable.
 *
 * Returns the same shape as DiscoveredSerpResult so existing types / UI are
 * unaffected by the source swap.
 *
 * Authentication: Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD).
 *
 * Estimated cost: ~$0.005 per call (same as Apify).
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// AU=2036, NZ=2554
const LOCATION_CODE: Record<'au' | 'nz', number> = { au: 2036, nz: 2554 }

// ─── Organic target resolution ───────────────────────────────────────────────

/** Hosts that serve Google's SERP redirect links (google.com, www.google.co.nz, …). */
const GOOGLE_HOST_RE = /^(?:www\.)?google\.[a-z.]+$/i

/** Known social platforms → canonical domain, keyed by the lowercased website_name prefix. */
const PLATFORM_DOMAIN: Record<string, string> = {
  facebook:  'facebook.com',
  instagram: 'instagram.com',
  youtube:   'youtube.com',
  linkedin:  'linkedin.com',
  reddit:    'reddit.com',
  tiktok:    'tiktok.com',
  x:         'x.com',
  pinterest: 'pinterest.com',
}

/** A bare domain such as "brisbanesfinestfloors.au" (no scheme, no path). */
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

/**
 * Resolve the real destination of an organic SERP item.
 *
 * Since 2026-11-02 DataForSEO returns organic items as Google redirect links
 * (`https://google.com/goto?url=…`) with the real target only in `breadcrumb`
 * or `website_name`. This recovers the true URL/domain, and never returns the
 * Google redirect itself. Pure and non-throwing.
 */
export function resolveOrganicTarget(it: {
  url?:          string | null
  domain?:       string | null
  breadcrumb?:   string | null
  website_name?: string | null
}): { url: string; domain: string | null } {
  const rawUrl = it.url ?? ''

  // 1. Non-redirect URLs pass through unchanged.
  let isRedirect = false
  try {
    const parsed = new URL(rawUrl)
    isRedirect = GOOGLE_HOST_RE.test(parsed.hostname)
      && (parsed.pathname.startsWith('/goto') || parsed.pathname.startsWith('/url'))
  } catch {
    // Unparseable url — treat as non-redirect passthrough.
  }
  if (!isRedirect) {
    return { url: rawUrl, domain: it.domain ?? null }
  }

  // 2. Breadcrumb that starts with a scheme → cut at the first separator.
  const breadcrumb = it.breadcrumb ?? ''
  if (breadcrumb.startsWith('http://') || breadcrumb.startsWith('https://')) {
    const cut = breadcrumb.split(/ ›| ·|\s/)[0] ?? ''
    try {
      const parsed = new URL(cut)
      return { url: `${parsed.origin}${parsed.pathname}`, domain: parsed.hostname }
    } catch {
      // Fall through to website_name.
    }
  }

  // 3. website_name → platform domain or bare domain.
  const websiteName = it.website_name ?? ''
  const firstPart = websiteName.split(/·/)[0]?.trim().toLowerCase() ?? ''
  if (firstPart) {
    const platform = PLATFORM_DOMAIN[firstPart]
    if (platform) {
      return { url: `https://${platform}`, domain: platform }
    }
    if (BARE_DOMAIN_RE.test(firstPart)) {
      return { url: `https://${firstPart}`, domain: firstPart }
    }
  }

  // 4. Unresolvable — never return the Google link.
  return { url: '', domain: null }
}

// ─── Return type ─────────────────────────────────────────────────────────────

/** Shape matches DiscoveredSerpResult in zhangqian/types.ts. */
export interface DfseSerpResult {
  query:                   string
  organic_results:         Array<{
    position:    number
    title:       string
    url:         string
    description: string
  }>
  paid_advertiser_domains: string[]
  ai_overview_text:        string | null
  ai_overview_sources:     string[]
  /** Up to 3 Local Pack listings — present when Google shows a local map pack. */
  local_pack?:             Array<{
    name:         string
    rating:       number | null
    review_count: number | null
    address:      string | null
    /** Listing's website domain when Google exposes it — used to match the client. */
    domain:       string | null
  }>
  /** Up to 4 People Also Ask question texts — useful as FAQ Schema seed content. */
  people_also_ask?:        string[]
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader(): string {
  const login    = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Map a city slug (as stored in `industry_ai_visibility_questions.city`) to
 * its DataForSEO `location_code`. Verified live 2026-11-23 from
 * /v3/serp/google/locations. Keys are lowercase slugs. */
const CITY_LOCATION_CODE: Record<string, number> = {
  // Australia
  sydney:       1000286,
  melbourne:    1000567,
  brisbane:     1000339,
  perth:        1000676,
  adelaide:     1000422,
  'gold-coast': 1000665,
  gold_coast:   1000665,
  // New Zealand
  auckland:     1011036,
  wellington:   1011058,
  christchurch: 1011065,
  queenstown:   1011074,
}

export interface SerpOptions {
  /** Optional city slug — when set and mapped, DataForSEO uses that city's location_code instead of the country-level one. */
  city?: string | null
  /** Override language. Default 'en'. Use ISO 639-1 codes such as 'zh'. */
  language?: string
}

/**
 * Fetch a Google SERP page via DataForSEO: organic results, paid advertisers,
 * and the Google AI Overview answer.
 *
 * DataForSEO endpoint: /serp/google/organic/live/advanced
 *
 * @param query       Search term, e.g. "vinyl flooring brisbane"
 * @param countryCode 'au' (default) or 'nz'
 * @param options     Optional: city for city-level location, language override.
 */
export async function getSerpPage(
  query: string,
  countryCode: 'au' | 'nz' = 'au',
  options: SerpOptions = {},
): Promise<DfseSerpResult> {
  const language = options.language ?? 'en'

  // Build location: city-level if city provided AND mapped, else country-level
  let locationField: { location_code: number }
  if (options.city) {
    const cityCode = CITY_LOCATION_CODE[options.city.toLowerCase()]
    if (cityCode) {
      locationField = { location_code: cityCode }
    } else {
      // Unknown city slug — refuse rather than silently fall back to country
      throw new Error(`getSerpPage: unknown city slug "${options.city}". Add to CITY_LOCATION_CODE in serp.ts.`)
    }
  } else {
    locationField = { location_code: LOCATION_CODE[countryCode] }
  }

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          keyword:       query,
          ...locationField,
          language_code: language,
          depth:         10,
          se_domain:     countryCode === 'nz' ? 'google.co.nz' : 'google.com.au',
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO SERP error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      status_code?: number
      status_message?: string
      result?: Array<{
        items?: Array<{
          type?:                  string
          rank_absolute?:         number
          title?:                 string | null
          url?:                   string | null
          description?:           string | null
          domain?:                string | null
          breadcrumb?:            string | null
          website_name?:          string | null
          rating?:                number | null
          reviews_count?:         number | null
          address?:               string | null
          // type 'ai_overview' (verified against a live response 2026-10-05):
          // text lives in items[].text, sources in top-level references[].
          markdown?:              string | null
          items?:                 Array<{ text?: string | null }> | null
          references?:            Array<{ url?: string | null }> | null
        }>
      }>
    }>
  }

  const task = json.tasks?.[0]
  if (task?.status_code !== 20000) {
    throw new Error(
      `DataForSEO SERP task ${task?.status_code ?? 'missing'}: ${task?.status_message ?? 'unknown'}`,
    )
  }

  const items = task.result?.[0]?.items ?? []

  // Filter out non-commercial domains (govt, edu, org, ac) — these inflate
  // the "competitive landscape" with entities that are not business rivals.
  const NON_COMMERCIAL_RE = /\.(govt|gov|org|edu|ac)\.|\.govt$|\.gov$|\.org$|\.edu$|\.ac$/i

  const organicResults = items
    .filter(it => it.type === 'organic')
    .map(it => ({ it, target: resolveOrganicTarget(it) }))
    .filter(({ target }) => target.url !== '' && !NON_COMMERCIAL_RE.test(target.url))
    .slice(0, 10)
    .map(({ it, target }) => ({
      position:    it.rank_absolute ?? 0,
      title:       it.title        ?? '',
      url:         target.url,
      description: it.description  ?? '',
    }))

  const paidDomains = Array.from(new Set(
    items
      .filter(it => it.type === 'paid')
      .map(it => it.domain ?? '')
      .filter(Boolean),
  ))

  const aiItem = items.find(it => it.type === 'ai_overview')
  const aiBody = (aiItem?.items ?? [])
    .map(e => e.text ?? '')
    .filter(Boolean)
    .join('\n\n')
  const aiOverviewText    = aiItem ? (aiBody || aiItem.markdown || null) : null
  const aiOverviewSources = Array.from(new Set(
    (aiItem?.references ?? []).map(r => r.url ?? '').filter(Boolean),
  ))

  const localPack = items
    .filter(it => it.type === 'local_pack')
    .slice(0, 3)
    .map(it => ({
      name:         it.title        ?? '',
      rating:       it.rating       ?? null,
      review_count: it.reviews_count ?? null,
      address:      it.address      ?? null,
      domain:       it.domain       ?? null,
    }))

  const peopleAlsoAsk = items
    .filter(it => it.type === 'people_also_ask')
    .slice(0, 4)
    .map(it => it.title ?? '')
    .filter(Boolean)

  return {
    query,
    organic_results:         organicResults,
    paid_advertiser_domains: paidDomains,
    ai_overview_text:        aiOverviewText,
    ai_overview_sources:     aiOverviewSources,
    ...(localPack.length > 0      && { local_pack:       localPack }),
    ...(peopleAlsoAsk.length > 0  && { people_also_ask:  peopleAlsoAsk }),
  }
}

// ─── Organic rank snapshot (SEO meta-cycle rank verification) ────────────────

/**
 * One organic result as Google ranked it.
 *
 * `rankGroup` is the position among ORGANIC results only. `rankAbsolute`
 * (what `getSerpPage` exposes as `position`) counts every SERP block — AI
 * Overview, People-also-ask, video carousels — so it shifts by 1–3 whenever
 * Google adds a block, with no real ranking change. A before/after rank
 * comparison must use `rankGroup`.
 */
export interface OrganicRankItem {
  rankGroup:    number
  rankAbsolute: number | null
  url:          string
  domain:       string | null
}

export interface OrganicRankSnapshot {
  query:     string
  /** Depth requested — every later sample compared against this one must use the same value. */
  depth:     number
  /** Unfiltered organic results (no .gov/.org/.edu filtering, no top-10 cut) in the order Google returned them. May contain duplicate URLs. */
  items:     OrganicRankItem[]
  /** DataForSEO's own per-task cost in USD when reported, else null. */
  cost:      number | null
  fetchedAt: string
}

/** DataForSEO bills per 10 results and the live endpoint caps at 700; 100 is far more than any rank check needs. */
const MAX_RANK_DEPTH = 100

/**
 * Live organic ranks for one query, for rank-before/after comparisons.
 *
 * Deliberately a separate function from `getSerpPage`: that one filters
 * non-commercial domains and truncates to 10, both of which would corrupt a
 * rank number. Request parameters are fixed (country-level location, desktop,
 * `en`, explicit depth) so two calls are comparable.
 */
export async function getOrganicRanks(
  query: string,
  countryCode: 'au' | 'nz',
  options: { depth: number; language?: string },
): Promise<OrganicRankSnapshot> {
  const { depth } = options
  if (!Number.isInteger(depth) || depth < 10 || depth > MAX_RANK_DEPTH) {
    throw new Error(`getOrganicRanks: depth must be an integer in [10, ${MAX_RANK_DEPTH}], got ${depth}`)
  }

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          keyword:       query,
          location_code: LOCATION_CODE[countryCode],
          language_code: options.language ?? 'en',
          device:        'desktop',
          depth,
          se_domain:     countryCode === 'nz' ? 'google.co.nz' : 'google.com.au',
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO SERP error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      status_code?:    number
      status_message?: string
      cost?:           number
      result?: Array<{
        items?: Array<{
          type?:          string
          rank_group?:    number
          rank_absolute?: number
          url?:           string | null
          domain?:        string | null
          breadcrumb?:    string | null
          website_name?:  string | null
        }>
      }>
    }>
  }

  const task = json.tasks?.[0]
  if (task?.status_code !== 20000) {
    throw new Error(
      `DataForSEO SERP task ${task?.status_code ?? 'missing'}: ${task?.status_message ?? 'unknown'}`,
    )
  }

  const items: OrganicRankItem[] = (task.result?.[0]?.items ?? [])
    .filter(it => it.type === 'organic' && typeof it.rank_group === 'number')
    .map(it => ({ it, target: resolveOrganicTarget(it) }))
    .filter(({ target }) => target.url !== '')
    .map(({ it, target }) => ({
      rankGroup:    it.rank_group as number,
      rankAbsolute: typeof it.rank_absolute === 'number' ? it.rank_absolute : null,
      url:          target.url,
      domain:       target.domain,
    }))

  return {
    query,
    depth,
    items,
    cost: typeof task.cost === 'number' ? task.cost : null,
    fetchedAt: new Date().toISOString(),
  }
}

// ─── Google Ads presence (replaces Apify google-ads-transparency.ts) ─────────

/**
 * Mirrors the GoogleAdsData shape from the deleted Apify scraper so callers
 * (ads-collector.ts, advanced-agent.ts) require no structural changes.
 *
 * adFormats / regions / topAdPreviews are always [] — DataForSEO SERP does not
 * return that level of detail. Callers must handle empty adFormats gracefully.
 */
export interface GoogleAdsData {
  advertiser:      string
  activeAdsCount:  number
  adFormats:       string[]   // always [] — not available via SERP endpoint
  regions:         string[]   // always [] — not available via SERP endpoint
  topAdPreviews:   string[]   // always [] — not available via SERP endpoint
}

/**
 * Detect whether a brand is running Google Ads by searching their brand name
 * and checking if their domain appears in paid results.
 *
 * Replaces: scrapeGoogleAdsTransparency (Apify easyapi actor).
 *
 * @param brandName    Brand name or domain to search.
 * @param market       'AU' or 'NZ' (case-insensitive).
 * @param clientDomain Client's own domain (used to match paid_advertiser_domains).
 */
export async function getGoogleAdsPresence(
  brandName:    string,
  market:       string = 'AU',
  clientDomain?: string,
): Promise<GoogleAdsData> {
  const countryCode = market.toLowerCase() === 'nz' ? 'nz' : 'au' as const
  const serp = await getSerpPage(brandName, countryCode)

  // Derive a stem to match against paid_advertiser_domains.
  // Prefer explicit clientDomain; fall back to stripping brandName to a slug.
  const stem = clientDomain
    ? clientDomain.replace(/^https?:\/\//, '').split('/')[0].toLowerCase()
    : brandName.toLowerCase().replace(/\s+/g, '').substring(0, 12)

  const isAdvertising = serp.paid_advertiser_domains.some(d => {
    const dl = d.toLowerCase()
    return dl.includes(stem) || stem.includes(dl.replace(/\.[^.]+$/, ''))
  })

  return {
    advertiser:     brandName,
    activeAdsCount: isAdvertising ? 1 : 0,
    adFormats:      [],
    regions:        [],
    topAdPreviews:  [],
  }
}
