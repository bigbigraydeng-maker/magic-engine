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
  /**
   * clients.brand_geo_anchors — words that prove an answer is talking about
   * the client's OWN market ("new zealand", "nz", "auckland"). Opt-in per
   * client: empty / absent leaves matching exactly as it was.
   *
   * No geography lives in this module. The words are client configuration;
   * the rule that consumes them is the only platform-shared part.
   */
  geoAnchors?: readonly string[] | null
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

/**
 * Same normalisation as `normalizeForMatch`, but also records, for every
 * character of the result, the index it came from in the input — so a
 * position found in normalised text can be quoted from the raw text even
 * when normalisation changed the length ("&" becomes " and ").
 */
function normalizeWithSourceMap(input: string): { norm: string; map: number[] } {
  let out = ''
  const map: number[] = []
  let pendingSpace = false
  for (let i = 0; i < input.length; i++) {
    const piece = normalizeForMatch(input[i])
    if (!piece) {
      pendingSpace = out.length > 0
      continue
    }
    if (pendingSpace) {
      out += ' '
      map.push(i)
      pendingSpace = false
    }
    for (const ch of piece) {
      out += ch
      map.push(i)
    }
  }
  return { norm: out, map }
}

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

/**
 * Links and bare hostnames, removed before anchor matching.
 *
 * Normalisation turns "." into a space, so "explorechinaholidays.com.au"
 * becomes "explorechinaholidays com au" and would hand an "au" anchor to any
 * answer that cites an Australian link — including a THIRD PARTY's link in an
 * answer about a different country. Measured on CTS: 43 of 3,096 answers had
 * the anchor only inside a URL. A cited hostname is not a statement about the
 * market the answer is discussing, so it is not geo evidence.
 *
 * Deliberately narrow: a scheme, a `www.`, or a dotted host ending in a label
 * of 2+ letters. "(N.Z.)" is NOT matched — its last label is one character —
 * so the `nz` anchor still finds it.
 */
const URL_LIKE_RE = /(?:https?:\/\/|www\.)\S+|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\.[a-z]{2,})?(?:\/\S*)?/gi

/** Minimum length for a geo anchor spelled out with separators ("N.Z."). */
const MIN_ANCHOR_COMPACT_LEN = 2

/**
 * Like `normalizeForMatch`, but punctuation is DROPPED instead of turned
 * into a space, and only real whitespace still separates tokens. So
 * "(N.Z.)" collapses to the single token "nz" (nothing but punctuation sat
 * between the letters), while "a U-turn" stays two tokens, "a" and "uturn"
 * (a real space still separates them) — it never reads as "au". Plain
 * `normalizeForMatch` cannot tell these apart: it turns punctuation AND real
 * whitespace into the very same single space, so a short anchor matched
 * against it can bridge two unrelated, independently-typed words that merely
 * happen to spell it out end to end ("new zeal and enthusiasm" → "nz eal
 * and" → "newzealand").
 */
