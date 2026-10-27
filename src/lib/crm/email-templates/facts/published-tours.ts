import type { PublishedTourFact, PublishedTourFactDeparture } from '@/lib/tour-catalog/publish-contract'
import type { PickFilter, PickMode, PublishedToursProviderSettings } from '../types'
import { extractAmounts } from '../amounts'
import type {
  FactProvider,
  LinkViolation,
  PickInput,
  ProviderValue,
  RenderFacts,
  ResolvedPick,
  VariableSpec,
} from './types'

export interface PickOption {
  tourId: string
  slug: string
  destination: string
  tier: string
  name: string
  durationText: string | null
  priceText: string | null
  requiresDeparture: boolean
  departures: Array<{
    departOn: string
    displayDate: string
    status: 'open' | 'limited'
    priceText: string | null
  }>
}

export type ResolvePicksResult =
  | { ok: true; picks: ResolvedPick[] }
  | { ok: false; reason: 'invalid_pick' | 'tour_unavailable'; detail: string }

const MAX_MANY_PICKS = 3

function isSellable(tour: PublishedTourFact): boolean {
  return tour.isActive && !tour.soldOut
}

function monthOf(departOn: string): number | null {
  const m = /^\d{4}-(\d{2})-\d{2}$/.exec(departOn)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 12 ? n : null
}

function matchesList(value: string, list: readonly string[] | undefined): boolean {
  if (!list || list.length === 0) return true
  const v = value.toLowerCase()
  return list.some((x) => x.toLowerCase() === v)
}

function tourMatchesFilter(tour: PublishedTourFact, filter: PickFilter): boolean {
  if (!matchesList(tour.destination, filter.destinations)) return false
  if (!matchesList(tour.tier, filter.tiers)) return false
  const months = filter.departureMonths
  if (months && months.length > 0) {
    if (!tour.managesDepartures) return false
    const kept = tour.departures.filter((d) => {
      const m = monthOf(d.departOn)
      return m !== null && months.includes(m)
    })
    if (kept.length === 0) return false
  }
  return true
}

function filterDepartures(
  tour: PublishedTourFact,
  filter: PickFilter,
): PublishedTourFactDeparture[] {
  const months = filter.departureMonths
  if (!months || months.length === 0) return tour.departures
  return tour.departures.filter((d) => {
    const m = monthOf(d.departOn)
    return m !== null && months.includes(m)
  })
}

export function listPickOptions(
  tours: readonly PublishedTourFact[],
  filter: PickFilter,
): PickOption[] {
  const out: PickOption[] = []
  for (const tour of tours) {
    if (!isSellable(tour)) continue
    if (!tourMatchesFilter(tour, filter)) continue
    const departures = tour.managesDepartures ? filterDepartures(tour, filter) : []
    if (tour.managesDepartures && departures.length === 0) continue
    out.push({
      tourId: tour.id,
      slug: tour.slug,
      destination: tour.destination,
      tier: tour.tier,
      name: tour.name,
      durationText: tour.durationText,
      priceText: tour.displayPriceText,
      requiresDeparture: tour.managesDepartures,
      departures: departures.map((d) => ({
        departOn: d.departOn,
        displayDate: d.displayDate,
        status: d.status,
        priceText: d.priceTextOverride,
      })),
    })
  }
  return out
}

function expectedCountOk(mode: PickMode, n: number): boolean {
  if (mode === 'none') return n === 0
  if (mode === 'one') return n === 1
  return n >= 1 && n <= MAX_MANY_PICKS
}

function pickKey(p: PickInput): string {
  return `${p.tourId}\u0000${p.departOn ?? ''}`
}

export function resolvePicks(
  tours: readonly PublishedTourFact[],
  inputs: readonly PickInput[],
  filter: PickFilter,
  mode: PickMode,
): ResolvePicksResult {
  if (!expectedCountOk(mode, inputs.length)) {
    return { ok: false, reason: 'invalid_pick', detail: '选择数量不符合模板要求' }
  }
  const seen = new Set<string>()
  for (const input of inputs) {
    const key = pickKey(input)
    if (seen.has(key)) {
      return { ok: false, reason: 'invalid_pick', detail: '存在重复的选择' }
    }
    seen.add(key)
  }
  const picks: ResolvedPick[] = []
  for (const input of inputs) {
    const tour = tours.find((t) => t.id === input.tourId)
    if (!tour) {
      return { ok: false, reason: 'invalid_pick', detail: '找不到所选行程' }
    }
    if (!tourMatchesFilter(tour, filter)) {
      return { ok: false, reason: 'invalid_pick', detail: '所选行程不符合模板筛选条件' }
    }
    if (!isSellable(tour)) {
      return { ok: false, reason: 'tour_unavailable', detail: '所选行程已下架' }
    }
    if (tour.managesDepartures) {
      if (input.departOn === null) {
        return { ok: false, reason: 'tour_unavailable', detail: '所选行程需要选择班期' }
      }
      const departure = tour.departures.find((d) => d.departOn === input.departOn)
      if (!departure) {
        return { ok: false, reason: 'tour_unavailable', detail: '所选班期已不再售卖' }
      }
      picks.push({ tour, departure })
    } else {
      if (input.departOn !== null) {
        return { ok: false, reason: 'invalid_pick', detail: '所选行程不需要班期' }
      }
      picks.push({ tour, departure: null })
    }
  }
  return { ok: true, picks }
}

