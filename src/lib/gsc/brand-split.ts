export type BrandBucket = 'brand' | 'ambiguous' | 'non_brand'

export interface BrandMatcher {
  readonly brand: readonly string[]
  readonly ambiguous: readonly string[]
}

export type BrandConfigResult =
  | { readonly status: 'ok'; readonly matcher: BrandMatcher }
  | { readonly status: 'brand_terms_not_configured' }

export interface QueryRow {
  readonly query: string
  readonly clicks: number
  readonly impressions: number
  readonly position: number
}

export interface BucketTotals {
  clicks: number
  impressions: number
  distinct_queries: number
  position: number | null
}

export interface SuspectQuery {
  query: string
  clicks: number
  impressions: number
}

export interface BrandSplitResult {
  brand: BucketTotals
  ambiguous: BucketTotals
  non_brand: BucketTotals
  suspect_missed_brand: SuspectQuery[]
}

export function normalizeQueryText(text: string): string {
  const nfkc = text.normalize('NFKC')
  const nfd = nfkc.normalize('NFD')
  const withoutMarks = nfd.replace(/\p{M}/gu, '')
  const lowered = withoutMarks.toLowerCase()
  const withoutApostrophes = lowered.replace(/['\u2019\u2018`]/g, '')
  const spaced = withoutApostrophes.replace(/[^\p{L}\p{N}]/gu, ' ')
  const collapsed = spaced.replace(/ +/g, ' ')
  return collapsed.trim()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string') out.push(entry)
  }
  return out
}

function normalizeTerms(raw: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const term of raw) {
    const normalized = normalizeQueryText(term)
    if (normalized.length < 2) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function deriveDomainStems(siteUrl: string): string[] {
  let host: string
  try {
    // Domain properties are written "sc-domain:example.com" (no scheme) — URL() would read that as a scheme.
    const asUrl = siteUrl.startsWith('sc-domain:') ? `https://${siteUrl.slice('sc-domain:'.length)}` : siteUrl
    host = new URL(asUrl).host
  } catch {
    return []
  }
  if (host.length === 0) return []
  const withoutWww = host.startsWith('www.') ? host.slice(4) : host
  const firstDot = withoutWww.indexOf('.')
  const stem = firstDot === -1 ? withoutWww : withoutWww.slice(0, firstDot)
  if (stem.length === 0) return []
  const normalizedStem = normalizeQueryText(stem)
  if (normalizedStem.length === 0) return []
  const stems: string[] = [normalizedStem]
  const joined = normalizedStem.replace(/ /g, '')
  if (joined.length > 0 && joined !== normalizedStem) stems.push(joined)
  return stems
}

/**
 * @param seoConfig  untrusted `clients.seo_config` JSON
 * @param siteUrl    the client's GSC property (used only to derive a domain stem, see below)
 * @param fallbackBrandTerms  the client's existing `clients.brand_aliases` list. Used ONLY when `seo_config` has no
 *   `brand_terms` array at all, so a client that already maintains aliases (Settings has a panel for them) is not
 *   asked to type the same words twice. An explicit `brand_terms` always wins.
 */
export function readBrandConfig(
  seoConfig: unknown,
  siteUrl?: string | null,
  fallbackBrandTerms?: unknown,
): BrandConfigResult {
  const cfg: Record<string, unknown> = isPlainObject(seoConfig) ? seoConfig : {}

  const brandRaw = Array.isArray(cfg['brand_terms']) ? cfg['brand_terms'] : fallbackBrandTerms
  if (!Array.isArray(brandRaw)) {
    return { status: 'brand_terms_not_configured' }
  }

  const brandTerms = normalizeTerms(toStringArray(brandRaw))
  if (brandTerms.length === 0) {
    return { status: 'brand_terms_not_configured' }
  }

  const ambiguousRaw = cfg['brand_ambiguous_terms']
  const ambiguousTerms = normalizeTerms(toStringArray(ambiguousRaw))

  const brandSet = new Set(brandTerms)
  const ambiguousFiltered = ambiguousTerms.filter((term) => !brandSet.has(term))

  if (typeof siteUrl === 'string') {
    // The domain stem is only added when it STARTS with a configured brand term (e.g. configured "abc",
    // domain "abctours.example"): a domain made of a generic word ("travel.example") must not turn every query
    // containing that word into a brand query, and a short term ("nal") must not drag in "international" (a brand extension starts with the brand). Anything else the domain suggests is reported through
    // `suspect_missed_brand`, for a person to add to the configuration.
    const compactBrand = brandTerms.filter((t) => isAscii(t)).map((t) => t.replace(/ /g, ''))
    for (const stem of deriveDomainStems(siteUrl)) {
      if (stem.length < 2) continue
      if (brandSet.has(stem)) continue
      const compactStem = stem.replace(/ /g, '')
      if (!compactBrand.some((t) => t.length >= 2 && compactStem.startsWith(t))) continue
      brandSet.add(stem)
      brandTerms.push(stem)
    }
  }

  return {
    status: 'ok',
    matcher: {
      brand: brandTerms,
      ambiguous: ambiguousFiltered,
    },
  }
}

function isAscii(term: string): boolean {
  for (let i = 0; i < term.length; i++) {
    if (term.charCodeAt(i) > 127) return false
  }
  return true
}

function termMatches(normalizedQuery: string, term: string): boolean {
  let hasNonAscii = false
  for (let i = 0; i < term.length; i++) {
    if (term.charCodeAt(i) > 127) {
      hasNonAscii = true
      break
    }
  }
  if (hasNonAscii) {
    return normalizedQuery.includes(term)
  }
  return ` ${normalizedQuery} `.includes(` ${term} `)
}

export function classifyQuery(query: string, matcher: BrandMatcher): BrandBucket {
  const normalized = normalizeQueryText(query)
  for (const term of matcher.brand) {
    if (termMatches(normalized, term)) return 'brand'
  }
  for (const term of matcher.ambiguous) {
    if (termMatches(normalized, term)) return 'ambiguous'
  }
  return 'non_brand'
}

interface BucketAccumulator {
  clicks: number
  impressions: number
  positionWeighted: number
  queries: Set<string>
}

function emptyAccumulator(): BucketAccumulator {
  return { clicks: 0, impressions: 0, positionWeighted: 0, queries: new Set<string>() }
}

function finalizeBucket(acc: BucketAccumulator): BucketTotals {
  const position =
    acc.impressions > 0 ? acc.positionWeighted / acc.impressions : null
  return {
    clicks: acc.clicks,
    impressions: acc.impressions,
    distinct_queries: acc.queries.size,
    position,
  }
}

function isLatinTerm(term: string): boolean {
  for (let i = 0; i < term.length; i++) {
    if (term.charCodeAt(i) > 127) return false
  }
  return true
}

export function splitQueryRows(
  rows: readonly QueryRow[],
  matcher: BrandMatcher,
  suspectLimit = 20,
): BrandSplitResult {
  const brand = emptyAccumulator()
  const ambiguous = emptyAccumulator()
  const nonBrand = emptyAccumulator()

  // A query is a suspected missed brand query when one of its words STARTS with the concatenated form of a Latin
  // brand term (term "cts" -> word "ctstour"; term "cts tours" -> word "ctstours"). Matching anywhere inside a word
  // would flag every "products" / "contacts" for a term like "cts".
  const suspectTerms: string[] = []
  for (const term of matcher.brand) {
    if (!isLatinTerm(term)) continue
    const joined = term.replace(/ /g, '')
    if (joined.length >= 3) suspectTerms.push(joined)
  }

  const suspectMap = new Map<string, SuspectQuery>()

  for (const row of rows) {
    const normalized = normalizeQueryText(row.query)
    const bucket = classifyQuery(row.query, matcher)

    const acc =
      bucket === 'brand' ? brand : bucket === 'ambiguous' ? ambiguous : nonBrand

    acc.clicks += row.clicks
    acc.impressions += row.impressions
    acc.positionWeighted += row.position * row.impressions
    acc.queries.add(normalized)

    if (bucket === 'non_brand' && suspectTerms.length > 0) {
      const words = normalized.split(' ')
      let matched = false
      for (const term of suspectTerms) {
        if (words.some((w) => w.startsWith(term))) {
          matched = true
          break
        }
      }
      if (matched) {
        const existing = suspectMap.get(normalized)
        if (existing) {
          existing.clicks += row.clicks
          existing.impressions += row.impressions
        } else {
          suspectMap.set(normalized, {
            query: normalized,
            clicks: row.clicks,
            impressions: row.impressions,
          })
        }
      }
    }
  }

  const suspects = Array.from(suspectMap.values())
  suspects.sort((a, b) => {
    if (b.impressions !== a.impressions) return b.impressions - a.impressions
    return a.query < b.query ? -1 : a.query > b.query ? 1 : 0
  })

  const limited = suspects.slice(0, Math.max(0, suspectLimit))

  return {
    brand: finalizeBucket(brand),
    ambiguous: finalizeBucket(ambiguous),
    non_brand: finalizeBucket(nonBrand),
    suspect_missed_brand: limited,
  }
}
