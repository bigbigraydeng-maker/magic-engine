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

// ── Price regexes ────────────────────────────────────────────────────────
const PRICE_RE = /\$\s?\d[\d,]*(?:\.\d+)?/g
const PRICE_MULTI_CURRENCY_RE = /[€¥£]\s?\d[\d,]*(?:\.\d+)?/g
const PRICE_CODE_RE = /\b(?:NZD|AUD|USD|EUR|GBP)\s?\d[\d,]*(?:\.\d+)?/gi
const PRICE_WORD_RE = /\b\d[\d,]*(?:\.\d+)?\s*(?:dollars?|pp|\/day|\/night|\/person)\b/gi
const PRICE_CONTEXT_RE = /\bfrom\s+(\d{3,}[\d,]*(?:\.\d+)?)\b/gi

// ── Promotion / discount regexes (DR48-1) ────────────────────────────────
const PROMO_RE = /\b(?:save\s+\d+\s*%|\d+\s*%\s*off\b|\d+-for-\d+\b)/gi

// ── Quantity regexes (DR48-1) ────────────────────────────────────────────
const QUANTITY_RE = /\b\d+[\s-](?:days?|nights?|hours?|weeks?|months?|years?)\b/gi

// ── Numeric details (魏征 review 2026-10-29) ──────────────────────────────
// "19-storey", "6th floor", "999-step": the concrete numbers that make a page specific. Before this,
// only prices/dates/durations were facts, so a rewrite could silently drop them.
const NUMERIC_DETAIL_RE = /\b\d[\d,]*(?:st|nd|rd|th)?(?:-[A-Za-z]+)?\b/g

// ── Date regexes ─────────────────────────────────────────────────────────
const DATE_NAMED_RE = /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?\d{4}\b/gi
const DATE_NUMERIC_RE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g
const DATE_ISO_RE = /\b\d{4}-\d{2}-\d{2}\b/g
const DATE_NO_YEAR_MONTH_FIRST_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?!\s*,?\s*\d{4})/gi
const DATE_NO_YEAR_DAY_FIRST_RE = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\b(?!\s*,?\s*\d{4})/gi

// ── Acronym / accreditation regexes ──────────────────────────────────────
const ACRONYM_RE = /\b[A-Z]{3,}\b/g
/**
 * "NZ"/"AU" as standalone words — 魏征 複審 2026-09-23: the exact incident
 * shape ("from New Zealand" -> "from Auckland") could equally have been
 * written as "from NZ" in the original, which ACRONYM_RE (3+ letters) and
 * AU_NZ_PLACE_NAMES (full names only) both miss. Case-sensitive, word-
 * bounded on purpose: catches "Tours across NZ" but not "ctstours.co.nz"
 * (lowercase) or "AUCKLAND" (no boundary after "AU").
 */
const PLACE_ABBREVIATION_RE = /\b(?:NZ|AU|ChCh)\b/g

// ── Departure-point context regexes (DR48-2) ─────────────────────────────
const DEPARTURE_PREFIX_RE = /\b(?:from|departing\s+from|departing|ex)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g
const DEPARTURE_SUFFIX_RE = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+[Dd]epartures?\b/g

// Generic ALLCAPS words that read as acronyms but never carry a page-specific
// fact (unlike e.g. "TAANZ", an actual travel-industry accreditation name).
const ACRONYM_ALLOWLIST = new Set(['SEO', 'FAQ', 'USA', 'UK', 'AI', 'NZD', 'AUD', 'USD', 'EUR', 'GBP'])

/**
 * AU/NZ place names — Magic Engine's entire target market is AU/NZ (see
 * CLAUDE.md / ME_PRODUCT_DEFINITION.md), so this is platform geography data,
 * not client-specific — the same category as the AU=2036/NZ=2554 DataForSEO
 * location codes already shared across every client
 * (src/lib/dataforseo/client.ts). Sorted longest-first so "New Zealand"
 * matches before any shorter overlapping token would. Not exhaustive by
 * design (a small, deliberately high-value list, same spirit as the
 * accreditation allowlist below) — 魏征 複審 2026-09-23 flagged missing
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

/**
 * Place-name aliases — DR48-2: normalizes common abbreviations to their
 * canonical form so "NZ" ↔ "New Zealand", "AU" ↔ "Australia",
 * "ChCh" ↔ "Christchurch" do not false-flag as drop + add.
 */
const PLACE_ALIASES: Record<string, string> = {
  nz: 'new zealand',
  au: 'australia',
  chch: 'christchurch',
}