export function buildTourUrl(
  settings: PublishedToursProviderSettings,
  tour: PublishedTourFact,
  departure: PublishedTourFactDeparture | null,
): string {
  const base = settings.urlPattern
    .replace(/\{destination\}/g, encodeURIComponent(tour.destination))
    .replace(/\{tier\}/g, encodeURIComponent(tour.tier))
    .replace(/\{slug\}/g, encodeURIComponent(tour.slug))
  if (!departure) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}date=${encodeURIComponent(departure.departOn)}`
}

function isBlank(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.trim() === ''
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function bulletList(items: readonly string[], count: number | null): string | null {
  const cleaned = items.map(collapse).filter((s) => s !== '')
  if (cleaned.length === 0) return null
  const limited = count === null ? cleaned : cleaned.slice(0, count)
  if (limited.length === 0) return null
  return limited.map((s) => `• ${s}`).join('\n')
}

function priceTextFor(pick: ResolvedPick): string | null {
  const base = pick.tour.displayPriceText
  if (isBlank(base)) return null
  const override = pick.departure?.priceTextOverride
  if (isBlank(override)) return base
  const baseAmounts = new Set(extractAmounts(base))
  const overrideAmounts = extractAmounts(override)
  const differs = overrideAmounts.some((a) => !baseAmounts.has(a))
  return differs ? `${base} (this departure: ${override})` : base
}

function tourUrlFor(pick: ResolvedPick, facts: RenderFacts): string | null {
  if (!facts.settings) return null
  return buildTourUrl(facts.settings, pick.tour, pick.departure)
}

function cardFor(pick: ResolvedPick, facts: RenderFacts): string | null {
  const price = priceTextFor(pick)
  const url = tourUrlFor(pick, facts)
  if (price === null || url === null) return null
  const lines: string[] = []
  const duration = pick.tour.durationText
  lines.push(isBlank(duration) ? pick.tour.name : `${pick.tour.name} (${duration})`)
  if (pick.departure) lines.push(`Departing ${pick.departure.displayDate}`)
  lines.push(price)
  lines.push(url)
  return lines.join('\n')
}

function resolveSingle(name: string, facts: RenderFacts): ProviderValue {
  const pick = facts.picks[0]
  if (!pick) return { ok: false, missing: 'tour' }
  switch (name) {
    case 'tour_name':
      return isBlank(pick.tour.name) ? { ok: false, missing: name } : { ok: true, value: pick.tour.name }
    case 'tour_duration':
      return isBlank(pick.tour.durationText)
        ? { ok: false, missing: name }
        : { ok: true, value: pick.tour.durationText as string }
    case 'departure_date':
      return !pick.departure || isBlank(pick.departure.displayDate)
        ? { ok: false, missing: name }
        : { ok: true, value: pick.departure.displayDate }
    case 'tour_price': {
      const price = priceTextFor(pick)
      return price === null ? { ok: false, missing: name } : { ok: true, value: price }
    }
    case 'tour_url': {
      const url = tourUrlFor(pick, facts)
      return url === null ? { ok: false, missing: name } : { ok: true, value: url }
    }
    default:
      return { ok: false, missing: name }
  }
}

function resolveList(name: string, count: number | null, facts: RenderFacts): ProviderValue {
  const pick = facts.picks[0]
  if (!pick) return { ok: false, missing: 'tour' }
  const items = name === 'tour_highlights' ? pick.tour.highlights : pick.tour.inclusions
  const value = bulletList(items, count)
  return value === null ? { ok: false, missing: name } : { ok: true, value }
}

function resolveCards(facts: RenderFacts): ProviderValue {
  if (facts.picks.length === 0) return { ok: false, missing: 'tour_cards' }
  if (!facts.settings) return { ok: false, missing: 'tour_cards' }
  const cards: string[] = []
  for (const pick of facts.picks) {
    const card = cardFor(pick, facts)
    if (card === null) return { ok: false, missing: 'tour_cards' }
    cards.push(card)
  }
  return { ok: true, value: cards.join('\n\n') }
}

function resolveVariable(name: string, count: number | null, facts: RenderFacts): ProviderValue {
  if (name === 'all_tours_url') {
    if (!facts.settings || isBlank(facts.settings.allToursUrl)) {
      return { ok: false, missing: name }
    }
    return { ok: true, value: facts.settings.allToursUrl }
  }
  if (name === 'tour_cards') return resolveCards(facts)
  if (name === 'tour_highlights' || name === 'tour_inclusions') {
    return resolveList(name, count, facts)
  }
  return resolveSingle(name, facts)
}

const SINGLE: VariableSpec = { pickModes: ['one'], list: false, multiline: false }
const SINGLE_LIST: VariableSpec = { pickModes: ['one'], list: true, multiline: true }
const MANY_CARDS: VariableSpec = { pickModes: ['many'], list: false, multiline: true }
const ALL_TOURS: VariableSpec = { pickModes: ['one', 'many'], list: false, multiline: false }

const VARIABLES: Readonly<Record<string, VariableSpec>> = {
  tour_name: SINGLE,
  tour_duration: SINGLE,
  tour_price: SINGLE,
  departure_date: SINGLE,
  tour_url: SINGLE,
  tour_highlights: SINGLE_LIST,
  tour_inclusions: SINGLE_LIST,
  tour_cards: MANY_CARDS,
  all_tours_url: ALL_TOURS,
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface PathPattern {
  host: string
  regex: RegExp
  groupOrder: Array<'destination' | 'tier' | 'slug'>
}

function parsePathPattern(urlPattern: string): PathPattern | null {
  let parsed: URL
  try {
    parsed = new URL(urlPattern)
  } catch {
    return null
  }
  // new URL() percent-encodes the braces of {destination}/{tier}/{slug}; restore them before scanning for tokens
  const rawPath = parsed.pathname.replace(/%7B/gi, '{').replace(/%7D/gi, '}')
  const groupOrder: Array<'destination' | 'tier' | 'slug'> = []
  let regexSource = ''
  let i = 0
  while (i < rawPath.length) {
    const rest = rawPath.slice(i)
    const m = /^\{(destination|tier|slug)\}/.exec(rest)
    if (m) {
      groupOrder.push(m[1] as 'destination' | 'tier' | 'slug')
      regexSource += '([A-Za-z0-9._~-]+)'
      i += m[0].length
      continue
    }
    regexSource += escapeRegex(rawPath[i])
    i += 1
  }
  return {
    host: parsed.hostname.toLowerCase(),
    regex: new RegExp(`^${regexSource}/?$`),
    groupOrder,
  }
}

function checkOneUrl(url: string, pattern: PathPattern, facts: RenderFacts): LinkViolation | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== pattern.host) return null
  const match = pattern.regex.exec(parsed.pathname)
  if (!match) return null
  const captured: Partial<Record<'destination' | 'tier' | 'slug', string>> = {}
  pattern.groupOrder.forEach((key, idx) => {
    captured[key] = match[idx + 1]
  })
  const dest = captured.destination
  const tier = captured.tier
  const slug = captured.slug
  if (!dest || !tier || !slug) return null
  const tour = facts.tours.find(
    (t) =>
      t.destination.toLowerCase() === dest.toLowerCase() &&
      t.tier.toLowerCase() === tier.toLowerCase() &&
      t.slug.toLowerCase() === slug.toLowerCase(),
  )
  if (!tour || !isSellable(tour)) {
    return {
      url,
      code: 'tour_page_not_on_sale',
      detail: `${dest}/${tier}/${slug}`,
    }
  }
  const date = parsed.searchParams.get('date')
  if (date !== null) {
    const found = tour.departures.some((d) => d.departOn === date)
    if (!found) {
      return {
        url,
        code: 'departure_not_on_sale',
        detail: `${dest}/${tier}/${slug} ${date}`,
      }
    }
  }
  return null
}

function checkLinks(urls: readonly string[], facts: RenderFacts): LinkViolation[] {
  if (!facts.settings) return []
  const pattern = parsePathPattern(facts.settings.urlPattern)
  if (!pattern) return []
  const out: LinkViolation[] = []
  for (const url of urls) {
    const v = checkOneUrl(url, pattern, facts)
    if (v) out.push(v)
  }
  return out
}

function knownAmounts(facts: RenderFacts): string[] {
  const set = new Set<string>()
  for (const pick of facts.picks) {
    for (const a of extractAmounts(pick.tour.displayPriceText ?? '')) set.add(a)
    for (const a of extractAmounts(pick.departure?.priceTextOverride ?? '')) set.add(a)
    for (const a of extractAmounts(pick.tour.singleSupplement ?? '')) set.add(a)
  }
  return Array.from(set).sort()
}

function sellable(picks: readonly ResolvedPick[]): { ok: true } | { ok: false; detail: string } {
  for (const pick of picks) {
    if (!isSellable(pick.tour)) {
      return { ok: false, detail: `行程「${pick.tour.name}」已下架` }
    }
    if (pick.tour.managesDepartures && !pick.departure) {
      return { ok: false, detail: `行程「${pick.tour.name}」需要选择班期` }
    }
  }
  return { ok: true }
}

export const publishedToursProvider: FactProvider = {
  id: 'published_tours',
  variables: VARIABLES,
  resolve: resolveVariable,
  checkLinks,
  knownAmounts,
  sellable,
}