function normalizeKeepingWhitespaceOnly(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Is at least one configured geo anchor written in the answer?
 *
 * Two ways to be evidence:
 *  - An exact, word-bounded phrase match on `norm` — "New Zealand," in the
 *    answer matches the anchor "new zealand" typed by an FDE. This never
 *    bridges words the FDE didn't already put a space between.
 *  - A word-bounded match of the anchor's compact form against `punctOnly`
 *    (see `normalizeKeepingWhitespaceOnly`) — so a short anchor ("nz") still
 *    finds a punctuation-spelled form ("(N.Z.)"), but real whitespace
 *    between two independently-written words is never bridged: "a U-turn"
 *    must not satisfy "au", and "bonza" must not satisfy "nz".
 *  - CJK anchors have no word boundaries to pin to at all (`indexOfIdentifier`
 *    handles that case on its own, length-gated).
 */
function hasGeoAnchor(norm: string, punctOnly: string, anchors: readonly string[]): boolean {
  return anchors.some(a => {
    if (CJK_RE.test(a)) return indexOfIdentifier(norm, a) >= 0
    if (` ${norm} `.includes(` ${a} `)) return true
    const compactId = a.replace(/ /g, '')
    if (compactId.length < MIN_ANCHOR_COMPACT_LEN) return false
    return ` ${punctOnly} `.includes(` ${compactId} `)
  })
}

/** Does this client have the geo gate turned on at all? */
export function hasGeoGate(identity: ClientBrandIdentity): boolean {
  return buildGeoAnchors(identity).length > 0
}

/** The part of an answer that may carry geo evidence: everything but links. */
function geoEvidenceText(answerText: string): { norm: string; punctOnly: string } {
  const stripped = answerText.replace(URL_LIKE_RE, ' ')
  return { norm: normalizeForMatch(stripped), punctOnly: normalizeKeepingWhitespaceOnly(stripped) }
}

/**
 * Configured anchors, normalised; empty when the client has none.
 *
 * A CJK anchor shorter than `MIN_CJK_EVIDENCE_LEN` can never match (there
 * are no word boundaries to pin it to), so it would silently close the gate
 * on every answer. The write API rejects those, but a row edited directly in
 * the database can still carry one — drop it here and say so, rather than
 * letting the client lose every alias-grounded mention without a trace.
 */
function buildGeoAnchors(identity: ClientBrandIdentity): string[] {
  const configured = identity.geoAnchors ?? []
  const out: string[] = []
  for (const a of configured) {
    const norm = normalizeForMatch(a ?? '')
    if (norm.length === 0) continue
    if (CJK_RE.test(norm) && norm.length < MIN_CJK_EVIDENCE_LEN) {
      console.warn(
        `[client-brand-match] ignoring un-matchable CJK geo anchor "${norm}" ` +
          `(needs ${MIN_CJK_EVIDENCE_LEN}+ characters)`
      )
      continue
    }
    out.push(norm)
  }
  if (configured.length > 0 && out.length === 0) {
    console.warn(
      '[client-brand-match] every configured geo anchor was unusable; ' +
        'the geo gate is OFF for this client'
    )
  }
  return out
}

/** Normalised identifiers that prove the client is present (≥ 2 chars). */
export function buildClientIdentifiers(identity: ClientBrandIdentity): string[] {
  return buildIdentifierList(identity).map(i => i.value)
}

/**
 * The identifiers admissible as evidence in one AI ANSWER.
 *
 * An alias is an FDE-entered nickname, and a nickname can be the group name
 * a foreign sibling trades under too ("China Travel Service" names both the
 * Australian and the NZ company). So once a client configures geo anchors,
 * aliases only count in an answer that also carries one of those anchors.
 * The official brand name and the client's own domain are self-identifying
 * and are never gated — otherwise every answer naming the client without
 * naming its country would lose a real mention. No anchors configured → the
 * list is exactly what it was before.
 *
 * 🔴 `answerText` must be a whole answer, never a bare brand name. A missing
 *    anchor is only evidence of the wrong market across a few hundred words;
 *    in a three-word company name it means nothing, because most company
 *    names do not spell out their country. Judging a name in isolation would
 *    un-merge every client variant that omits the country. Whoever needs a
 *    per-name decision should reuse the rank this function helped resolve
 *    (see `buildRankingTable`), not call this with a name.
 *
 * Short single-token aliases are NOT filtered here — `isClientBrand` already
 * requires them to equal the brand exactly. They are dropped separately from
 * the pool of *textual* evidence inside `resolveClientBrandRank`.
 */
export function admissibleIdentifiersForAnswer(
  identity: ClientBrandIdentity,
  answerText: string
): string[] {
  const idList = buildIdentifierList(identity)
  const anchors = buildGeoAnchors(identity)
  if (anchors.length === 0) return idList.map(i => i.value)
  const { norm, punctOnly } = geoEvidenceText(answerText)
  const aliasAllowed = hasGeoAnchor(norm, punctOnly, anchors)
  return idList.filter(i => aliasAllowed || !i.fromAlias).map(i => i.value)
}

/** Char index of `id` in normalised text `norm` (word-bounded), or -1. */
function indexOfIdentifier(norm: string, id: string): number {
  if (CJK_RE.test(id)) return id.length >= MIN_CJK_EVIDENCE_LEN ? norm.indexOf(id) : -1
  const padded = ` ${norm} `
  const phraseIdx = padded.indexOf(` ${id} `)
  if (phraseIdx >= 0) return phraseIdx
  return indexOfCompact(norm, id, MIN_COMPACT_LEN)
}

/**
 * Index of `id` ignoring the spaces inside it ("janedoe" vs "Jane Doe"), but
 * only where the match starts and ends on word boundaries of `norm` — so
 * "nz" finds "(N.Z.)" (normalised to "n z") without finding "in Zurich".
 * `minLength` guards how short a needle may be spelled out this way.
 */
function indexOfCompact(norm: string, id: string, minLength: number): number {
  const compactId = id.replace(/ /g, '')
  if (compactId.length < minLength) return -1
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

/**
 * Every word-bounded occurrence of `id` in `norm`, as [start, end) spans of
 * the TEXT matched. A compact match ("kiwitours" against "kiwi tours") spans
 * more characters than the identifier itself, so the end is measured here,
 * not derived from `id.length`.
 */
function spansOfIdentifier(norm: string, id: string): Array<[number, number]> {
  const found: Array<[number, number]> = []
  let from = 0
  while (from <= norm.length) {
    const idx = indexOfIdentifier(norm.slice(from), id)
    if (idx < 0) break
    const start = from + idx
    found.push([start, endOfMatch(norm, start, id)])
    from = start + 1
  }
  return found
}

/** End (exclusive) of the identifier match that starts at `start`. */
function endOfMatch(norm: string, start: number, id: string): number {
  if (norm.startsWith(id, start)) return start + id.length
  // Compact match: consume the words that spell out the identifier.
  const compactLength = id.replace(/ /g, '').length
  let seen = 0
  let i = start
  while (i < norm.length && seen < compactLength) {
    if (norm[i] !== ' ') seen++
    i++
  }
  return i
}

function firstIdentifierIndex(
  norm: string,
  ids: readonly string[],
  excluded: ReadonlyArray<[number, number]> = []
): number {
  let best = -1
  for (const id of ids) {
    for (const [idx, idEnd] of spansOfIdentifier(norm, id)) {
      // Only a span that swallows the identifier WHOLE belongs to the other
      // brand. A parser that shortened the client ("Acme" for "Acme Tours")
      // must not hide the full name written in the text.
      const covered = excluded.some(([start, end]) => idx >= start && idEnd <= end)
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
    spans.push(...spansOfIdentifier(norm, name))
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
 * The position is mapped back through `normalizeWithSourceMap`, so it is
 * exact even where normalisation changed the length.
 */
function excerptAt(rawResponse: string, map: readonly number[], normPos: number): string {
  const at = map[Math.min(normPos, map.length - 1)] ?? 0
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

  const { norm, map } = normalizeWithSourceMap(rawResponse)

  // Geo gate (see `admissibleIdentifiersForAnswer`). A brand the parser
  // extracted is the client only if it matches an admissible identifier;
  // under a failed gate the same-named sibling abroad stays in `brands` as
  // an ordinary competitor — it is a real company in the answer, so dropping
  // it would delete competitor data.
  const admissibleIds = admissibleIdentifiersForAnswer(identity, rawResponse)
  const admissible = new Set(admissibleIds)
  const clientBrands = brands.filter(b => isClientBrand(b.brand, admissibleIds))
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
      ...idList
        .filter(i => admissible.has(i.value))
        .filter(i => !(i.fromAlias && isShortSingleTokenId(i.value)))
        .map(i => i.value),
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
    snippet: excerptAt(rawResponse, map, clientPos),
  })
  brands.sort((a, b) => a.rank - b.rank)
  return { brands, client_brand_rank: rank }
}
