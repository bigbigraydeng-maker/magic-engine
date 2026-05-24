/**
 * ssrf-guard — shared runtime SSRF protection for CMS outbound fetch calls.
 *
 * Resolves the hostname and rejects any address in a private, loopback, or
 * reserved range for both IPv4 and IPv6. Fails CLOSED: if DNS resolution
 * fails entirely the request is rejected, not allowed through.
 *
 * WHY: a hostname that looks like a public domain at save time can resolve to
 * 10.x.x.x in the hosting environment (split-horizon DNS, internal alias, etc.).
 * IPv6-only hosts must also be validated — skipping IPv6 would allow ::1 or
 * fc00:: targets to bypass the guard.
 */

import dns from 'dns'

function isPrivateIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number) as [number, number, number, number]
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 0 ||
    a >= 224
  )
}

function isPrivateIpv6(address: string): boolean {
  const a = address.toLowerCase()
  if (a === '::1' || a === '::') return true
  if (/^fe[89ab][0-9a-f]:/i.test(a)) return true   // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(a)) return true   // fc00::/7 unique local (ULA)
  if (a.startsWith('::ffff:')) return true          // IPv4-mapped ::ffff:a.b.c.d
  if (a.startsWith('64:ff9b:')) return true         // IPv4/IPv6 translation prefix
  return false
}

/**
 * Assert that the hostname in siteUrl resolves exclusively to public addresses.
 *
 * Throws on: DNS failure, any private IPv4 address, any private IPv6 address.
 * Never returns silently on lookup failure (fail-closed design).
 */
export async function assertPublicHost(siteUrl: string): Promise<void> {
  let hostname: string
  try {
    hostname = new URL(siteUrl).hostname
  } catch {
    throw new Error('Invalid site URL — cannot extract hostname')
  }

  let addresses: dns.LookupAddress[]
  try {
    addresses = await dns.promises.lookup(hostname, { all: true })
  } catch {
    throw new Error(
      `SSRF guard: "${hostname}" could not be resolved — request rejected`,
    )
  }

  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIpv4(address)) {
      throw new Error(
        `SSRF guard: "${hostname}" resolved to private address ${address}`,
      )
    }
    if (family === 6 && isPrivateIpv6(address)) {
      throw new Error(
        `SSRF guard: "${hostname}" resolved to private IPv6 address ${address}`,
      )
    }
  }
}
