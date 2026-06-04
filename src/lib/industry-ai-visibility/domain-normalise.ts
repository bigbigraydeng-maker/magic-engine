/**
 * Phase 30 — SERP brand fallback.
 *
 * Given a URL from a Google organic result, return a coarse "domain brand"
 * suitable for downstream LLM standardisation (e.g. "ctstours.co.nz" →
 * "ctstours"). Returns null when the host is on the aggregator blacklist
 * — those domains are not brands and must not enter `brands_mentioned`.
 *
 * This is intentionally simple: the canonical, human-readable brand name
 * (e.g. "CTS Tours") comes from the LLM standardiser. Domain extraction
 * is the LLM's INPUT and the fallback when the LLM fails.
 */

import { isAggregatorHost } from './aggregator-blacklist'

// Multi-segment TLDs we recognise. Order matters: longer matches first.
const KNOWN_PUBLIC_SUFFIXES: readonly string[] = [
  'co.nz', 'org.nz', 'net.nz', 'govt.nz', 'school.nz',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
]

const SINGLE_TLDS: readonly string[] = [
  'com', 'net', 'org', 'io', 'co', 'app', 'dev',
  'nz', 'au', 'uk', 'cn', 'jp', 'kr', 'de', 'fr', 'us',
  'info', 'biz', 'me', 'tv', 'cc', 'travel', 'shop',
]

/**
 * Strip the TLD/eTLD off a host and return the remaining "registrable" name.
 *
 *   ctstours.co.nz       → "ctstours"
 *   www.intrepidtravel.com → "intrepidtravel"
 *   bookings.example.org → "example" (subdomain dropped)
 *   localhost            → "localhost" (no TLD → returned as-is)
 */
function stripTldAndSubdomain(host: string): string {
  const cleaned = host.toLowerCase().replace(/^www\./, '')
  const parts = cleaned.split('.')
  if (parts.length === 1) return cleaned

  // Try longest public suffix first (e.g. .co.nz before .nz)
  for (const suffix of KNOWN_PUBLIC_SUFFIXES) {
    if (cleaned.endsWith('.' + suffix)) {
      const base = cleaned.slice(0, -1 * (suffix.length + 1))  // drop ".co.nz"
      const baseParts = base.split('.')
      return baseParts[baseParts.length - 1]  // last label
    }
  }

  // Fall back to single TLDs
  const last = parts[parts.length - 1]
  if (SINGLE_TLDS.includes(last)) {
    return parts[parts.length - 2] ?? cleaned
  }

  // Unknown TLD: return last two labels joined (defensive)
  return parts.slice(-2).join('.')
}

/**
 * Extract a domain-brand candidate from an organic result URL, or null when
 * the host is an aggregator / SaaS multi-tenant domain.
 */
export function extractDomainBrand(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  let host: string
  try {
    host = new URL(rawUrl).hostname
  } catch {
    return null
  }
  if (!host) return null
  if (isAggregatorHost(host)) return null
  const brand = stripTldAndSubdomain(host)
  return brand.trim() || null
}

/**
 * Project a SERP organic_results array to a deduplicated list of
 * domain-brand candidates (preserving SERP order). Use this as the
 * fallback brand source when the LLM standardiser is unavailable.
 */
export function extractDomainBrandsFromOrganic(
  organic: Array<{ url: string }> | null | undefined,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of organic ?? []) {
    const brand = extractDomainBrand(row.url)
    if (!brand) continue
    if (seen.has(brand)) continue
    seen.add(brand)
    out.push(brand)
  }
  return out
}
