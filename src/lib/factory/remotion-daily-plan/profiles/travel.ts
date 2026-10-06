import type { IndustryWordProfile, ProductFactInput, WordContext, WordSpec, BlockReason } from '../types'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const

const CURRENCY_PREFIX: Record<string, string> = { NZD: 'NZ$', AUD: 'A$', USD: 'US$' }

type BuildResult = { ok: true; words: WordSpec[] } | { ok: false; reason: BlockReason; detail: string }

/** Validate the required fact fields for the travel profile. */
function validateFact(fact: ProductFactInput): { ok: true } | { ok: false; reason: BlockReason; detail: string } {
  const days = fact.duration_days
  if (days === null || !Number.isInteger(days) || days < 1 || days > 99) {
    return { ok: false, reason: 'fact_incomplete', detail: 'duration_days must be an integer 1..99' }
  }
  const price = fact.from_price
  if (price === null || !Number.isFinite(price.amount) || price.amount <= 0) {
    return { ok: false, reason: 'fact_incomplete', detail: 'from_price.amount must be a positive finite number' }
  }
  if (fact.departures === null || fact.departures.length === 0) {
    return { ok: false, reason: 'fact_incomplete', detail: 'departures must be non-empty' }
  }
  if (fact.inclusions === null || fact.inclusions.length === 0) {
    return { ok: false, reason: 'fact_incomplete', detail: 'inclusions must be non-empty' }
  }
  return { ok: true }
}

/** Format a price amount with the currency prefix, or fail on unknown currency. */
function priceWord(amount: number, currency: string): { ok: true; text: string } | { ok: false; reason: BlockReason; detail: string } {
  const prefix = CURRENCY_PREFIX[currency]
  if (prefix === undefined) {
    return { ok: false, reason: 'price_currency_unknown', detail: `unknown currency: ${currency}` }
  }
  const formatted = amount.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return { ok: true, text: prefix + formatted }
}

/** Detect the star rating inside a single inclusion string, digits verbatim. */
function starWord(inclusion: string): string | null {
  const m = inclusion.match(/(\d)(?:\s*[–-]\s*(\d))?[\s-]*star/i)
  if (m === null) return null
  const a = m[1]
  const b = m[2]
  return b !== undefined ? `${a}-${b} STAR` : `${a} STAR`
}

/** Build the inclusion-derived words in the fixed order. */
function inclusionWords(inclusions: string[]): WordSpec[] {
  const joined = inclusions.join(' ; ').toLowerCase()
  const words: WordSpec[] = []
  if (/air\s?fares?|flights?/.test(joined)) {
    words.push({ text: 'FLIGHTS', beats: 1, bg: 'black' })
    words.push({ text: 'INCLUDED', beats: 1, bg: 'black' })
  }
  for (const inc of inclusions) {
    const lower = inc.toLowerCase()
    if (/hotel|accommodation/.test(lower)) {
      const star = starWord(inc)
      if (star !== null) {
        words.push({ text: star, beats: 1, bg: 'black' })
        words.push({ text: 'HOTELS', beats: 1, bg: 'black' })
        break
      }
    }
  }
  if (/cruise/.test(joined)) {
    words.push({ text: 'CRUISE', beats: 1, bg: 'black' })
  }
  if (/english[\s-]*speaking[^;]*guide|english guide/.test(joined)) {
    words.push({ text: 'ENGLISH', beats: 1, bg: 'black' })
    words.push({ text: 'GUIDE', beats: 1, bg: 'black' })
  }
  return words
}

/** True only for a real calendar date written as YYYY-MM-DD (rejects 2027-02-31). */
function isCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** Keep real calendar dates strictly after the client's local today, sorted ascending, max 2. */
function futureDepartures(departures: string[], today: string): string[] {
  return departures.filter((d) => isCalendarDate(d) && d > today).sort().slice(0, 2)
}

/** Format an ISO date as `${d} ${MON} ${yyyy}` without locale. */
function formatDeparture(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-')
  const mon = MONTHS[Number(mm) - 1]
  return `${Number(dd)} ${mon} ${yyyy}`
}

/** Build the departure words, or fail if none remain. */
function departureWords(departures: string[], today: string): { ok: true; words: WordSpec[] } | { ok: false; reason: BlockReason; detail: string } {
  const future = futureDepartures(departures, today)
  if (future.length === 0) {
    return { ok: false, reason: 'departures_past', detail: 'no departures after today' }
  }
  const words: WordSpec[] = [{ text: 'DEPARTS', beats: 1, bg: 'black' }]
  for (const iso of future) {
    words.push({ text: formatDeparture(iso), beats: 1, bg: 'black' })
  }
  return { ok: true, words }
}

/** Build the basis words from price_basis, if present. */
function basisWords(priceBasis: string | null): WordSpec[] {
  if (priceBasis === null) return []
  const lower = priceBasis.toLowerCase()
  const words: WordSpec[] = []
  if (lower.includes('per person')) words.push({ text: 'PER PERSON', beats: 1, bg: 'black' })
  if (lower.includes('twin share')) words.push({ text: 'TWIN SHARE', beats: 1, bg: 'black' })
  return words
}

/** Keep brand-coloured words as they are; alternate black/white across all the others (starting with black). */
function applyAlternatingBg(words: WordSpec[]): WordSpec[] {
  let toggle = 0
  return words.map((w) => {
    if (w.bg === 'brand') return w
    const bg = toggle % 2 === 0 ? 'black' : 'white'
    toggle += 1
    return { ...w, bg }
  })
}

/** Enforce the 12-char uppercase limit on every word. */
function checkLengths(words: WordSpec[]): { ok: true } | { ok: false; reason: BlockReason; detail: string } {
  for (const w of words) {
    if (w.text.length > 12) {
      return { ok: false, reason: 'word_too_long', detail: `word too long: ${w.text}` }
    }
  }
  return { ok: true }
}

function buildWords(fact: ProductFactInput, ctx: WordContext): BuildResult {
  const valid = validateFact(fact)
  if (!valid.ok) return valid

  const days = fact.duration_days as number
  const price = fact.from_price as { amount: number; currency: string }
  const inclusions = fact.inclusions as string[]
  const departures = fact.departures as string[]

  const priceResult = priceWord(price.amount, price.currency)
  if (!priceResult.ok) return priceResult

  const departuresResult = departureWords(departures, ctx.today)
  if (!departuresResult.ok) return departuresResult

  const words: WordSpec[] = []
  words.push({ text: `${days} DAYS`, beats: 2, bg: 'brand' })
  words.push(...inclusionWords(inclusions))
  words.push({ text: 'FROM', beats: 1, bg: 'black' })
  words.push({ text: priceResult.text, beats: 2, bg: 'brand' })
  words.push(...basisWords(fact.price_basis))
  words.push(...departuresResult.words)
  words.push({ text: priceResult.text, beats: 2, bg: 'brand' })
  words.push({ text: `${days} DAYS`, beats: 1, bg: 'black' })

  const lengthCheck = checkLengths(words)
  if (!lengthCheck.ok) return lengthCheck

  return { ok: true, words: applyAlternatingBg(words) }
}

export const travelProfile: IndustryWordProfile = { id: 'travel', buildWords }
