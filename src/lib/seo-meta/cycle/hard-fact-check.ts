/**
 * SEO Meta-Cycle v1 — hard, non-AI fact-preservation check (PM 2026-09-23
 * incident follow-up).
 *
 * Root cause this exists to catch: 2026-09-23 CTS dry run, /china-tours —
 * the AI judge (checkFactPreservation / Jev) scored the rewrite "no
 * contradiction" (0.17) even though the new title/desc silently dropped
 * concrete facts the original stated: departure city "Christchurch", price
 * "$6,188", date "22 Dec 2026", the "TAANZ" accreditation. A narrowed or
 * vaguer rewrite ("from New Zealand" -> "from Auckland") isn't a literal
 * reversal, it's an omission — exactly the failure mode an AI judge
 * prompted only for "does X contradict Y" is least likely to catch (see
 * repo memory playbook-seo-general.md §5 and
 * reference-jev-typesafe-evaluation-2026-09-20.md).
 *
 * This check needs no model call, so it can never be fooled the same way
 * twice: any $price, calendar date, ALLCAPS accreditation/authority name, or
 * AU/NZ place name present in the OLD text and absent from the NEW text is
 * treated as a dropped fact and fails closed — same discipline as every
 * other gate check in this pipeline (gate.ts) and as
 * checkFactPreservation's own fail-closed-on-error behaviour (fact-check.ts).
 *
 * Deliberately conservative (over-flags rather than under-flags): a false
 * positive here just means one more page routed to the manual board, same
 * cost as any other gate skip. A false negative is the thing that put a
 * wrong page in front of a customer.
 */

export interface HardFactCheckResult {
  consistent: boolean
  reason: string
  droppedFacts: string[]
  addedFacts: string[]
}

