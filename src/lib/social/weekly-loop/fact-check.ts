import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import {
  extractFactClaims,
  type FactClaim,
  type DurationClaim,
  type StarClaim,
  type MoneyClaim,
  type MaskedPriceClaim,
  type DateClaim,
  type CruiseClaim,
} from './fact-claims-en'
import { nameSuffix } from './fact-aliases'

export type FactSource = 'overlay' | 'caption' | 'first_comment'
export type FactOutcome = 'PASS' | 'FAIL' | 'NEEDS_HUMAN'
export type FactItemKind =
  | 'old_tour_name'
  | 'duration_days'
  | 'hotel_stars'
  | 'money'
  | 'masked_price'
  | 'date'
  | 'cruise_name'
  | 'tour_not_sellable'
  | 'ambiguous_tour_name'
  | 'ambiguous_tour_link'
  | 'check_error'

export interface FactItem {
  kind: FactItemKind
  claim: string
  source: FactSource
  outcome: FactOutcome
  expected: string | null
}

export interface FactCheckInput {
  texts: { overlay: string | null; caption: string; firstComment: string | null }
  linkUrl: string | null
  tours: PublishedTourFact[]
  aliasesByTourId: Record<string, string[]>
  catalogVersion: number
  today: string
}

export interface FactCheckResult {
  verdict: 'pass' | 'fail' | 'needs_human'
  targetTourId: string | null
  catalogVersion: number
  items: FactItem[]
}

interface SourcedText {
  source: FactSource
  text: string
}

