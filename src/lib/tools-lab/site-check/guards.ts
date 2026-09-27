// Shared guards for the free website check: limits, the atomic quota, origin check, escaping and URL vetting.
// Visitor identity lives in ./visitor.ts; homepage fetching (via the platform's safe fetch) in ./homepage.ts.

import { supabaseAdmin } from '@/lib/supabase'

export const LIMITS = {
  requestsPerVisitorPerDay: 20, // every check request, before any fetch (reuse and unreadable sites included)
  checkPerVisitorPerDay: 3,     // paid model calls
  checkPerDay: 100,             // paid model calls, whole site: one person cannot drain the month in minutes
  checkPerMonth: 1500,
  reportPerVisitorPerDay: 5,
  reportPerRecipientPerDay: 1,
  reportPerDay: 30,             // emails from our sender, whole site (low until a human check is in front)
  reusePerDay: 300,             // 24h-reuse answers, whole site (each one stores a lead row)
} as const

export const MAX_URL_CHARS = 500
export const MAX_FIELD_CHARS = 200

const ALLOWED_ORIGINS: readonly RegExp[] = [
  /^https:\/\/magicengine\.com\.au$/,
  /^https:\/\/www\.magicengine\.com\.au$/,
  /^https:\/\/[a-z0-9-]+\.magic-engine\.pages\.dev$/,
]

export class QuotaUnavailable extends Error {}

/** Only the official site and its Cloudflare previews may call the paid endpoints. */
export function isAllowedOrigin(origin: string | null): boolean {
  const value = origin ?? ''
  return ALLOWED_ORIGINS.some((re) => re.test(value))
}

export function dayStartUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

export function monthStartUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/**
 * Atomic check-and-consume through the existing database function (zhangqian_rate_limit_consume).
 * Returns true when allowed. Any failure throws QuotaUnavailable: callers refuse rather than allow.
 */
export async function consumeQuota(
  bucketType: string,
  bucketKey: string,
  windowStart: string,
  cap: number,
): Promise<boolean> {
  let data: unknown
  try {
    const res = await supabaseAdmin.rpc('zhangqian_rate_limit_consume', {
      p_bucket_type: bucketType,
      p_bucket_key: bucketKey,
      p_window_start: windowStart,
      p_cap: cap,
    })
    if (res.error) throw new QuotaUnavailable(res.error.message)
    data = res.data
  } catch (err) {
    if (err instanceof QuotaUnavailable) throw err
    throw new QuotaUnavailable(err instanceof Error ? err.message : String(err))
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof (row as { allowed?: unknown }).allowed !== 'boolean') {
    throw new QuotaUnavailable('quota store returned no decision')
  }
  return (row as { allowed: boolean }).allowed
}

/** Best-effort removal of visitor / recipient key rows from before yesterday (privacy: kept at most 2 days). */
export async function pruneOldVisitorKeys(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(Date.parse(dayStartUtc(now)) - 86_400_000).toISOString()
  try {
    await supabaseAdmin
      .from('zhangqian_scan_rate_limits')
      .delete()
      .in('bucket_type', ['site_check_any', 'site_check_ip', 'site_report_ip', 'site_report_to'])
      .lt('window_start', cutoff)
  } catch {
    /* best effort */
  }
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Anything shaped like a domain or address (letters/digits, a dot, a label starting with a letter — any script,
// any suffix: bit.ly, t.me, wa.me, 支付宝.com …). Mail clients auto-link these, so every dot is broken.
const LINKISH = /(?:https?:\/\/)?(?:[\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]*(?:[/?#][^\s<>"']*)?/giu

/** Make links and domains in email text non-clickable (mail clients auto-link bare addresses). */
export function defangLinks(value: unknown): string {
  return String(value ?? '')
    .replace(LINKISH, (m) => m.replace(/\./g, '[.]'))
    // Any remaining scheme (IP or localhost links such as http://45.12.3.4/login) is broken too.
    .replace(/\bhttp(s?):\/\//gi, 'hxxp$1://')
}

/** Registrable-ish site identity: hostname without a leading www. */
export function siteHost(hostname: string): string {
  return String(hostname || '').toLowerCase().replace(/^www\./, '')
}

/** Parse and vet a visitor-supplied address. Returns a URL or null. */
export function vetUrl(input: unknown): URL | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw || raw.length > MAX_URL_CHARS) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.port && url.port !== '80' && url.port !== '443') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  if (
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.startsWith('[') ||
    host.endsWith('.') ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === 'localhost'
  ) {
    return null
  }
  return url
}
