// Who is calling: a day-scoped, one-way visitor key that a caller cannot choose.
//
// app.magicengine.com.au runs on Render behind Cloudflare. Cloudflare overwrites `cf-connecting-ip` with the real
// client address — but only for requests that actually pass through Cloudflare. Anyone can reach the Render
// origin directly and send their own `cf-connecting-ip` / `x-forwarded-for`, so neither header is trusted on its
// own. We trust `cf-connecting-ip` only when the nearest public hop in `x-forwarded-for` (the one our own proxy
// appended, after skipping private internal hops) is a Cloudflare edge address. Anything else is refused.

import { createHmac } from 'node:crypto'
import ipaddr from 'ipaddr.js'

// https://www.cloudflare.com/ips/ (stable list; update if Cloudflare publishes new ranges).
const CLOUDFLARE_RANGES: ReadonlyArray<string> = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
]

const PARSED_RANGES = CLOUDFLARE_RANGES.map((cidr) => ipaddr.parseCIDR(cidr))

function parseIp(value: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  const v = value.trim()
  if (!ipaddr.isValid(v)) return null
  const addr = ipaddr.parse(v)
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) return (addr as ipaddr.IPv6).toIPv4Address()
  return addr
}

export function isCloudflareAddress(value: string): boolean {
  const addr = parseIp(value)
  if (!addr) return false
  return PARSED_RANGES.some(([range, bits]) => range.kind() === addr.kind() && addr.match(range, bits))
}

function isInternalHop(value: string): boolean {
  const addr = parseIp(value)
  return !!addr && addr.range() !== 'unicast'
}

export interface VisitorAddress {
  ip: string
  source: 'cf-verified'
}

/** The real client address, or null when the request did not provably arrive through Cloudflare. */
export function visitorAddress(headers: Headers): VisitorAddress | null {
  const hops = (headers.get('x-forwarded-for') || '').split(',').map((h) => h.trim()).filter(Boolean)
  let i = hops.length - 1
  while (i >= 0 && isInternalHop(hops[i])) i -= 1
  if (i < 0 || !isCloudflareAddress(hops[i])) return null
  const cf = (headers.get('cf-connecting-ip') || '').trim()
  const addr = parseIp(cf)
  if (!addr) return null
  return { ip: addr.toString(), source: 'cf-verified' }
}

/** Diagnostic for logs only (no raw address): why a request was or was not accepted. */
export function visitorDiagnostic(headers: Headers): string {
  const hops = (headers.get('x-forwarded-for') || '').split(',').map((h) => h.trim()).filter(Boolean)
  const shape = hops.map((h) => (isCloudflareAddress(h) ? 'cf' : isInternalHop(h) ? 'internal' : parseIp(h) ? 'public' : 'junk'))
  return `xff=[${shape.join(',')}] cf_header=${headers.get('cf-connecting-ip') ? 'yes' : 'no'} accepted=${visitorAddress(headers) ? 'yes' : 'no'}`
}

function hmacHex(keyMaterial: string, message: string): string {
  return createHmac('sha256', keyMaterial).update(message).digest('hex')
}

/** IPv4 as is; IPv6 by its /48 (a /48 is what one customer or one free tunnel account typically gets). */
function subjectFor(ip: string): string {
  const addr = ipaddr.parse(ip)
  if (addr.kind() === 'ipv4') return `v4:${addr.toString()}`
  const parts = (addr as ipaddr.IPv6).parts.slice(0, 3).map((p) => p.toString(16).padStart(4, '0'))
  return `v6:${parts.join(':')}`
}

function keySecret(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

/** One-way, day-scoped visitor key. The raw address is never stored. Returns null when no trusted address or no key. */
export function visitorKey(headers: Headers, now: Date = new Date()): string | null {
  const addr = visitorAddress(headers)
  const secret = keySecret()
  if (!addr || !secret) return null
  const material = hmacHex(secret, 'site-check-visitor-key-v1')
  return hmacHex(material, `${now.toISOString().slice(0, 10)}|${subjectFor(addr.ip)}`)
}

/** Same mailbox, same key: lower-case, drop "+tag", and ignore dots for Gmail addresses. */
export function normaliseRecipient(email: string): string {
  const [local = '', domain = ''] = String(email).trim().toLowerCase().split('@')
  let user = local.split('+')[0]
  const host = domain === 'googlemail.com' ? 'gmail.com' : domain
  if (host === 'gmail.com') user = user.replace(/\./g, '')
  return `${user}@${host}`
}

/** One-way, day-scoped key for an email recipient. Returns null when no key is configured. */
export function recipientKey(email: string, now: Date = new Date()): string | null {
  const secret = keySecret()
  if (!secret) return null
  const material = hmacHex(secret, 'site-check-recipient-key-v1')
  return hmacHex(material, `${now.toISOString().slice(0, 10)}|${normaliseRecipient(email)}`)
}
