/**
 * Price text validation for the tour catalog.
 *
 * Pure, no I/O. Delegates actual amount parsing to the existing
 * `parsePriceDisplayString` helper so we never duplicate price-extraction logic.
 */

import { parsePriceDisplayString } from '@/lib/conversions/cts-tour-price'

export type PriceValidation =
  | { ok: true; kind: 'amount' | 'tbc' }
  | { ok: false; reason: string }

/** Currency codes we accept in price text. */
const ALLOWED_CURRENCIES = new Set([
  'NZD',
  'AUD',
  'USD',
  'CNY',
  'EUR',
  'GBP',
  'JPY',
  'SGD',
  'HKD',
  'CAD',
])

/** Collect the distinct allow-listed currency codes present in the text. */
function distinctCurrencies(text: string): Set<string> {
  const found = new Set<string>()
  const matches = text.match(/\b[A-Z]{3}\b/g)
  if (!matches) return found
  for (const code of matches) {
    if (ALLOWED_CURRENCIES.has(code)) found.add(code)
  }
  return found
}

/**
 * Validate a price display string.
 *
 * Order matters: empty -> multiple currencies -> TBC -> parse.
 */
export function validatePriceText(text: string): PriceValidation {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, reason: 'empty' }

  if (distinctCurrencies(trimmed).size > 1) {
    return { ok: false, reason: 'multiple_currencies' }
  }

  const hasDigit = /\d/.test(trimmed)
  if (!hasDigit && /\bTBC\b/i.test(trimmed)) {
    return { ok: true, kind: 'tbc' }
  }

  const parsed = parsePriceDisplayString(trimmed)
  if (parsed === null) return { ok: false, reason: 'unparseable' }
  return { ok: true, kind: 'amount' }
}