interface TargetResolution {
  target: PublishedTourFact | null
  ambiguousLink: FactItem | null
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wholePhraseRegex(phrase: string): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9])${escapeRegex(phrase)}(?![A-Za-z0-9])`,
    'i',
  )
}

function containsWholePhrase(haystack: string, phrase: string): boolean {
  if (phrase.length === 0) return false
  return wholePhraseRegex(phrase).test(haystack)
}

function containsWholeWord(haystack: string, word: string): boolean {
  if (word.length === 0) return false
  const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i')
  return re.test(haystack)
}

function lower(value: string): string {
  return value.toLowerCase()
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function firstInteger(text: string | null): number | null {
  if (text === null) return null
  const m = /\d+/.exec(text)
  if (m === null) return null
  const n = parseInt(m[0], 10)
  return Number.isNaN(n) ? null : n
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'unknown_error'
}

// ---------------------------------------------------------------------------
// Step 1: sourced texts
// ---------------------------------------------------------------------------

function buildSourcedTexts(input: FactCheckInput): SourcedText[] {
  const out: SourcedText[] = []
  if (isNonEmptyString(input.texts.overlay)) {
    out.push({ source: 'overlay', text: input.texts.overlay })
  }
  if (isNonEmptyString(input.texts.caption)) {
    out.push({ source: 'caption', text: input.texts.caption })
  }
  if (isNonEmptyString(input.texts.firstComment)) {
    out.push({ source: 'first_comment', text: input.texts.firstComment })
  }
  return out
}

// ---------------------------------------------------------------------------
// Step 2: target resolution
// ---------------------------------------------------------------------------

function pathSegments(linkUrl: string): string[] {
  const withoutQuery = linkUrl.split(/[?#]/)[0]
  return withoutQuery
    .split('/')
    .filter((seg) => seg.length > 0)
    .map((seg) => lower(seg))
}

function resolveTarget(input: FactCheckInput): TargetResolution {
  if (!isNonEmptyString(input.linkUrl)) {
    return { target: null, ambiguousLink: null }
  }
  const segments = pathSegments(input.linkUrl)
  if (segments.length === 0) {
    return { target: null, ambiguousLink: null }
  }
  const last = segments[segments.length - 1]
  const candidates = input.tours.filter((t) => lower(t.slug) === last)
  if (candidates.length === 0) {
    return { target: null, ambiguousLink: null }
  }
  if (candidates.length === 1) {
    return { target: candidates[0], ambiguousLink: null }
  }
  const otherSegments = segments.slice(0, segments.length - 1)
  const narrowed = candidates.filter((t) => {
    const dest = lower(t.destination)
    const tier = lower(t.tier)
    return otherSegments.some((seg) => seg === dest || seg === tier)
  })
  if (narrowed.length === 1) {
    return { target: narrowed[0], ambiguousLink: null }
  }
  return {
    target: null,
    ambiguousLink: {
      kind: 'ambiguous_tour_link',
      claim: input.linkUrl,
      source: 'caption',
      outcome: 'NEEDS_HUMAN',
      expected: null,
    },
  }
}

// ---------------------------------------------------------------------------
// Step 3: old tour names
// ---------------------------------------------------------------------------

function currentNameStrings(tour: PublishedTourFact): string[] {
  const out: string[] = [tour.name]
  if (isNonEmptyString(tour.title)) out.push(tour.title)
  const suffix = nameSuffix(tour.name)
  if (suffix.length > 0) out.push(suffix)
  return out
}

function collectCurrentNames(tours: PublishedTourFact[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tour of tours) {
    for (const name of currentNameStrings(tour)) {
      const key = lower(name)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(name)
    }
  }
  // Longer strings first so substrings are blanked before shorter ones.
  out.sort((a, b) => b.length - a.length)
  return out
}

function blankOut(text: string, phrases: string[]): string {
  let result = text
  for (const phrase of phrases) {
    if (phrase.length === 0) continue
    const re = new RegExp(escapeRegex(phrase), 'gi')
    result = result.replace(re, (match) => ' '.repeat(match.length))
  }
  return result
}

function aliasIsCurrent(
  alias: string,
  tour: PublishedTourFact,
): boolean {
  const key = lower(alias)
  if (key === lower(tour.name)) return true
  if (isNonEmptyString(tour.title) && key === lower(tour.title)) return true
  if (key === lower(nameSuffix(tour.name))) return true
  return false
}

function collectOldNameItems(
  input: FactCheckInput,
  texts: SourcedText[],
): FactItem[] {
  const currentNames = collectCurrentNames(input.tours)
  const items: FactItem[] = []
  for (const tour of input.tours) {
    const aliases = input.aliasesByTourId[tour.id]
    if (!Array.isArray(aliases)) continue
    for (const alias of aliases) {
      if (!isNonEmptyString(alias)) continue
      if (aliasIsCurrent(alias, tour)) continue
      for (const { source, text } of texts) {
        const blanked = blankOut(text, currentNames)
        if (!containsWholePhrase(blanked, alias)) continue
        items.push({
          kind: 'old_tour_name',
          claim: alias,
          source,
          outcome: 'FAIL',
          expected: tour.name,
        })
      }
    }
  }
  return items
}

// ---------------------------------------------------------------------------
// Step 4: ambiguous tour names
// ---------------------------------------------------------------------------

function groupBySuffix(
  tours: PublishedTourFact[],
): Map<string, PublishedTourFact[]> {
  const groups = new Map<string, PublishedTourFact[]>()
  for (const tour of tours) {
    const suffix = nameSuffix(tour.name)
    if (suffix.length === 0) continue
    const key = lower(suffix)
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, [tour])
    } else {
      existing.push(tour)
    }
  }
  return groups
}

function collectAmbiguousNameItems(
  input: FactCheckInput,
  texts: SourcedText[],
): FactItem[] {
  const groups = groupBySuffix(input.tours)
  const items: FactItem[] = []
  for (const [, group] of groups) {
    if (group.length < 2) continue
    const suffix = nameSuffix(group[0].name)
    for (const { source, text } of texts) {
      if (!containsWholePhrase(text, suffix)) continue
      items.push({
        kind: 'ambiguous_tour_name',
        claim: suffix,
        source,
        outcome: 'NEEDS_HUMAN',
        expected: null,
      })
    }
  }
  return items
}

// ---------------------------------------------------------------------------
// Step 5: claim checks
// ---------------------------------------------------------------------------

function needsHuman(
  kind: FactItemKind,
  claim: string,
  source: FactSource,
  expected: string | null,
): FactItem {
  return { kind, claim, source, outcome: 'NEEDS_HUMAN', expected }
}

function pass(
  kind: FactItemKind,
  claim: string,
  source: FactSource,
  expected: string | null,
): FactItem {
  return { kind, claim, source, outcome: 'PASS', expected }
}

function fail(
  kind: FactItemKind,
  claim: string,
  source: FactSource,
  expected: string | null,
): FactItem {
  return { kind, claim, source, outcome: 'FAIL', expected }
}

function checkDuration(
  claim: DurationClaim,
  source: FactSource,
  target: PublishedTourFact,
): FactItem {
  const catalogDays = firstInteger(target.durationText)
  if (catalogDays === null) {
    return needsHuman('duration_days', claim.text, source, null)
  }
  const expected = target.durationText
  if (catalogDays === claim.days) {
    return pass('duration_days', claim.text, source, expected)
  }
  return fail('duration_days', claim.text, source, expected)
}

function catalogStars(target: PublishedTourFact): number[] {
  const haystack = target.inclusions.join('. ')
  const claims = extractFactClaims(haystack)
  const set = new Set<number>()
  for (const c of claims) {
    if (c.kind !== 'hotel_stars') continue
    for (const s of c.stars) set.add(s)
  }
  return Array.from(set).sort((a, b) => a - b)
}

function starInclusionLines(target: PublishedTourFact): string[] {
  return target.inclusions.filter((line) => /star/i.test(line))
}

function sameNumberArray(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function checkStars(
  claim: StarClaim,
  source: FactSource,
  target: PublishedTourFact,
): FactItem {
  const catalog = catalogStars(target)
  if (catalog.length === 0) {
    return needsHuman('hotel_stars', claim.text, source, null)
  }
  const lines = starInclusionLines(target)
  const expected = lines.length > 0 ? lines.join(' / ') : null
  const claimSorted = [...claim.stars].sort((a, b) => a - b)
  if (sameNumberArray(claimSorted, catalog)) {
    return pass('hotel_stars', claim.text, source, expected)
  }
  return fail('hotel_stars', claim.text, source, expected)
}

function moneyAmountsFrom(text: string | null): number[] {
  if (!isNonEmptyString(text)) return []
  const claims = extractFactClaims(text)
  const out: number[] = []
  for (const c of claims) {
    if (c.kind === 'money') out.push(c.amount)
  }
  return out
}

function sellableDepartures(
  target: PublishedTourFact,
  today: string,
): PublishedTourFact['departures'] {
  return target.departures.filter(
    (d) =>
      (d.status === 'open' || d.status === 'limited') && d.departOn >= today,
  )
}

function allowedMoneyAmounts(
  target: PublishedTourFact,
  today: string,
): number[] {
  const out: number[] = []
  out.push(...moneyAmountsFrom(target.displayPriceText))
  for (const dep of sellableDepartures(target, today)) {
    out.push(...moneyAmountsFrom(dep.priceTextOverride))
  }
  out.push(...moneyAmountsFrom(target.singleSupplement))
  return out
}

function checkMoney(
  claim: MoneyClaim,
  source: FactSource,
  target: PublishedTourFact,
  today: string,
): FactItem {
  const allowed = allowedMoneyAmounts(target, today)
  const expected = target.displayPriceText
  if (allowed.length === 0 && !isNonEmptyString(target.displayPriceText)) {
    return needsHuman('money', claim.text, source, null)
  }
  if (allowed.includes(claim.amount)) {
    return pass('money', claim.text, source, expected)
  }
  return fail('money', claim.text, source, expected)
}

function checkMaskedPrice(
  claim: MaskedPriceClaim,
  source: FactSource,
): FactItem {
  return needsHuman('masked_price', claim.text, source, null)
}

function sellableDateStrings(
  target: PublishedTourFact,
  today: string,
): string[] {
  return sellableDepartures(target, today).map((d) => d.departOn)
}

function monthDayOf(iso: string): string {
  return iso.length >= 10 ? iso.slice(5, 10) : iso
}

function checkDate(
  claim: DateClaim,
  source: FactSource,
  target: PublishedTourFact,
  today: string,
): FactItem {
  const dates = sellableDateStrings(target, today)
  const expected = dates.length > 0 ? dates.join(', ') : null
  if (claim.iso !== null) {
    if (dates.includes(claim.iso)) {
      return pass('date', claim.text, source, expected)
    }
    return fail('date', claim.text, source, expected)
  }
  const match = dates.some((d) => monthDayOf(d) === claim.monthDay)
  if (match) {
    return pass('date', claim.text, source, expected)
  }
  return fail('date', claim.text, source, expected)
}

function checkCruise(
  claim: CruiseClaim,
  source: FactSource,
  target: PublishedTourFact,
): FactItem {
  const haystack = [...target.inclusions, ...target.highlights]
    .join(' ')
    .toLowerCase()
  if (containsWholeWord(haystack, claim.name.toLowerCase())) {
    return pass('cruise_name', claim.text, source, null)
  }
  return fail('cruise_name', claim.text, source, null)
}

function checkClaim(
  claim: FactClaim,
  source: FactSource,
  target: PublishedTourFact,
  today: string,
): FactItem {
  switch (claim.kind) {
    case 'duration_days':
      return checkDuration(claim, source, target)
    case 'hotel_stars':
      return checkStars(claim, source, target)
    case 'money':
      return checkMoney(claim, source, target, today)
    case 'masked_price':
      return checkMaskedPrice(claim, source)
    case 'date':
      return checkDate(claim, source, target, today)
    case 'cruise_name':
      return checkCruise(claim, source, target)
  }
}

function claimKindToItemKind(claim: FactClaim): FactItemKind {
  return claim.kind
}

function collectClaimItems(
  texts: SourcedText[],
  target: PublishedTourFact | null,
  today: string,
): FactItem[] {
  const items: FactItem[] = []
  for (const { source, text } of texts) {
    const claims = extractFactClaims(text)
    for (const claim of claims) {
      if (target === null) {
        items.push(
          needsHuman(claimKindToItemKind(claim), claim.text, source, null),
        )
        continue
      }
      items.push(checkClaim(claim, source, target, today))
    }
  }
  return items
}

function notSellableItem(target: PublishedTourFact): FactItem | null {
  if (target.isActive && !target.soldOut) return null
  return {
    kind: 'tour_not_sellable',
    claim: target.name,
    source: 'caption',
    outcome: 'FAIL',
    expected: 'sellable tour',
  }
}

// ---------------------------------------------------------------------------
// Step 6: verdict
// ---------------------------------------------------------------------------

function computeVerdict(items: FactItem[]): FactCheckResult['verdict'] {
  if (items.some((i) => i.outcome === 'FAIL')) return 'fail'
  if (items.some((i) => i.outcome === 'NEEDS_HUMAN')) return 'needs_human'
  return 'pass'
}

function assembleResult(
  input: FactCheckInput,
  target: PublishedTourFact | null,
  items: FactItem[],
): FactCheckResult {
  return {
    verdict: computeVerdict(items),
    targetTourId: target === null ? null : target.id,
    catalogVersion: input.catalogVersion,
    items,
  }
}

function errorResult(input: FactCheckInput, err: unknown): FactCheckResult {
  return {
    verdict: 'needs_human',
    targetTourId: null,
    catalogVersion: input.catalogVersion,
    items: [
      {
        kind: 'check_error',
        claim: errorMessage(err),
        source: 'caption',
        outcome: 'NEEDS_HUMAN',
        expected: null,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function checkFacts(input: FactCheckInput): FactCheckResult {
  try {
    const texts = buildSourcedTexts(input)
    const { target, ambiguousLink } = resolveTarget(input)

    const items: FactItem[] = []
    if (ambiguousLink !== null) items.push(ambiguousLink)

    items.push(...collectOldNameItems(input, texts))

    if (target === null) {
      items.push(...collectAmbiguousNameItems(input, texts))
    }

    if (target !== null) {
      const notSellable = notSellableItem(target)
      if (notSellable !== null) items.push(notSellable)
    }

    items.push(...collectClaimItems(texts, target, input.today))

    return assembleResult(input, target, items)
  } catch (err) {
    return errorResult(input, err)
  }
}
