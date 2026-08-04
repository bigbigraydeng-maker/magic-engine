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

/** Country full-names for DataForSEO `location_name` city builds. */
const COUNTRY_FULL_NAME: Record<'au' | 'nz', string> = {
  au: 'Australia',
  nz: 'New Zealand',
}

/** Map a city slug (as stored in `industry_ai_visibility_questions.city`) to
 * its DataForSEO-recognized display name. Keys are lowercase slugs; values
 * are the city display name DataForSEO accepts in `location_name`. */
const CITY_DISPLAY_NAME: Record<string, string> = {
  // New Zealand
  auckland:    'Auckland',
  wellington:  'Wellington',
  christchurch:'Christchurch',
  queenstown:  'Queenstown',
  // Australia
  sydney:      'Sydney',
  melbourne:   'Melbourne',
  brisbane:    'Brisbane',
  perth:       'Perth',
  adelaide:    'Adelaide',
  'gold-coast':'Gold Coast',
  gold_coast:  'Gold Coast',
}

export interface SerpOptions {
  /** Optional city slug — when set, DataForSEO uses location_name = "{City},{Country}" instead of country-level location_code. */
  city?: string | null
  /** Override language. Default 'en'. Use 'zh-CN' for Chinese questions. */
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
  let locationField: { location_name: string } | { location_code: number }
  if (options.city) {
    const cityDisplay = CITY_DISPLAY_NAME[options.city.toLowerCase()]
    if (cityDisplay) {
      locationField = { location_name: `${cityDisplay},${COUNTRY_FULL_NAME[countryCode]}` }
    } else {
      // Unknown city slug — refuse rather than silently fall back to country
      throw new Error(`getSerpPage: unknown city slug "${options.city}". Add to CITY_DISPLAY_NAME in serp.ts.`)
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
      result?: Array<{
        items?: Array<{
          type?:                  string
          rank_absolute?:         number
          title?:                 string | null
          url?:                   string | null
          description?:           string | null
          domain?:                string | null
          rating?:                number | null
          reviews_count?:         number | null
          address?:               string | null
          ai_overview?: {
            text?:         string | null
            references?: Array<{
              url?:   string | null
              title?: string | null
            }>
          } | null
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  // Filter out non-commercial domains (govt, edu, org, ac) — these inflate
  // the "competitive landscape" with entities that are not business rivals.
  const NON_COMMERCIAL_RE = /\.(govt|gov|org|edu|ac)\.|\.govt$|\.gov$|\.org$|\.edu$|\.ac$/i

  const organicResults = items
    .filter(it => it.type === 'organic')
    .filter(it => {
      const url = it.url ?? ''
      return !NON_COMMERCIAL_RE.test(url)
    })
    .slice(0, 10)
    .map(it => ({
      position:    it.rank_absolute ?? 0,
      title:       it.title        ?? '',
      url:         it.url          ?? '',
      description: it.description  ?? '',
    }))

  const paidDomains = Array.from(new Set(
    items
      .filter(it => it.type === 'paid')
      .map(it => it.domain ?? '')
      .filter(Boolean),
  ))

  const aiItem = items.find(it => it.type === 'ai_overview')
  const aiOverviewText    = aiItem?.ai_overview?.text ?? null
  const aiOverviewSources = (aiItem?.ai_overview?.references ?? [])
    .map(r => r.url ?? '')
    .filter(Boolean)

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
