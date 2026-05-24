/**
 * url-guard — format-level safety check for WordPress site URLs.
 *
 * Phase 14.A boundary: only WordPress sites we publish to are allowed, and we
 * never want a misconfigured row to point Magic Engine at an internal address.
 *
 * What this enforces (cheap, synchronous, run on every save):
 *  - URL must parse
 *  - scheme MUST be https (Phase 14 security spec — no http downgrades)
 *  - host MUST be a public domain
 *      - reject IP literals (v4 / v6)
 *      - reject localhost, *.local, *.localhost, *.internal, *.lan
 *      - reject loopback / private RFC1918 / link-local / CGNAT ranges
 *  - port, if present, MUST be 443 (default HTTPS only)
 *  - returns a normalized origin (`https://host[:port]`, no trailing slash, no path)
 *
 * What this does NOT enforce (deferred to A.5 fetch-time):
 *  - DNS resolution check (a public-looking host can still resolve to 10.x.x.x)
 *  - Actual WordPress REST API reachability
 *  - Credential validity
 *
 * The A.5 connector MUST re-validate at fetch time via Node's `dns.lookup` and
 * reject if the resolved address is private — this guard only catches the obvious
 * mistakes at save time so we surface them in the UI immediately.
 */

export interface UrlGuardResult {
  ok:             boolean
  normalizedUrl?: string
  error?:         string
}

// ─── Public host blocklist ───────────────────────────────────────────────────

const BLOCKED_HOSTS = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
])

const BLOCKED_HOST_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.lan',
  '.intranet',
  '.test',
  '.example',   // RFC 2606 reserved TLDs are not for real sites
  '.invalid',
]

// IPv4 octet (0-255)
const IPV4_RE = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/

// IPv6 — anything with a colon that URL host parsing yields is one
function isIpv6Host(host: string): boolean {
  // URL parsing wraps v6 in brackets, but URL.hostname strips them.
  return host.includes(':')
}

// Private / loopback / link-local / CGNAT ranges
function isPrivateIpv4(host: string): boolean {
  if (!IPV4_RE.test(host)) return false
  const [a, b] = host.split('.').map(Number) as [number, number, number, number]
  if (a === 10) return true                                     // 10.0.0.0/8
  if (a === 127) return true                                    // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true                       // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true              // 172.16.0.0/12
  if (a === 192 && b === 168) return true                       // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true             // 100.64.0.0/10 CGNAT
  if (a === 0) return true                                      // 0.0.0.0/8
  if (a >= 224) return true                                     // multicast + reserved
  return false
}

// ─── validateWordpressSiteUrl ────────────────────────────────────────────────

export function validateWordpressSiteUrl(input: unknown): UrlGuardResult {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'site_url required' }
  }

  const raw = input.trim()

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: 'Invalid URL — must include https:// prefix' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'site_url must use https:// (http is not allowed)' }
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'site_url must not include embedded credentials' }
  }

  if (parsed.port && parsed.port !== '443') {
    return { ok: false, error: 'site_url must use the default HTTPS port (443)' }
  }

  const host = parsed.hostname.toLowerCase()
  if (!host) {
    return { ok: false, error: 'site_url is missing a hostname' }
  }

  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, error: `site_url host "${host}" is not a public domain` }
  }

  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      return { ok: false, error: `site_url host "${host}" is not a public domain` }
    }
  }

  if (isIpv6Host(host)) {
    return { ok: false, error: 'site_url must be a domain name, not an IP address' }
  }

  if (IPV4_RE.test(host)) {
    if (isPrivateIpv4(host)) {
      return { ok: false, error: `site_url IP "${host}" is in a private / reserved range` }
    }
    return { ok: false, error: 'site_url must be a domain name, not an IP address' }
  }

  // Require at least one dot in the hostname — single-label hosts (e.g. "wordpress")
  // are intranet by convention.
  if (!host.includes('.')) {
    return { ok: false, error: `site_url host "${host}" is not a public domain` }
  }

  // Build normalized origin: https://host[:port], no path / query / fragment / trailing slash.
  const portSuffix = parsed.port ? `:${parsed.port}` : ''
  const normalizedUrl = `https://${host}${portSuffix}`

  return { ok: true, normalizedUrl }
}
