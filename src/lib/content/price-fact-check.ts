import { PRICE_CLAIM_STRICT_RE } from './price-claim'

/**
 * Price fact-check: verify every price number written in a social post against
 * a client's confirmed offer facts.
 *
 * Fail-closed: any number that cannot be verified is BLOCKED. Nothing
 * client-specific is hardcoded here — all facts come from the `offers` input.
 *
 * The price *detection* regex is reused from ./price-claim (PRICE_CLAIM_STRICT_RE)
 * so the two modules can never drift apart.
 */

export type PriceClaimUnit = 'money' | 'percent' | 'unparseable'

export interface ExtractedPriceClaim {
  raw: string
  unit: PriceClaimUnit
  value: number | null
  currency: string | null
}

export interface OfferPriceFacts {
  key: string
  label: string
  stem: string
  qualifiers: string[]
  url: string | null
  claims: ExtractedPriceClaim[]
}

export type PriceFactBlockReason =
  | 'no_facts'
  | 'offer_unresolved'
  | 'mismatch'
  | 'unparseable'
  | 'ambiguous_variant'

export interface PriceFactProblem {
  claim: string
  expected: string[]
}

export type PriceFactVerdict =
  | { status: 'no_claims' }
  | { status: 'verified'; offerKeys: string[]; claims: ExtractedPriceClaim[] }
  | {
      status: 'blocked'
      reason: PriceFactBlockReason
      offerKeys: string[]
      problems: PriceFactProblem[]
    }

const URL_RE = /https?:\/\/\S+/g
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g
const PAREN_RE = /\(([^)]*)\)/

/** Lowercase, turn `&` into ` and `, collapse every non-alphanumeric run to a single space. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Lowercase, drop query string and hash, drop trailing slash. */
function normaliseUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (trimmed.length === 0) return null
  const withoutHash = trimmed.split('#')[0]
  const withoutQuery = withoutHash.split('?')[0]
  const withoutSlash = withoutQuery.replace(/\/+$/, '')
  return withoutSlash.toLowerCase()
}

