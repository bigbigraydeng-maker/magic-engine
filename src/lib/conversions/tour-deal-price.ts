/**
 * Starting price for one booking, from catalog display text.
 *
 * Many list prices are written "From …" (a per-person starting price, not a
 * confirmed invoice). Departure text wins when it is non-blank; otherwise the
 * tour text. The figure is multiplied by party size, so the result is a
 * starting total, not the amount the guest actually paid.
 *
 * A missing party size is not 1. Callers must not invent a value, and must not
 * store a purchase without an amount while the sale table still requires one.
 */

import { parsePriceDisplayString } from './cts-tour-price'
import { minorUnitsFor } from './money'

const PARTY_MIN = 1
const PARTY_MAX = 60

export type DealPrice =
  | {
      ok: true
      amount: string
      currency: string
      basis: 'departure' | 'tour'
      /** Always true: catalog text is a starting price, often prefixed "From". */
      startingPrice: true
    }
  | { ok: false; reason: 'missing_party_size' | 'unpriced' | 'unsupported_currency' }

export function priceDealFromCatalog(input: {
  departurePriceText?: string | null
  tourPriceText?: string | null
  partySize?: number | null
}): DealPrice {
  if (input.partySize == null) return { ok: false, reason: 'missing_party_size' }
  if (!legalParty(input.partySize)) return { ok: false, reason: 'unpriced' }

  const departure = nonBlank(input.departurePriceText)
  const tour = nonBlank(input.tourPriceText)
  const chosen = departure != null ? { text: departure, basis: 'departure' as const } : tour != null ? { text: tour, basis: 'tour' as const } : null
  if (!chosen) return { ok: false, reason: 'unpriced' }

  const parsed = readListPrice(chosen.text)
  if (parsed === 'unsupported') return { ok: false, reason: 'unsupported_currency' }
  if (parsed == null) return { ok: false, reason: 'unpriced' }

  const totalMinor = parsed.amountMinor * input.partySize
  if (!Number.isSafeInteger(totalMinor)) return { ok: false, reason: 'unpriced' }
  const amount = minorToDecimalString(totalMinor, parsed.currency)
  if (amount == null) return { ok: false, reason: 'unpriced' }
  return { ok: true, amount, currency: parsed.currency, basis: chosen.basis, startingPrice: true }
}

function legalParty(value: number): boolean {
  return Number.isInteger(value) && value >= PARTY_MIN && value <= PARTY_MAX
}

function nonBlank(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function readListPrice(raw: string): { amountMinor: number; currency: string } | 'unsupported' | null {
  const parsed = parsePriceDisplayString(raw)
  if (parsed) return parsed
  const tagged = raw.match(/\b([A-Z]{3})\b[^\d]*\$?\s*[\d,]+(?:\.\d+)?/)
  if (tagged && minorUnitsFor(tagged[1]) == null) return 'unsupported'
  return null
}

/** Integer minor units → a decimal string. Avoids binary float on the way into intake. */
export function minorToDecimalString(minor: number, currency: string): string | null {
  const exp = minorUnitsFor(currency)
  if (exp == null || !Number.isSafeInteger(minor) || minor <= 0) return null
  const digits = String(minor).padStart(exp + 1, '0')
  if (exp === 0) return digits
  return `${digits.slice(0, -exp)}.${digits.slice(-exp)}`
}
