/**
 * Google Ads Keyword Planner — generate keyword ideas with search-volume
 * range, competition, and top-of-page bid range for a given seed set,
 * scoped to specific geo targets and language.
 *
 * REST endpoint: POST /v25/customers/{customer_id}:generateKeywordIdeas
 *
 * Docs: https://developers.google.com/google-ads/api/rest/reference/rest/v25/customers/generateKeywordIdeas
 *
 * Google Ads returns quantised search volume (rounded to buckets) — not an
 * exact number. That is the same signal the Google Ads UI shows and is the
 * closest thing to "official" NZ keyword-volume data available; the trade-
 * off is coarser granularity than DataForSEO Labs.
 *
 * Metrics fields are in micros (1_000_000 micros = 1 currency unit).
 */

import { getAccessToken, type GoogleAdsCreds } from './client'

const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v25'

// ── Well-known constants ─────────────────────────────────────────────────────

/**
 * Google Ads `geoTargetConstants/{id}` map — the numeric IDs match the same
 * ISO-3166 country codes used elsewhere in ME (see `src/lib/dataforseo/`).
 */
export const GEO_TARGET_CONSTANT_ID: Record<'NZ' | 'AU' | 'CA' | 'UK' | 'DE' | 'ES' | 'SG', number> = {
  NZ: 2554,
  AU: 2036,
  CA: 2124,
  UK: 2826,
  DE: 2276,
  ES: 2724,
  SG: 2702,
}

/**
 * Google Ads `languageConstants/{id}` — only the languages ME markets serve.
 * Full list: https://developers.google.com/google-ads/api/reference/data/codes-formats#languages
 */
export const LANGUAGE_CONSTANT_ID: Record<'en' | 'de' | 'es' | 'zh_CN' | 'zh_TW', number> = {
  en:    1000,
  de:    1001,
  es:    1003,
  zh_CN: 1017,
  zh_TW: 1018,
}

// ── Types ────────────────────────────────────────────────────────────────────

/** Competition level Google Ads reports for a keyword. */
export type KeywordCompetition = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNSPECIFIED' | 'UNKNOWN'

export interface KeywordIdea {
  /** Keyword text (may be a seed you passed, or a related keyword Google added). */
  text: string
  /** Avg monthly searches Google reports for the geo+language scope. Null when Google doesn't have data. */
  avg_monthly_searches: number | null
  /** Bucketed competition label. */
  competition: KeywordCompetition
  /** 0–100 competition index; null when Google doesn't have data. */
  competition_index: number | null
  /** Low top-of-page bid, in account currency (converted from micros). Null when Google doesn't have data. */
  low_top_of_page_bid: number | null
  /** High top-of-page bid, in account currency (converted from micros). Null when Google doesn't have data. */
  high_top_of_page_bid: number | null
  /** Average CPC in account currency (converted from micros). Null when Google doesn't have data. */
  average_cpc: number | null
}

export interface GenerateKeywordIdeasParams {
  /** Seed keywords Google expands from. Max 20 per Google Ads API. */
  keywords: string[]
  /** One or more geo target constant IDs (e.g. `[2554]` for NZ). Defaults to `[NZ]`. */
  geoTargetIds?: number[]
  /** Language constant ID (e.g. `1000` for English). Defaults to English. */
  languageId?: number
  /** Include adult keywords in results. Defaults to false. */
  includeAdultKeywords?: boolean
  /**
   * Keyword-plan network scope:
   *   - `GOOGLE_SEARCH`               — Google.com only
   *   - `GOOGLE_SEARCH_AND_PARTNERS`  — includes syndication partners (default)
   */
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS'
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate keyword ideas for a seed set within a geo+language scope.
 *
 * Returns [] on API failure — same pattern as the other client.ts helpers,
 * so cron/route handlers can log and skip the client without blowing up
 * the whole batch. Auth failure and missing seed are the only conditions
 * that throw.
 */
export async function generateKeywordIdeas(
  creds: GoogleAdsCreds,
  params: GenerateKeywordIdeasParams,
): Promise<KeywordIdea[]> {
  const seeds = params.keywords.map(k => k.trim()).filter(Boolean).slice(0, 20)
  if (seeds.length === 0) {
    throw new Error('generateKeywordIdeas: at least one non-empty seed keyword is required')
  }

  const geoTargetIds = params.geoTargetIds && params.geoTargetIds.length > 0
    ? params.geoTargetIds
    : [GEO_TARGET_CONSTANT_ID.NZ]
  const languageId = params.languageId ?? LANGUAGE_CONSTANT_ID.en
  const network    = params.network ?? 'GOOGLE_SEARCH_AND_PARTNERS'

  const accessToken = await getAccessToken(creds)
  const url = `${GOOGLE_ADS_API_BASE}/customers/${creds.customerId}:generateKeywordIdeas`

  const body = {
    language:             `languageConstants/${languageId}`,
    geoTargetConstants:   geoTargetIds.map(id => `geoTargetConstants/${id}`),
    includeAdultKeywords: params.includeAdultKeywords === true,
    keywordPlanNetwork:   network,
    keywordSeed:          { keywords: seeds },
  }

  const headers: Record<string, string> = {
    'Authorization':   `Bearer ${accessToken}`,
    'developer-token': creds.developerToken,
    'Content-Type':    'application/json',
  }
  if (creds.managerCustomerId) headers['login-customer-id'] = creds.managerCustomerId

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (err) {
    console.error('[google-ads/keyword-planner] fetch error:', err)
    return []
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    console.error(`[google-ads/keyword-planner] HTTP ${res.status}:`, bodyText.slice(0, 300))
    return []
  }

  const json = await res.json() as {
    results?: Array<{
      text?: string
      keywordIdeaMetrics?: {
        avgMonthlySearches?:    string | number | null
        competition?:           string | null
        competitionIndex?:      string | number | null
        lowTopOfPageBidMicros?: string | number | null
        highTopOfPageBidMicros?:string | number | null
        averageCpcMicros?:      string | number | null
      } | null
    }>
  }

  return (json.results ?? []).flatMap(row => {
    const text = row.text?.trim()
    if (!text) return []
    const m = row.keywordIdeaMetrics ?? {}
    return [{
      text,
      avg_monthly_searches: numOrNull(m.avgMonthlySearches),
      competition:          normaliseCompetition(m.competition),
      competition_index:    numOrNull(m.competitionIndex),
      low_top_of_page_bid:  microsToCurrency(m.lowTopOfPageBidMicros),
      high_top_of_page_bid: microsToCurrency(m.highTopOfPageBidMicros),
      average_cpc:          microsToCurrency(m.averageCpcMicros),
    }]
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function numOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function microsToCurrency(v: string | number | null | undefined): number | null {
  const n = numOrNull(v)
  return n === null ? null : n / 1_000_000
}

function normaliseCompetition(v: string | null | undefined): KeywordCompetition {
  const s = (v ?? '').toUpperCase()
  if (s === 'LOW' || s === 'MEDIUM' || s === 'HIGH' || s === 'UNSPECIFIED') return s
  return 'UNKNOWN'
}