/** Normalize full-width ASCII variants (＄, ０-９, Ａ-Ｚ etc.) to half-width before extraction. */
function normalizeWidth(text: string): string {
  return text.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

// Each extractor returns the fact as it actually reads in the source text
// (for a human-legible reason string) — comparison against the NEW text
// uses a separate `normalize` so formatting differences ($6,188 vs $6188,
// "22 Dec 2026" vs "22 dec 2026") never cause a false "dropped" positive.
const NO_OP_NORMALIZE = (s: string): string => s

// ── Price extraction (DR48-1: multi-currency, currency words, "from XXXX") ──
function extractPrices(text: string): string[] {
  const results = [
    ...text.matchAll(PRICE_RE),
    ...text.matchAll(PRICE_MULTI_CURRENCY_RE),
    ...text.matchAll(PRICE_CODE_RE),
    ...text.matchAll(PRICE_WORD_RE),
  ].map((m) => m[0])
  for (const m of text.matchAll(PRICE_CONTEXT_RE)) {
    if (m[1]) results.push(m[1])
  }
  return results
}
const normalizePrice = (s: string): string =>
  s.replace(/[^\d.]/g, '').replace(/\.00$/, '')

// ── Promotion extraction (DR48-1) ──
function extractPromos(text: string): string[] {
  return [...text.matchAll(PROMO_RE)].map((m) => m[0])
}
const normalizePromo = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

// ── Quantity extraction (DR48-1: "14 days", "12-day") ──
function extractQuantities(text: string): string[] {
  return [...text.matchAll(QUANTITY_RE)].map((m) => m[0])
}

// Prices, dates, durations and promos already have their own rules (with their own format
// normalisation); blank them out first so the same number is never judged twice — e.g. a date
// reworded from "22nd Dec 2026" to "22 Dec 2026" must not look like a dropped "22nd".
const ALREADY_COVERED_RES = [
  PRICE_RE, PRICE_MULTI_CURRENCY_RE, PRICE_CODE_RE, PRICE_WORD_RE, PRICE_CONTEXT_RE, PROMO_RE, QUANTITY_RE,
  DATE_NAMED_RE, DATE_NUMERIC_RE, DATE_ISO_RE, DATE_NO_YEAR_MONTH_FIRST_RE, DATE_NO_YEAR_DAY_FIRST_RE,
]

function extractNumericDetails(text: string): string[] {
  const rest = ALREADY_COVERED_RES.reduce((t, re) => t.replace(re, ' '), text)
  // A bare year ("2026") is a freshness marker SEO titles routinely add or refresh, not a page fact.
  return [...rest.matchAll(NUMERIC_DETAIL_RE)].map((m) => m[0]).filter((n) => !/^(?:19|20)\d{2}$/.test(n))
}
const normalizeNumericDetail = (s: string): string =>
  s.toLowerCase().replace(/,/g, '').replace(/^(\d+)(?:st|nd|rd|th)/, '$1')
const normalizeQuantity = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, '-').replace(/s\b/g, '')

// ── Date extraction (DR48-4: ISO, ordinals, day-first no-year, month normalization) ──
const MONTH_FULL_TO_SHORT: Record<string, string> = {
  january: 'jan', february: 'feb', march: 'mar', april: 'apr',
  june: 'jun', july: 'jul', august: 'aug',
  september: 'sep', october: 'oct', november: 'nov', december: 'dec',
}

function extractDates(text: string): string[] {
  return [
    ...text.matchAll(DATE_NAMED_RE),
    ...text.matchAll(DATE_NUMERIC_RE),
    ...text.matchAll(DATE_ISO_RE),
    ...text.matchAll(DATE_NO_YEAR_MONTH_FIRST_RE),
    ...text.matchAll(DATE_NO_YEAR_DAY_FIRST_RE),
  ].map((m) => m[0])
}
const normalizeDate = (s: string): string =>
  s.toLowerCase()
    .replace(/(?:st|nd|rd|th)\b/g, '')
    .replace(/\b(january|february|march|april|june|july|august|september|october|november|december)\b/g,
      (m) => MONTH_FULL_TO_SHORT[m] ?? m)
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// ── Acronym extraction ──
const PLACE_NAMES_UPPER = new Set(AU_NZ_PLACE_NAMES.map((n) => n.toUpperCase()))

function extractAcronyms(text: string, ignore: ReadonlySet<string> = EMPTY_IGNORE): string[] {
  return [...text.matchAll(ACRONYM_RE)].map((m) => m[0]).filter((a) => !ACRONYM_ALLOWLIST.has(a) && !PLACE_NAMES_UPPER.has(a) && !ignore.has(a.toLowerCase()))
}

const EMPTY_IGNORE: ReadonlySet<string> = new Set()

export interface HardFactOptions {
  /**
   * The client's own brand words (clients.seo_config.brand_terms, case-insensitive): a brand
   * name is not a page fact, so dropping it is not a contradiction. ⚠️ These words relax a
   * PUBLISHING gate — only the ALLCAPS-acronym rule is affected (place names, prices, dates,
   * quantities never are), and only single words of 3+ letters that are not a known
   * accreditation/authority name are honoured (子牙 review 2026-10-29).
   */
  ignoreTerms?: string[]
}

