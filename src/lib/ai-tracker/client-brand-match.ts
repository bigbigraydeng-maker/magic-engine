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

/** One way of naming the client, and where it came from. */
interface ClientIdentifier {
  value: string
  /** Aliases are FDE-entered nicknames; the brand name and domain are not. */
  fromAlias: boolean
}

/**
 * Every way of naming the client (≥ 2 chars). The brand name, its leading
 * segment and the domain come first, so a name that is BOTH an alias and a
 * stronger source keeps the stronger source when duplicates collapse.
 */
function buildIdentifierList(identity: ClientBrandIdentity): ClientIdentifier[] {
  const raw: ClientIdentifier[] = [{ value: identity.brandName, fromAlias: false }]
  // "Person — Office" composite names: the leading segment names the client.
  const lead = identity.brandName.split(COMPOSITE_SEPARATOR_RE)[0]
  if (lead !== identity.brandName) raw.push({ value: lead, fromAlias: false })
  const host = identity.domain ? ownDomainHost(identity.domain) : null
  if (host) {
    raw.push({ value: host, fromAlias: false })
    const root = registrableLabel(host)
    if (root.length >= MIN_DOMAIN_ROOT_LEN) raw.push({ value: root, fromAlias: false })
  }
  for (const alias of identity.aliases ?? []) raw.push({ value: alias, fromAlias: true })

  const seen = new Map<string, ClientIdentifier>()
  for (const item of raw) {
    const value = normalizeForMatch(item.value ?? '')
    if (value.replace(/ /g, '').length < 2) continue
    const existing = seen.get(value)
    if (!existing) seen.set(value, { value, fromAlias: item.fromAlias })
    else if (existing.fromAlias && !item.fromAlias) existing.fromAlias = false
  }
  return Array.from(seen.values())
}

/** Normalised identifiers that prove the client is present (≥ 2 chars). */
export function buildClientIdentifiers(identity: ClientBrandIdentity): string[] {
  return buildIdentifierList(identity).map(i => i.value)
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

/** Every word-bounded occurrence of `id` in `norm`, in order. */
function indexesOfIdentifier(norm: string, id: string): number[] {
  const found: number[] = []
  let from = 0
  while (from <= norm.length) {
    const idx = indexOfIdentifier(norm.slice(from), id)
    if (idx < 0) break
    found.push(from + idx)
    from += idx + 1
  }
  return found
}

function firstIdentifierIndex(
  norm: string,
  ids: readonly string[],
  excluded: ReadonlyArray<[number, number]> = []
): number {
  let best = -1
  for (const id of ids) {
    for (const idx of indexesOfIdentifier(norm, id)) {
      const covered = excluded.some(([start, end]) => idx >= start && idx < end)
      if (covered) continue
      if (best < 0 || idx < best) best = idx
      break
    }
  }
  return best
}

/** Spans in `norm` occupied by brands that are NOT the client. */
function spansOfOtherBrands(norm: string, others: readonly BrandMention[]): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const b of others) {
    const name = normalizeForMatch(b.brand)
    if (!name) continue
    for (const idx of indexesOfIdentifier(norm, name)) spans.push([idx, idx + name.length])
  }
  return spans
}

/**
 * A short single-token identifier ("cts", "act") is too ambiguous to stand
 * on its own as evidence when it is only an ALIAS: the same word inside
 * another company's name ("CTS Logistics", "CTS Bus") would prove a client
 * called "CTS Tours". A short official brand name ("oztop") still counts —
 * occurrences inside another extracted brand are excluded separately.
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

/**
 * A short quote of the raw text around `normPos` — the position in the
 * NORMALISED text that actually grounded the client, so the snippet quotes
 * that occurrence and not an earlier one inside a competitor's name.
 * Both strings count runs of letters/digits, so the counts line up.
 */
function excerptAt(rawResponse: string, norm: string, normPos: number): string {
  const tokenIndex = norm.slice(0, normPos).split(' ').filter(Boolean).length
  const rawTokens = Array.from(rawResponse.matchAll(/[\p{L}\p{N}]+/gu))
  const at = rawTokens[Math.min(tokenIndex, rawTokens.length - 1)]?.index ?? 0
  const before = rawResponse.slice(0, at).split(/\s+/).filter(Boolean).slice(-10)
  const after = rawResponse
    .slice(at)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SNIPPET_WORDS - before.length)
  return [...before, ...after].join(' ')
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
  const idList = buildIdentifierList(identity)
  const ids = idList.map(i => i.value)
  const brands = parsedBrands.map(b => ({ ...b }))
  if (ids.length === 0) return { brands, client_brand_rank: null }

  const norm = normalizeForMatch(rawResponse)
  const clientBrands = brands.filter(b => isClientBrand(b.brand, ids))
  // Evidence = an identifier written in the text, or the name of a brand the
  // parser extracted that is the client ("Acme Tours Ltd" for "Acme Tours").
  // Two occurrences don't count: a short alias anywhere, and any identifier
  // sitting inside another extracted brand's name ("oztop" in "Oztop
  // Supplies") — that occurrence belongs to the other company.
  const otherSpans = spansOfOtherBrands(
    norm,
    brands.filter(b => !clientBrands.includes(b))
  )
  const clientPos = firstIdentifierIndex(
    norm,
    [
      ...idList.filter(i => !(i.fromAlias && isShortSingleTokenId(i.value))).map(i => i.value),
      ...clientBrands.map(b => normalizeForMatch(b.brand)),
    ],
    otherSpans
  )

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
    snippet: excerptAt(rawResponse, norm, clientPos),
  })
  brands.sort((a, b) => a.rank - b.rank)
  return { brands, client_brand_rank: rank }
}
