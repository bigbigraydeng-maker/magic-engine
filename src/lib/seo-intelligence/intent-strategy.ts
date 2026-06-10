export type SearchIntent = 'transactional' | 'commercial' | 'informational' | 'navigational'

export interface IntentKeyword {
  keyword: string
  position?: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  intent: string
}

export interface TrafficSplitBucket {
  keywords: number
  estimated_traffic: number
  search_volume: number
  share: number
}

export interface BrandTrafficSplit {
  branded: TrafficSplitBucket
  non_branded: TrafficSplitBucket
}

export interface ContentPriorityKeyword extends IntentKeyword {
  is_branded: boolean
  estimated_traffic: number
}

const INTENT_WEIGHT: Record<SearchIntent, number> = {
  transactional: 0,
  commercial: 1,
  informational: 2,
  navigational: 3,
}

export function isBrandedKeyword(keyword: string, brandRoot: string): boolean {
  const normalizedBrand = brandRoot.trim().toLowerCase()
  if (!normalizedBrand) return false

  return keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some(token => token === normalizedBrand)
}

/**
 * Alias-aware branded-keyword detection for SEO-Intelligence views
 * (Organic Rankings card and consumers downstream).
 *
 * 2026-06-11 P0 fix — Why this exists alongside `isBrandedKeyword`:
 *   The legacy `isBrandedKeyword` matches by *token equality* against a single
 *   domain-root string. For multi-word brands (CTS Tours → root "ctstours"),
 *   real GSC/DataForSEO keyword strings ("cts tours auckland", "cts travel
 *   nz") tokenise to ["cts","tours","auckland",…] and never produce a token
 *   equal to the compound root "ctstours" → branded% reads ~0 on real data.
 *
 *   This wrapper mirrors the substring-based pattern already used in
 *   `auto-fetch.ts → isBrandQueryMatch` (PR #336): it consults `brand_aliases`
 *   (FDE-supplied) as substrings, falling back to brandRoot as a substring.
 *   It is intentionally NOT a drop-in replacement for `isBrandedKeyword`:
 *   the seo-agent assembler still uses token equality because it is filtering
 *   keyword candidates for content briefs (a wider matcher there would suppress
 *   legitimate non-branded content opportunities). See assembler.ts.
 *
 * Matcher candidates (any hit = branded):
 *   1. Any entry in `brandAliases` appears as a substring of the keyword.
 *   2. `brandRoot` (single string, typically domain root) appears as a
 *      substring of the keyword.
 *
 * Both checks are case-insensitive with whitespace collapsed; aliases shorter
 * than 2 characters are ignored (defensive guard against accidentally-empty
 * FDE input).
 *
 * @param keyword       The keyword / query to classify
 * @param brandRoot     Single brand stem (e.g. domain root); null = skip this check
 * @param brandAliases  FDE-configured alias array (clients.brand_aliases); null/empty = skip this check
 */
export function isBrandedKeywordWithAliases(
  keyword: string,
  brandRoot: string | null,
  brandAliases: string[] | null,
): boolean {
  const q = keyword.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!q) return false

  if (Array.isArray(brandAliases)) {
    for (const alias of brandAliases) {
      if (typeof alias !== 'string') continue
      const a = alias.toLowerCase().replace(/\s+/g, ' ').trim()
      if (a.length >= 2 && q.includes(a)) return true
    }
  }

  // brandRoot fallback uses a stricter min-length (5) than aliases (2). Why:
  // brandRoot is auto-derived from clients.domain (no FDE judgment), so a
  // generic short root like "tours" (from tours.co.nz), "tour", "care",
  // "shop" would substring-match a flood of non-branded queries
  // ("new zealand tours" → branded? NO). Aliases are FDE-curated, so we trust
  // 2-char minimums there; the auto-derived path needs a higher bar. CTS
  // ('ctstours' = 8) and Oztop ('oztop' = 5) both clear this gate; clients
  // with a shorter / more generic root MUST configure brand_aliases
  // explicitly via the Settings page.
  if (brandRoot) {
    const r = brandRoot.toLowerCase().replace(/\s+/g, ' ').trim()
    if (r.length >= 5 && q.includes(r)) return true
  }

  return false
}

