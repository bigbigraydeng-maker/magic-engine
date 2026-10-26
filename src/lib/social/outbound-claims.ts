/**
 * Shared claim scanner for outbound customer text.
 *
 * Before an AI or a staff member sends a message to a customer, we scan it for
 * "claim shapes": prices, dates, durations, promises, visa statements,
 * availability statements and discounts. A hit means the text states something
 * that must be backed by a confirmed fact or a human.
 *
 * It fails closed: if the input is not a string, or anything throws, we return a
 * single `scan_error` hit rather than an empty (i.e. "clean") result. Never
 * return [] on error.
 *
 * Pure: no network, no `any`. Split into core (normalise + numerals), price, date and words modules.
 */
import { normalise, type ClaimHit, type ClaimKind } from './outbound-claims-core'
import { detectPrice } from './outbound-claims-price'
import { detectDate, detectDuration } from './outbound-claims-date'
import { detectWords } from './outbound-claims-words'

export type { ClaimHit, ClaimKind }

export function scanOutboundClaims(text: string): ClaimHit[] {
  try {
    if (typeof text !== 'string') {
      return [{ kind: 'scan_error', match: '' }]
    }
    if (text.length > 3000) {
      return [{ kind: 'scan_error', match: 'input_too_long' }]
    }
    const normalised = normalise(text)
    const hits: ClaimHit[] = []
    detectPrice(normalised, hits)
    detectDate(normalised, hits)
    detectDuration(normalised, hits)
    detectWords(normalised, hits)
    return dedupe(hits)
  } catch {
    return [{ kind: 'scan_error', match: '' }]
  }
}

function dedupe(hits: ClaimHit[]): ClaimHit[] {
  const seen = new Set<string>()
  const out: ClaimHit[] = []
  for (const h of hits) {
    const key = `${h.kind}|${h.match}|${h.value ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(h)
    }
  }
  return out
}
