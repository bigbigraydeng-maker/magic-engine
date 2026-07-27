/**
 * Competitor brand-name gate for the weekly SEO loop.
 *
 * Why this exists: `isBusinessRelevantKeyword` only checks that a keyword
 * matches the client's business vocabulary. For opportunity-gap analysis that
 * is not enough — a competitor's own brand name is *maximally* business
 * relevant and will therefore sail straight through the relevance filter.
 *
 * Real example (2026-07-27, Oztop): the raw gap list was topped by
 * "carpet court" (27,100/mo), "carpet call" (22,200/mo) and "the flooring
 * guys" (1,900/mo). All three are competitor brands. Ranking for a
 * competitor's brand name is not a content opportunity — it is a term the
 * brand owner will always win, so it must never become a topic candidate.
 */

/** Public suffixes we strip before deriving a brand token. Longest first. */
const DOMAIN_SUFFIXES = [
  '.com.au', '.net.au', '.org.au', '.co.nz', '.net.nz', '.org.nz',
  '.com', '.net', '.org', '.nz', '.au', '.io', '.co',
]

/**
 * Minimum length for a derived brand token.
 *
 * Guards against an exact-match domain such as `flooring.com.au` producing the
 * token "flooring" and then nuking every legitimate flooring keyword. Real
 * competitor brands comfortably clear this bar: carpetcall=10, carpetcourt=11,
 * wendywutours=12, houseoftravel=13, theflooringguys=15.
 */
const MIN_BRAND_TOKEN_LENGTH = 8

/** Normalise to lowercase alphanumerics so "carpet court" -> "carpetcourt". */
export function squashKeyword(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Derive comparable brand tokens from configured competitor domains.
 *
 * `www.` and any leading protocol are dropped, the public suffix is stripped,
 * and the remaining label is squashed. `carpetcourt.com.au` -> `carpetcourt`.
 * Tokens shorter than MIN_BRAND_TOKEN_LENGTH are discarded as too generic.
 */
export function competitorBrandTokens(domains: readonly string[]): string[] {
  const tokens = new Set<string>()

  for (const raw of domains) {
    if (typeof raw !== 'string') continue
    let host = raw.trim().toLowerCase()
    if (!host) continue

    host = host.replace(/^https?:\/\//, '').split('/')[0]
    host = host.replace(/^www\./, '')

    const suffix = DOMAIN_SUFFIXES.find(s => host.endsWith(s))
    if (suffix) host = host.slice(0, -suffix.length)

    // Keep only the most specific label: `tours.nzchinasociety` -> `nzchinasociety`
    const label = host.split('.').filter(Boolean).pop() ?? ''
    const token = squashKeyword(label)

    if (token.length >= MIN_BRAND_TOKEN_LENGTH) tokens.add(token)
  }

  return Array.from(tokens)
}

/**
 * True when the keyword contains a competitor's brand token.
 *
 * Matching is done on the squashed forms so spacing and punctuation do not
 * matter: "carpet court", "carpet-court" and "carpetcourt near me" all match
 * the token `carpetcourt`.
 */
export function isCompetitorBrandKeyword(
  keyword: string,
  brandTokens: readonly string[],
): boolean {
  if (brandTokens.length === 0) return false
  const squashed = squashKeyword(keyword)
  if (!squashed) return false
  return brandTokens.some(token => squashed.includes(token))
}
