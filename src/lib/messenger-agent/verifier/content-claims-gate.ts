/**
 * Shared content-claims gate for outbound customer replies.
 *
 * This module is used by every client's verifier policy. It knows nothing about
 * any specific client: the confirmed facts (valid prices and valid departure
 * dates) are supplied by the caller. It scans the reply text for claim shapes
 * and returns a single human-readable reason string when any claim is not backed
 * by a confirmed fact, or null when every claim is supported.
 *
 * It fails closed: any error, or a non-string input (which the scanner reports
 * as a `scan_error` hit), produces a non-null reason rather than null.
 */

import { scanOutboundClaims, type ClaimHit } from '@/lib/social/outbound-claims'

export interface ContentClaimsInput {
  text: string
  validPrices: ReadonlySet<number>
  validDates: ReadonlySet<string>
}

const ALWAYS_UNSUPPORTED = new Set([
  'duration',
  'promise',
  'visa',
  'availability',
  'discount',
  'scan_error',
])

function isPriceSupported(hit: ClaimHit, validPrices: ReadonlySet<number>): boolean {
  if (hit.value === undefined) return false
  const n = Number(hit.value)
  return Number.isFinite(n) && validPrices.has(n)
}

function isDateSupported(hit: ClaimHit, validDates: ReadonlySet<string>): boolean {
  const value = hit.value
  if (value === undefined) return false
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validDates.has(value)
  if (/^\d{2}-\d{2}$/.test(value)) {
    for (const d of validDates) {
      if (d.endsWith(`-${value}`)) return true
    }
    return false
  }
  return false
}

function describe(hit: ClaimHit): string {
  const value = hit.value !== undefined ? ` "${hit.value}"` : ''
  switch (hit.kind) {
    case 'price':
      return `price${value} (no confirmed price matches)`
    case 'date':
      return `date${value} (no confirmed departure date matches)`
    default:
      return `${hit.kind}${value}`
  }
}

export function evaluateClaims(input: ContentClaimsInput): string | null {
  try {
    const hits = scanOutboundClaims(input.text)
    const unsupported: ClaimHit[] = []
    const seen = new Set<string>()

    for (const hit of hits) {
      let supported: boolean
      if (hit.kind === 'price') {
        supported = isPriceSupported(hit, input.validPrices)
      } else if (hit.kind === 'date') {
        supported = isDateSupported(hit, input.validDates)
      } else if (ALWAYS_UNSUPPORTED.has(hit.kind)) {
        supported = false
      } else {
        supported = false
      }
      if (supported) continue
      const key = `${hit.kind}|${hit.value ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      unsupported.push(hit)
    }

    if (unsupported.length === 0) return null
    return `reply makes unverified claim(s): ${unsupported.map(describe).join('; ')}`
  } catch {
    return 'reply makes unverified claim(s): scan_error (claim check crashed)'
  }
}