/** First number found in a string, or null. */
function firstNumber(raw: string): number | null {
  const m = raw.match(NUMBER_RE)
  if (m === null || m.length === 0) return null
  const n = Number(m[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Map a lowercase window of text to a currency code, or null. */
function currencyFromWindow(window: string): string | null {
  if (window.includes('nzd') || window.includes('nz$')) return 'NZD'
  if (window.includes('aud') || window.includes('a$')) return 'AUD'
  if (window.includes('usd') || window.includes('us$')) return 'USD'
  if (
    window.includes('rmb') ||
    window.includes('¥') ||
    window.includes('￥') ||
    window.includes('元') ||
    window.includes('人民币')
  ) {
    return 'RMB'
  }
  return null
}

/** Classify a single regex match into an ExtractedPriceClaim. */
function classifyMatch(
  raw: string,
  index: number,
  text: string,
): ExtractedPriceClaim {
  const isPercent = raw.includes('%') || /\boff\b/i.test(raw)
  if (isPercent) {
    return { raw, unit: 'percent', value: firstNumber(raw), currency: null }
  }

  const numbers = raw.match(NUMBER_RE)
  if (numbers === null || numbers.length !== 1) {
    return { raw, unit: 'unparseable', value: null, currency: null }
  }

  const base = Number(numbers[0].replace(/,/g, ''))
  if (!Number.isFinite(base)) {
    return { raw, unit: 'unparseable', value: null, currency: null }
  }

  const lower = raw.toLowerCase()
  const numberIndex = lower.indexOf(numbers[0].toLowerCase())
  const after = numberIndex >= 0 ? lower.slice(numberIndex + numbers[0].length) : ''
  let value = base
  if (/^\s*k\b/.test(after) || raw.includes('千')) value = base * 1000
  else if (raw.includes('万')) value = base * 10000

  const windowStart = Math.max(0, index - 6)
  const window = text.slice(windowStart, index + raw.length).toLowerCase()
  return { raw, unit: 'money', value, currency: currencyFromWindow(window) }
}

/**
 * Extract every price claim from a piece of text.
 * URLs are stripped first (utm digits are not prices).
 */
export function extractPriceClaims(text: string): ExtractedPriceClaim[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const cleaned = text
    .replace(URL_RE, ' ')
    .replace(/(\d[,.]?)[^\S\r\n]+((?:nzd|aud|usd|rmb)[^\S\r\n]*[$\d])/gi, '$1\n$2')
  const re = new RegExp(PRICE_CLAIM_STRICT_RE.source, 'gi')
  const out: ExtractedPriceClaim[] = []
  for (const m of cleaned.matchAll(re)) {
    const raw = m[0]
    const index = m.index ?? 0
    out.push(classifyMatch(raw, index, cleaned))
  }
  return out
}

/** Extract the parenthetical from a label, or null. */
function parenthetical(label: string): string | null {
  const m = label.match(PAREN_RE)
  return m === null ? null : m[1]
}

/** Words (letters only, length > 3, lowercase) from a parenthetical, minus "departure". */
function qualifiersFrom(label: string): string[] {
  const paren = parenthetical(label)
  if (paren === null) return []
  const words = paren.toLowerCase().match(/[a-z]+/g)
  if (words === null) return []
  return words.filter((w) => w.length > 3 && w !== 'departure')
}

/** The part of a label after the last ` — ` or ` - `, with any parenthetical removed. */
function stemFrom(label: string): string {
  const emDash = label.lastIndexOf(' — ')
  const hyphen = label.lastIndexOf(' - ')
  const cut = Math.max(emDash, hyphen)
  const tail = cut >= 0 ? label.slice(cut + 3) : label
  return normalise(tail.replace(PAREN_RE, ' '))
}

/** Build the fact list for every offer. */
export function buildOfferPriceFacts(
  offers: Record<string, Record<string, string>> | null | undefined,
): OfferPriceFacts[] {
  if (offers === null || offers === undefined) return []
  const out: OfferPriceFacts[] = []
  for (const [key, fields] of Object.entries(offers)) {
    if (fields === null || fields === undefined) continue
    const label = typeof fields.tour === 'string' ? fields.tour : key
    const claims: ExtractedPriceClaim[] = []
    for (const value of Object.values(fields)) {
      if (typeof value === 'string') claims.push(...extractPriceClaims(value))
    }
    out.push({
      key,
      label,
      stem: stemFrom(label),
      qualifiers: qualifiersFrom(label),
      url: normaliseUrl(fields.url),
      claims,
    })
  }
  return out
}

/** Does the normalised text contain the stem as a substring? */
function textHasStem(normalisedText: string, stem: string): boolean {
  return stem.length > 0 && normalisedText.includes(stem)
}

/** Does the normalised text contain the qualifier as a whole word? */
function textHasQualifier(normalisedText: string, qualifier: string): boolean {
  const re = new RegExp(`\\b${qualifier}\\b`)
  return re.test(normalisedText)
}

/** Is a claim supported by a single offer's facts? */
function offerSupportsClaim(offer: OfferPriceFacts, claim: ExtractedPriceClaim): boolean {
  return offer.claims.some((fact) => {
    if (fact.unit !== claim.unit) return false
    if (fact.value === null || claim.value === null) return false
    if (Math.abs(fact.value - claim.value) >= 0.005) return false
    if (fact.currency !== null && claim.currency !== null && fact.currency !== claim.currency) {
      return false
    }
    return true
  })
}

/** Is a claim supported by EVERY candidate offer? */
function supportedByAll(candidates: OfferPriceFacts[], claim: ExtractedPriceClaim): boolean {
  return candidates.every((offer) => offerSupportsClaim(offer, claim))
}

/** Is a claim supported by AT LEAST ONE candidate offer? */
function supportedByAny(candidates: OfferPriceFacts[], claim: ExtractedPriceClaim): boolean {
  return candidates.some((offer) => offerSupportsClaim(offer, claim))
}

/** Deduplicated display strings of every fact claim across candidates. */
function expectedStrings(candidates: OfferPriceFacts[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const offer of candidates) {
    for (const fact of offer.claims) {
      if (!seen.has(fact.raw)) {
        seen.add(fact.raw)
        out.push(fact.raw)
      }
    }
  }
  return out
}

/** Verify every price claim in a post against the client's offer facts. */
export function verifyPostPrices(input: {
  text: string
  ctaUrl?: string | null
  offers: OfferPriceFacts[]
}): PriceFactVerdict {
  const { text, ctaUrl, offers } = input
  const claims = extractPriceClaims(text)

  if (claims.length === 0) return { status: 'no_claims' }

  if (offers.length === 0) {
    return {
      status: 'blocked',
      reason: 'no_facts',
      offerKeys: [],
      problems: claims.map((c) => ({ claim: c.raw, expected: [] })),
    }
  }

  const normalisedText = normalise(text)
  const normalisedCta = normaliseUrl(ctaUrl)

  let candidates = offers.filter((offer) => {
    if (textHasStem(normalisedText, offer.stem)) return true
    if (offer.url !== null && normalisedCta !== null && offer.url === normalisedCta) return true
    return false
  })

  if (candidates.length === 0) {
    return {
      status: 'blocked',
      reason: 'offer_unresolved',
      offerKeys: [],
      problems: claims.map((c) => ({ claim: c.raw, expected: [] })),
    }
  }

  const narrowed = candidates.filter((offer) =>
    offer.qualifiers.some((q) => textHasQualifier(normalisedText, q)),
  )
  if (narrowed.length > 0) candidates = narrowed

  const unparseable = claims.filter((c) => c.unit === 'unparseable')
  if (unparseable.length > 0) {
    return {
      status: 'blocked',
      reason: 'unparseable',
      offerKeys: candidates.map((o) => o.key),
      problems: unparseable.map((c) => ({ claim: c.raw, expected: [] })),
    }
  }

  const unsupported = claims.filter((c) => !supportedByAll(candidates, c))
  if (unsupported.length > 0) {
    const allSupportedBySome = unsupported.every((c) => supportedByAny(candidates, c))
    if (candidates.length > 1 && allSupportedBySome) {
      return {
        status: 'blocked',
        reason: 'ambiguous_variant',
        offerKeys: candidates.map((o) => o.key),
        problems: unsupported.map((c) => ({
          claim: c.raw,
          expected: candidates.map((o) => o.label),
        })),
      }
    }
    const expected = expectedStrings(candidates)
    return {
      status: 'blocked',
      reason: 'mismatch',
      offerKeys: candidates.map((o) => o.key),
      problems: unsupported.map((c) => ({ claim: c.raw, expected })),
    }
  }

  return {
    status: 'verified',
    offerKeys: candidates.map((o) => o.key),
    claims,
  }
}

/** Plain-language Chinese message for a non-technical PM. */
export function priceFactMessage(verdict: PriceFactVerdict): string {
  if (verdict.status === 'no_claims' || verdict.status === 'verified') return ''

  const raws = verdict.problems.map((p) => p.claim).join('、')

  if (verdict.reason === 'no_facts') {
    return `文案里写了价格（${raws}），但这个客户的资料里一个团的价格都没填，系统没法核对，已拦下。`
  }
  if (verdict.reason === 'offer_unresolved') {
    return `文案里写了价格（${raws}），但系统认不出这条帖子说的是哪一个团（文案没写团名，链接也对不上资料），没法核对，已拦下。`
  }
  if (verdict.reason === 'unparseable') {
    return `文案里有系统读不懂的价格写法（${raws}），没法核对，已拦下。`
  }

  if (verdict.reason === 'ambiguous_variant') {
    const seen = new Set<string>()
    const labels: string[] = []
    for (const problem of verdict.problems) {
      for (const label of problem.expected) {
        if (!seen.has(label)) {
          seen.add(label)
          labels.push(label)
        }
      }
    }
    return `文案里写了价格（${raws}），但这条帖子可能对应多个出发地的团（${labels.join(' / ')}），各自价格不同，文案又没写清是哪个出发地，已拦下。`
  }

  const claims = verdict.problems
    .slice(0, 3)
    .map((p) => `「${p.claim}」`)
    .join('、')
  const seen = new Set<string>()
  const expected: string[] = []
  for (const problem of verdict.problems) {
    for (const value of problem.expected) {
      if (!seen.has(value)) {
        seen.add(value)
        expected.push(value)
      }
    }
  }
  const expectedText = expected.length > 0 ? expected.join('、') : '（资料里没有可对照的价格）'
  return `文案里写了${claims}，但客户资料里该团只有这些价格：${expectedText}。已拦下。`
}
