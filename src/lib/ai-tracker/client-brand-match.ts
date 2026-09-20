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
/** Minimum length for a domain root label ("acmetours") to count as an identifier. */
const MIN_DOMAIN_ROOT_LEN = 4
/** A single-token identifier shorter than this must equal the brand exactly. */
const MIN_CONTAINED_TOKEN_LEN = 6
/** CJK identifiers shorter than this cannot be word-bounded, so text alone is no evidence. */
const MIN_CJK_EVIDENCE_LEN = 3
/** Common second-level labels skipped when picking the registrable domain label. */
const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'net', 'org', 'ac', 'gov', 'govt', 'edu', 'geek', 'school'])
/** Separators that split "Person — Office" style composite brand names. */
const COMPOSITE_SEPARATOR_RE = /\s+[—–|-]\s+/
const SNIPPET_WORDS = 30

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/

/** Lowercase, strip accents, collapse every non-letter/digit run to one space. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Host of the client's own site, or null when `domain` has a path — a path
 * means a page on someone else's site (e.g. an agent profile on a franchise
 * network), and that host would let every mention of the network claim
 * the client.
 */
function ownDomainHost(domain: string): string | null {
  const rest = domain.toLowerCase().trim().replace(/^[a-z]+:\/\//, '')
  const [host, ...path] = rest.split(/[/?#]/)
  if (path.some(p => p.length > 0)) return null
  return host.replace(/^www\./, '') || null
}

/** Registrable label: "shop.acme.co.nz" → "acme". */
function registrableLabel(host: string): string {
  const labels = host.split('.')
  labels.pop()
  while (labels.length > 1 && SECOND_LEVEL_LABELS.has(labels[labels.length - 1])) labels.pop()
  return labels[labels.length - 1] ?? ''
}

/** Normalised identifiers that prove the client is present (≥ 2 chars). */
export function buildClientIdentifiers(identity: ClientBrandIdentity): string[] {
  const raw = [identity.brandName, ...(identity.aliases ?? [])]
  // "Person — Office" composite names: the leading segment names the client.
  const lead = identity.brandName.split(COMPOSITE_SEPARATOR_RE)[0]
  if (lead !== identity.brandName) raw.push(lead)
  const host = identity.domain ? ownDomainHost(identity.domain) : null
  if (host) {
    raw.push(host)
    const root = registrableLabel(host)
    if (root.length >= MIN_DOMAIN_ROOT_LEN) raw.push(root)
  }
  const ids = raw
    .map(s => normalizeForMatch(s ?? ''))
    .filter(s => s.replace(/ /g, '').length >= 2)
  return Array.from(new Set(ids))
}

/** Char index of `id` in normalised text `norm` (word-bounded), or -1. */
function indexOfIdentifier(norm: string, id: string): number {
  if (CJK_RE.test(id)) return id.length >= MIN_CJK_EVIDENCE_LEN ? norm.indexOf(id) : -1
  const padded = ` ${norm} `
  const phraseIdx = padded.indexOf(` ${id} `)
  if (phraseIdx >= 0) return phraseIdx
  const compactId = id.replace(/ /g, '')
  if (compactId.length < MIN_COMPACT_LEN) return -1
  // Tolerate spacing differences ("janedoe" vs "Jane Doe"), but only when
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

/**
 * A short single-token identifier ("cts", "act") is too ambiguous to stand
 * on its own as evidence: the same word inside another company's name
 * ("CTS Logistics", "CTS Bus") would prove a client called "CTS Tours".
 * It only counts through a brand the parser extracted that is the client.
 */
function isShortSingleTokenId(id: string): boolean {
  return id.split(' ').length < 2 && id.length < MIN_CONTAINED_TOKEN_LEN
}

/** Does an extracted brand name refer to the client? */
export function isClientBrand(brand: string, ids: readonly string[]): boolean {
  const b = normalizeForMatch(brand)
  if (!b) return false
  return ids.some(id => {
    if (b === id) return true
    // "Acme Tours - Acme Travel Service Ltd" contains "acme tours". A short
    // single-token alias ("act") must equal the brand, otherwise any
    // "ACT Logistics" would claim the client.
    if (isShortSingleTokenId(id)) return false
    return indexOfIdentifier(b, id) >= 0
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
  // Evidence = an identifier that stands on its own, or the name of a brand
  // the parser extracted that is the client ("Acme Tours Ltd" for client
  // "Acme Tours"), written in the text.
  const clientPos = firstIdentifierIndex(norm, [
    ...ids.filter(id => !isShortSingleTokenId(id)),
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
    brand: identity.brandName.trim() || (identity.domain ?? '').trim(),
    rank,
    snippet: excerptAround(rawResponse, identity),
  })
  brands.sort((a, b) => a.rank - b.rank)
  return { brands, client_brand_rank: rank }
}
