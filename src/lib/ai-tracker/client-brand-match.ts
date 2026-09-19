/**
 * AI Visibility Tracker — grounded client-brand matching.
 *
 * The LLM parser extracts brands from an AI answer, but its output is not
 * evidence on its own: it can hallucinate the client into the list, or miss
 * a client that is only cited via its domain / in a table. This module
 * decides `client_brand_rank` deterministically against the raw answer text:
 *
 *   - A rank is only returned when the client (brand name, configured alias,
 *     or domain) literally appears in the raw response.
 *   - Client-looking brands the parser returned without textual evidence are
 *     dropped (and later ranks shifted up).
 *   - A client that is present in the text but missed by the parser is
 *     inserted at its textual position among the extracted brands.
 *
 * Pure functions only — no client/industry facts live here; identity comes
 * from per-client configuration (brand name, clients.domain,
 * clients.brand_aliases).
 */

import type { BrandMention } from '@/types/magic-engine'

export interface ClientBrandIdentity {
  brandName: string
  domain?: string | null
  aliases?: readonly string[] | null
}

export interface ClientRankResolution {
  brands: BrandMention[]
  client_brand_rank: number | null
}

/** Minimum length for a joined (space-less) identifier to be matched loosely. */
const MIN_COMPACT_LEN = 6
/** Minimum length for a domain root label ("ctstours") to count as an identifier. */
const MIN_DOMAIN_ROOT_LEN = 4
const SNIPPET_WORDS = 30

const CJK_RE = /[぀-ヿ㐀-鿿가-힯]/

/** Lowercase, strip accents, collapse every non-letter/digit run to one space. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function domainHost(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
}

/** Normalised identifiers that prove the client is present (≥ 2 chars). */
export function buildClientIdentifiers(identity: ClientBrandIdentity): string[] {
  const raw = [identity.brandName, ...(identity.aliases ?? [])]
  if (identity.domain) {
    const host = domainHost(identity.domain)
    if (host) {
      raw.push(host)
      const root = host.split('.')[0]
      if (root.length >= MIN_DOMAIN_ROOT_LEN) raw.push(root)
    }
  }
  const ids = raw
    .map(s => normalizeForMatch(s ?? ''))
    .filter(s => s.replace(/ /g, '').length >= 2)
  return Array.from(new Set(ids))
}

/** Char index of `id` in normalised text `norm` (word-bounded), or -1. */
function indexOfIdentifier(norm: string, id: string): number {
  if (CJK_RE.test(id)) return norm.indexOf(id)
  const padded = ` ${norm} `
  const phraseIdx = padded.indexOf(` ${id} `)
  if (phraseIdx >= 0) return phraseIdx
  const compactId = id.replace(/ /g, '')
  if (compactId.length < MIN_COMPACT_LEN) return -1
  // Tolerate spacing differences ("romanhu" vs "Roman Hu"), but only when
  // the match starts and ends on word boundaries of the original text.
  const positions: number[] = []
  let compact = ''
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] === ' ') continue
    positions.push(i)
    compact += norm[i]
  }
  for (let c = compact.indexOf(compactId); c >= 0; c = compact.indexOf(compactId, c + 1)) {
    const start = positions[c]
    const end = positions[c + compactId.length - 1]
    const okStart = start === 0 || norm[start - 1] === ' '
    const okEnd = end === norm.length - 1 || norm[end + 1] === ' '
    if (okStart && okEnd) return start
  }
  return -1
}

function firstIdentifierIndex(norm: string, ids: readonly string[]): number {
  let best = -1
  for (const id of ids) {
    const idx = indexOfIdentifier(norm, id)
    if (idx >= 0 && (best < 0 || idx < best)) best = idx
  }
  return best
}

/** Does an extracted brand name refer to the client? */
export function isClientBrand(brand: string, ids: readonly string[]): boolean {
  const b = normalizeForMatch(brand)
  if (!b) return false
  const bTokens = b.split(' ').length
  return ids.some(id => {
    if (b === id) return true
    // "CTS Tours - China Travel Service" contains "cts tours"
    if (id.length >= 3 && indexOfIdentifier(b, id) >= 0) return true
    // "CTS Tours" as the leading words of client name "CTS Tours NZ".
    // Prefix + multi-word only: a brand that merely appears later in a
    // composite client name ("Ray White" in "Roman Hu — Ray White Mission
    // Bay") or a generic single token ("Homes") never claims the client.
    return bTokens >= 2 && id.startsWith(`${b} `)
  })
}

function excerptAround(rawResponse: string, identity: ClientBrandIdentity): string {
  const words = rawResponse.split(/\s+/).filter(Boolean)
  const ids = buildClientIdentifiers(identity)
  const at = words.findIndex((_, i) =>
    firstIdentifierIndex(normalizeForMatch(words.slice(i, i + 4).join(' ')), ids) >= 0
  )
  const start = Math.max(0, (at < 0 ? 0 : at) - 10)
  return words.slice(start, start + SNIPPET_WORDS).join(' ')
}

/**
 * Resolve the client's rank from parser output + raw answer text.
 * Never trusts the parser alone: no textual evidence → rank null.
 */
export function resolveClientBrandRank(
  parsedBrands: readonly BrandMention[],
  rawResponse: string,
  identity: ClientBrandIdentity
): ClientRankResolution {
  const ids = buildClientIdentifiers(identity)
  const brands = parsedBrands.map(b => ({ ...b }))
  if (ids.length === 0) return { brands, client_brand_rank: null }

  const norm = normalizeForMatch(rawResponse)
  const clientBrands = brands.filter(b => isClientBrand(b.brand, ids))
  // Evidence = a configured identifier, or the name of a client-matching
  // brand ("CTS Tours" for client "CTS Tours NZ"), written in the text.
  const clientPos = firstIdentifierIndex(norm, [
    ...ids,
    ...clientBrands.map(b => normalizeForMatch(b.brand)),
  ])

  if (clientPos < 0) {
    // Ungrounded: drop hallucinated client entries and close the rank gaps.
    let kept = brands
    for (const c of clientBrands) {
      kept = kept.filter(b => b !== c)
      for (const b of kept) if (b.rank > c.rank) b.rank--
    }
    return { brands: kept, client_brand_rank: null }
  }

  if (clientBrands.length > 0) {
    return {
      brands,
      client_brand_rank: Math.min(...clientBrands.map(b => b.rank)),
    }
  }

  // Grounded but missed by the parser: rank by textual position.
  const before = brands.filter(b => {
    const pos = indexOfIdentifier(norm, normalizeForMatch(b.brand))
    return pos >= 0 && pos < clientPos
  }).length
  const rank = before + 1
  for (const b of brands) if (b.rank >= rank) b.rank++
  brands.push({
    brand: identity.brandName.trim(),
    rank,
    snippet: excerptAround(rawResponse, identity),
  })
  brands.sort((a, b) => a.rank - b.rank)
  return { brands, client_brand_rank: rank }
}