/** Accreditation / authority acronyms that are real page facts even if someone lists them as a brand term. */
const NEVER_IGNORED_ACRONYMS = new Set(['taanz', 'iata', 'tiaa', 'atas', 'afta', 'tico', 'abta', 'clia'])

function ignoreSet(options?: HardFactOptions): ReadonlySet<string> {
  return new Set(
    (options?.ignoreTerms ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter((t) => /^[a-z0-9]{3,}$/.test(t) && !NEVER_IGNORED_ACRONYMS.has(t)),
  )
}

// ── Place-name extraction (with alias normalization, DR48-2) ──
function extractPlaceNames(text: string): string[] {
  const lowerText = text.toLowerCase()
  const fullNames = AU_NZ_PLACE_NAMES.filter((name) => lowerText.includes(name.toLowerCase()))
  const abbreviations = [...new Set([...text.matchAll(PLACE_ABBREVIATION_RE)].map((m) => m[0]))]
  return [...fullNames, ...abbreviations]
}
const normalizePlaceName = (s: string): string => {
  const lower = s.toLowerCase()
  return PLACE_ALIASES[lower] ?? lower
}

// ── Departure-point extraction (DR48-2: "from Beijing", "Shanghai departures") ──
function extractDeparturePoints(text: string): string[] {
  const points: string[] = []
  for (const m of text.matchAll(DEPARTURE_PREFIX_RE)) {
    if (m[1]) points.push(m[1])
  }
  for (const m of text.matchAll(DEPARTURE_SUFFIX_RE)) {
    if (m[1]) points.push(m[1])
  }
  return [...new Set(points)]
}

/** Facts present in oldText (by `extract`) that are no longer anywhere in newText, compared via `normalize` but reported in their original raw form. */
function findDropped(oldText: string, newText: string, extract: (t: string) => string[], normalize: (s: string) => string = NO_OP_NORMALIZE): string[] {
  const oldRaw = [...new Set(extract(oldText))]
  const newNormalized = new Set(extract(newText).map(normalize))
  return oldRaw.filter((raw) => !newNormalized.has(normalize(raw)))
}

/**
 * The facts checkHardFactsPreserved will require to survive a rewrite —
 * given to the generator up front so it keeps them. 2026-10-28: every CTS
 * proposal had been blocked since 09-28 because the generator never saw the
 * current text and dropped exactly these facts; feeding them in is the fix.
 */
export function listHardFacts(title: string, desc: string, options?: HardFactOptions): string[] {
  const text = normalizeWidth(`${title}. ${desc}`)
  const ignore = ignoreSet(options)
  return [...new Set([
    ...extractPrices(text),
    ...extractDates(text),
    ...extractAcronyms(text, ignore),
    ...extractPlaceNames(text),
    ...extractDeparturePoints(text),
    ...extractPromos(text),
    ...extractQuantities(text),
    ...extractNumericDetails(text),
  ])]
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
  options?: HardFactOptions,
): HardFactCheckResult {
  const oldText = normalizeWidth(`${oldTitle}. ${oldDesc}`)
  const newText = normalizeWidth(`${newTitle}. ${newDesc}`)
  const ignore = ignoreSet(options)
  const acronyms = (t: string): string[] => extractAcronyms(t, ignore)

  const droppedFacts = [...new Set([
    ...findDropped(oldText, newText, extractPrices, normalizePrice),
    ...findDropped(oldText, newText, extractDates, normalizeDate),
    ...findDropped(oldText, newText, acronyms),
    ...findDropped(oldText, newText, extractPlaceNames, normalizePlaceName),
    ...findDropped(oldText, newText, extractDeparturePoints, normalizePlaceName),
    ...findDropped(oldText, newText, extractPromos, normalizePromo),
    ...findDropped(oldText, newText, extractQuantities, normalizeQuantity),
    ...findDropped(oldText, newText, extractNumericDetails, normalizeNumericDetail),
  ])]

  const addedFacts = [...new Set([
    ...findDropped(newText, oldText, extractPrices, normalizePrice),
    ...findDropped(newText, oldText, extractDates, normalizeDate),
    ...findDropped(newText, oldText, acronyms),
    ...findDropped(newText, oldText, extractPlaceNames, normalizePlaceName),
    ...findDropped(newText, oldText, extractDeparturePoints, normalizePlaceName),
    ...findDropped(newText, oldText, extractPromos, normalizePromo),
    ...findDropped(newText, oldText, extractQuantities, normalizeQuantity),
    ...findDropped(newText, oldText, extractNumericDetails, normalizeNumericDetail),
  ])]

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