export function estimateKeywordTraffic(keyword: IntentKeyword): number {
  const volume = keyword.search_volume ?? 0
  if (volume <= 0) return 0

  return Math.round(volume * ctrForPosition(keyword.position ?? null))
}

export function buildBrandTrafficSplit(
  keywords: IntentKeyword[],
  brandRoot: string,
  brandAliases: string[] | null = null,
): BrandTrafficSplit {
  const totals = {
    branded: buildEmptyBucket(),
    non_branded: buildEmptyBucket(),
  }

  for (const keyword of keywords) {
    const branded = isBrandedKeywordWithAliases(keyword.keyword, brandRoot, brandAliases)
    const bucket = branded ? totals.branded : totals.non_branded
    bucket.keywords += 1
    bucket.search_volume += keyword.search_volume ?? 0
    bucket.estimated_traffic += estimateKeywordTraffic(keyword)
  }

  const totalTraffic = totals.branded.estimated_traffic + totals.non_branded.estimated_traffic
  return {
    branded: withShare(totals.branded, totalTraffic),
    non_branded: withShare(totals.non_branded, totalTraffic),
  }
}

export function prioritizeContentKeywords(
  keywords: IntentKeyword[],
  brandRoot: string,
  limit = 8,
  brandAliases: string[] | null = null,
): ContentPriorityKeyword[] {
  return keywords
    .map(keyword => ({
      ...keyword,
      is_branded: isBrandedKeywordWithAliases(keyword.keyword, brandRoot, brandAliases),
      estimated_traffic: estimateKeywordTraffic(keyword),
    }))
    .filter(keyword => !keyword.is_branded)
    .filter(keyword => keyword.intent !== 'navigational')
    .sort(compareByContentPriority)
    .slice(0, limit)
}

export function sortByIntentPriority<T extends IntentKeyword>(
  keywords: T[],
  brandRoot: string,
  brandAliases: string[] | null = null,
): T[] {
  return [...keywords].sort((a, b) => {
    const aBranded = isBrandedKeywordWithAliases(a.keyword, brandRoot, brandAliases)
    const bBranded = isBrandedKeywordWithAliases(b.keyword, brandRoot, brandAliases)
    return intentWeight(a.intent) - intentWeight(b.intent) ||
      Number(aBranded) - Number(bBranded) ||
      (b.search_volume ?? 0) - (a.search_volume ?? 0) ||
      (a.keyword_difficulty ?? 999) - (b.keyword_difficulty ?? 999) ||
      (a.position ?? 999) - (b.position ?? 999)
  })
}

function compareByContentPriority(a: ContentPriorityKeyword, b: ContentPriorityKeyword): number {
  return intentWeight(a.intent) - intentWeight(b.intent) ||
    (b.search_volume ?? 0) - (a.search_volume ?? 0) ||
    (a.keyword_difficulty ?? 999) - (b.keyword_difficulty ?? 999) ||
    (a.position ?? 999) - (b.position ?? 999)
}

function intentWeight(intent: string): number {
  return INTENT_WEIGHT[intent as SearchIntent] ?? INTENT_WEIGHT.informational
}

function ctrForPosition(position: number | null): number {
  if (position === null || position <= 0) return 0
  if (position === 1) return 0.28
  if (position === 2) return 0.15
  if (position === 3) return 0.11
  if (position <= 5) return 0.07
  if (position <= 10) return 0.035
  if (position <= 20) return 0.012
  if (position <= 50) return 0.004
  return 0.001
}

function buildEmptyBucket(): TrafficSplitBucket {
  return {
    keywords: 0,
    estimated_traffic: 0,
    search_volume: 0,
    share: 0,
  }
}

function withShare(bucket: TrafficSplitBucket, totalTraffic: number): TrafficSplitBucket {
  return {
    ...bucket,
    share: totalTraffic > 0 ? Math.round((bucket.estimated_traffic / totalTraffic) * 100) : 0,
  }
}
