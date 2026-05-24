/**
 * shopify-guard — format-level safety check for Shopify shop URLs.
 *
 * Validates and normalises a shop URL before persisting or using it as an
 * API base. Mirrors the constraints in url-guard.ts (WordPress), adapted for
 * Shopify specifics.
 *
 * Accepts:
 *  - Raw domain:  "my-store.myshopify.com"
 *  - HTTPS URL:   "https://my-store.myshopify.com"
 *  - Custom domain: "https://shop.example.com" (must be public HTTPS domain)
 *
 * Returns a normalised `https://{host}` origin (no trailing slash, no path).
 *
 * Phase 14.A.4 boundary: only format checks (synchronous). DNS-level SSRF
 * validation (resolve → reject private IPs) runs at connect-test time in the
 * shopify-client.ts caller.
 */

export interface ShopifyGuardResult {
  ok:             boolean
  normalizedUrl?: string
  error?:         string
}

// ─── Re-used private-range helpers (same logic as url-guard.ts) ──────────────

const IPV4_RE = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/

function isIpv6Host(host: string): boolean {
  return host.includes(':')
}

function isPrivateIpv4(host: string): boolean {
  if (!IPV4_RE.test(host)) return false
  const [a, b] = host.split('.').map(Number) as [number, number, number, number]
  if (a === 10)  return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64  && b <= 127) return true
  if (a === 0)   return true
  if (a >= 224)  return true
  return false
}

const BLOCKED_HOSTS = new Set(['localhost', 'ip6-localhost', 'ip6-loopback'])

const BLOCKED_HOST_SUFFIXES = [
  '.local', '.localhost', '.internal', '.lan', '.intranet',
  '.test', '.example', '.invalid',
]

// ─── validateShopifyShopUrl ──────────────────────────────────────────────────

export function validateShopifyShopUrl(input: unknown): ShopifyGuardResult {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'shop_url required' }
  }

  let raw = input.trim()

  // Allow bare domain like "my-store.myshopify.com" — prepend scheme.
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    raw = `https://${raw}`
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: 'Invalid shop_url — must be a valid domain or https:// URL' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'shop_url must use https:// (http is not allowed)' }
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'shop_url must not include embedded credentials' }
  }

  if (parsed.port && parsed.port !== '443') {
    return { ok: false, error: 'shop_url must use the default HTTPS port (443)' }
  }

  const host = parsed.hostname.toLowerCase()
  if (!host) {
    return { ok: false, error: 'shop_url is missing a hostname' }
  }

  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, error: `shop_url host "${host}" is not a public domain` }
  }

  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      return { ok: false, error: `shop_url host "${host}" is not a public domain` }
    }
  }

  if (isIpv6Host(host)) {
    return { ok: false, error: 'shop_url must be a domain name, not an IP address' }
  }

  if (IPV4_RE.test(host)) {
    if (isPrivateIpv4(host)) {
      return { ok: false, error: `shop_url IP "${host}" is in a private / reserved range` }
    }
    return { ok: false, error: 'shop_url must be a domain name, not an IP address' }
  }

  if (!host.includes('.')) {
    return { ok: false, error: `shop_url host "${host}" is not a public domain` }
  }

  const normalizedUrl = `https://${host}`
  return { ok: true, normalizedUrl }
}

/**
 * Build the Shopify Admin REST API base URL for a given API version.
 * e.g. "https://my-store.myshopify.com" → "https://my-store.myshopify.com/admin/api/2024-01"
 */
export function shopifyAdminBase(shopUrl: string, apiVersion = '2024-01'): string {
  return `${shopUrl}/admin/api/${apiVersion}`
}