const PRICE_RE = /\$\s?\d[\d,]*(?:\.\d+)?/g
const DATE_NAMED_RE = /\b(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(?:\d{1,2},?\s+)?\d{4}\b/gi
const DATE_NUMERIC_RE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g
const DATE_NO_YEAR_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b(?!\s*,?\s*\d{4})/gi
const ACRONYM_RE = /\b[A-Z]{3,}\b/g
/**
 * "NZ"/"AU" as standalone words — 魏征 复审 2026-09-23: the exact incident
 * shape ("from New Zealand" -> "from Auckland") could equally have been
 * written as "from NZ" in the original, which ACRONYM_RE (3+ letters) and
 * AU_NZ_PLACE_NAMES (full names only) both miss. Case-sensitive, word-
 * bounded on purpose: catches "Tours across NZ" but not "ctstours.co.nz"
 * (lowercase) or "AUCKLAND" (no boundary after "AU").
 */
const PLACE_ABBREVIATION_RE = /\b(?:NZ|AU)\b/g

// Generic ALLCAPS words that read as acronyms but never carry a page-specific
// fact (unlike e.g. "TAANZ", an actual travel-industry accreditation name).
const ACRONYM_ALLOWLIST = new Set(['SEO', 'FAQ', 'USA', 'UK', 'AI'])

/**
 * AU/NZ place names — Magic Engine's entire target market is AU/NZ (see
 * CLAUDE.md / ME_PRODUCT_DEFINITION.md), so this is platform geography data,
 * not client-specific — the same category as the AU=2036/NZ=2554 DataForSEO
 * location codes already shared across every client
 * (src/lib/dataforseo/client.ts). Sorted longest-first so "New Zealand"
 * matches before any shorter overlapping token would. Not exhaustive by
 * design (a small, deliberately high-value list, same spirit as the
 * accreditation allowlist below) — 魏征 复审 2026-09-23 flagged missing
 * secondary NZ towns; added the ones a CTS-style itinerary is most likely to
 * name. PLACE_ABBREVIATION_RE (above) separately covers the "NZ"/"AU"
 * short-form case this list can't.
 */
const AU_NZ_PLACE_NAMES = [
  'New Zealand', 'Palmerston North', 'Bay of Plenty', 'Gold Coast', 'New Plymouth',
  'Christchurch', 'Wellington', 'Auckland', 'Queenstown', 'Rotorua', 'Tauranga',
  'Hamilton', 'Dunedin', 'Nelson', 'Napier', 'Taupo', 'Invercargill', 'Whanganui',
  'Gisborne', 'Wanaka', 'Timaru', 'Melbourne', 'Brisbane', 'Adelaide', 'Canberra',
  'Sydney', 'Darwin', 'Hobart', 'Cairns', 'Perth', 'Australia',
].sort((a, b) => b.length - a.length)

/** Normalize full-width ASCII variants (＄, ０-９, Ａ-Ｚ etc.) to half-width before extraction. */
function normalizeWidth(text: string): string {
  return text.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

// Each extractor returns the fact as it actually reads in the source text
// (for a human-legible reason string) — comparison against the NEW text
// uses a separate `normalize` so formatting differences ($6,188 vs $6188,
// "22 Dec 2026" vs "22 dec 2026") never cause a false "dropped" positive.
const NO_OP_NORMALIZE = (s: string): string => s

function extractPrices(text: string): string[] {
  return [...text.matchAll(PRICE_RE)].map((m) => m[0])
}
const normalizePrice = (s: string): string => s.replace(/[\s,]/g, '')

function extractDates(text: string): string[] {
  return [
    ...text.matchAll(DATE_NAMED_RE),
    ...text.matchAll(DATE_NUMERIC_RE),
    ...text.matchAll(DATE_NO_YEAR_RE),
  ].map((m) => m[0])
}
const normalizeDate = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

const PLACE_NAMES_UPPER = new Set(AU_NZ_PLACE_NAMES.map((n) => n.toUpperCase()))

function extractAcronyms(text: string): string[] {
  return [...text.matchAll(ACRONYM_RE)].map((m) => m[0]).filter((a) => !ACRONYM_ALLOWLIST.has(a) && !PLACE_NAMES_UPPER.has(a))
}

function extractPlaceNames(text: string): string[] {
  const lowerText = text.toLowerCase()
  const fullNames = AU_NZ_PLACE_NAMES.filter((name) => lowerText.includes(name.toLowerCase()))
  const abbreviations = [...new Set([...text.matchAll(PLACE_ABBREVIATION_RE)].map((m) => m[0]))]
  return [...fullNames, ...abbreviations]
}
const normalizePlaceName = (s: string): string => s.toLowerCase()

/** Facts present in oldText (by `extract`) that are no longer anywhere in newText, compared via `normalize` but reported in their original raw form. */
function findDropped(oldText: string, newText: string, extract: (t: string) => string[], normalize: (s: string) => string = NO_OP_NORMALIZE): string[] {
  const oldRaw = [...new Set(extract(oldText))]
  const newNormalized = new Set(extract(newText).map(normalize))
  return oldRaw.filter((raw) => !newNormalized.has(normalize(raw)))
}

/**
 * Regex/string-level check, no AI involved — see file header. Catches
 * exactly the shape of PM's requirement 2: "新文案丢了旧文案里的具体数字/
 * 专有名词（价格数字、日期、出发城市名、认证/资质名词）— 一律判定不通过，
 * 转人工，不管 AI 判官怎么判".
 */
export function checkHardFactsPreserved(
  oldTitle: string,
  oldDesc: string,
  newTitle: string,
  newDesc: string,
): HardFactCheckResult {
  const oldText = normalizeWidth(`${oldTitle} ${oldDesc}`)
  const newText = normalizeWidth(`${newTitle} ${newDesc}`)

  const droppedFacts = [
    ...findDropped(oldText, newText, extractPrices, normalizePrice),
    ...findDropped(oldText, newText, extractDates, normalizeDate),
    ...findDropped(oldText, newText, extractAcronyms),
    ...findDropped(oldText, newText, extractPlaceNames, normalizePlaceName),
  ]

  const addedFacts = [
    ...findDropped(newText, oldText, extractPrices, normalizePrice),
    ...findDropped(newText, oldText, extractDates, normalizeDate),
    ...findDropped(newText, oldText, extractAcronyms),
    ...findDropped(newText, oldText, extractPlaceNames, normalizePlaceName),
  ]

  if (droppedFacts.length === 0 && addedFacts.length === 0) {
    return { consistent: true, reason: 'no price/date/accreditation/AU-NZ place name dropped or added', droppedFacts: [], addedFacts: [] }
  }
  const parts: string[] = []
  if (droppedFacts.length > 0) parts.push(`drops fact(s) from the original — ${droppedFacts.join(', ')}`)
  if (addedFacts.length > 0) parts.push(`introduces fact(s) not in the original — ${addedFacts.join(', ')}`)
  return {
    consistent: false,
    reason: `hard rule (no AI involved): new text ${parts.join('; also ')}`,
    droppedFacts,
    addedFacts,
  }
}
