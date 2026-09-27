// Server-side guards for the free website check (ported from the retired website function, 2026-09-27).
// Same limits, same visitor-key scheme, same homepage vetting — plus an SSRF guard
// (resolve every hop, refuse private/loopback/link-local addresses) and the shared
// anti-bot detector. No route handlers here; this is a library module.

import { createHmac } from 'node:crypto'
import { lookup } from 'dns/promises'
import { supabaseAdmin } from '@/lib/supabase'
import { isBlockedAddress } from '@/lib/factory/safe-remote-fetch'
import { detectAntibotChallenge } from '@/lib/site-audit/antibot-detector'

export const LIMITS = {
  requestsPerVisitorPerDay: 20, // every check request, before any fetch (reuse and unreadable sites included)
  checkPerVisitorPerDay: 3,     // paid model calls
  checkPerDay: 100,             // paid model calls, whole site: one person cannot drain the month in minutes
  checkPerMonth: 1500,
  reportPerVisitorPerDay: 5,
  reportPerRecipientPerDay: 1,
  reportPerDay: 100,            // emails from our sender, whole site
} as const

export const MAX_URL_CHARS = 500
export const MAX_FIELD_CHARS = 200
export const MAX_PAGE_BYTES = 1_000_000
export const MAX_REDIRECTS = 3
export const MIN_TEXT_CHARS = 300

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

export interface VisitorAddress {
  ip: string
  source: 'cf' | 'xff'
}

/** Cloudflare's own client address first; otherwise the first x-forwarded-for hop. */
export function visitorAddress(headers: Headers): VisitorAddress | null {
  const cf = (headers.get('cf-connecting-ip') || '').trim()
  if (cf) return { ip: cf, source: 'cf' }
  const xff = (headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || ''
  if (xff) return { ip: xff, source: 'xff' }
  return null
}

function ipv6Prefix64(ip: string): string {
  const parts = ip.split('::')
  const head = parts[0] ? parts[0].split(':') : []
  const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : []
  const full = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail]
  return full.slice(0, 4).map((h) => h.toLowerCase().padStart(4, '0')).join(':')
}

function hmacHex(keyMaterial: string, message: string): string {
  return createHmac('sha256', keyMaterial).update(message).digest('hex')
}

function subjectFor(ip: string): string {
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (mapped) return `v4:${mapped[1]}`
  return ip.includes(':') ? `v6:${ipv6Prefix64(ip)}` : `v4:${ip}`
}

/**
 * One-way, day-scoped visitor key from Cloudflare's own client address (visitors cannot set it).
 * IPv6 is keyed by its /64. The raw address is never stored. Returns null when no address or no key.
 */
export function visitorKey(headers: Headers, now: Date = new Date()): string | null {
  const addr = visitorAddress(headers)
  if (!addr) return null
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) return null
  const material = hmacHex(secret, 'site-check-visitor-key-v1')
  return hmacHex(material, `${dayStartUtc(now).slice(0, 10)}|${subjectFor(addr.ip)}`)
}

/** One-way, day-scoped key for an email recipient (per-recipient send cap without storing the address twice). */
export function recipientKey(email: string, now: Date = new Date()): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const material = hmacHex(secret, 'site-check-recipient-key-v1')
  return hmacHex(material, `${dayStartUtc(now).slice(0, 10)}|${String(email).trim().toLowerCase()}`)
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

const LINKISH = /\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|io|co|xyz|top|site|online|shop|app|au|nz|cn|uk|us)\b[^\s<>"']*)/gi

/** Make links and domains in email text non-clickable (mail clients auto-link bare addresses). */
export function defangLinks(value: unknown): string {
  return String(value ?? '').replace(LINKISH, (m) => m.replace(/^http/i, 'hxxp').replace(/\./g, '[.]'))
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
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'localhost'
  ) {
    return null
  }
  return url
}

const TITLE_CHALLENGE = [/robot\s+challenge\s+screen/i, /siteground.{0,20}security/i, /just\s+a\s+moment\.\.\./i, /wordfence/i, /sucuri.{0,40}firewall/i]
const TITLE_GENERIC = [/^attention\s+required/i, /access\s+denied/i, /security\s+check/i]
const BODY_CHALLENGE = [/sg[-_]?captcha/i, /\bsgs[-_]?block\b/i, /checking\s+the\s+site\s+connection\s+security/i, /cf[-_]chl[-_](?:jschl|opt)/i, /enable\s+javascript\s+and\s+cookies\s+to\s+continue/i, /generated\s+by\s+wordfence/i, /sucuri\s+website\s+firewall/i]

/** Mirrors src/lib/site-audit/antibot-detector.ts: firewall / challenge pages are not the site. */
export function looksLikeChallenge(title: string, text: string, rawHtml: string): boolean {
  const t = String(title || '').trim()
  if (TITLE_CHALLENGE.some((re) => re.test(t))) return true
  if (TITLE_GENERIC.some((re) => re.test(t)) && String(text || '').trim().length <= 200) return true
  const scan = String(rawHtml || '').slice(0, 8192)
  return BODY_CHALLENGE.some((re) => re.test(scan))
}

export function extractTitle(html: string): string {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

export function extractText(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  try { await reader.cancel() } catch { /* ignore */ }
  const all = new Uint8Array(Math.min(size, MAX_PAGE_BYTES))
  let offset = 0
  for (const c of chunks) {
    const take = Math.min(c.byteLength, all.length - offset)
    all.set(c.subarray(0, take), offset)
    offset += take
    if (offset >= all.length) break
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all)
}

export type HomepageFailureReason =
  | 'invalid_url'
  | 'blocked_address'
  | 'unreachable'
  | 'not_html'
  | 'encoding'
  | 'challenge'
  | 'too_little_text'
  | 'redirected_away'

export type HomepageResult =
  | { ok: true; text: string; title: string; finalUrl: string }
  | { ok: false; reason: HomepageFailureReason }

export interface FetchHomepageOptions {
  fetchImpl?: typeof fetch
  lookupImpl?: (host: string) => Promise<Array<{ address: string }>>
  timeoutMs?: number
}

const defaultLookup = (host: string): Promise<Array<{ address: string }>> => lookup(host, { all: true })

/** Resolve the host and refuse private / loopback / link-local / reserved addresses. */
async function hostIsBlocked(host: string, lookupImpl: (h: string) => Promise<Array<{ address: string }>>): Promise<boolean> {
  let addrs: Array<{ address: string }>
  try {
    addrs = await lookupImpl(host)
  } catch {
    return true
  }
  if (!addrs || addrs.length === 0) return true
  return addrs.some((a) => isBlockedAddress(a.address))
}

/** Follow one manual redirect hop. Returns the next URL, or a failure reason. */
async function nextHop(
  res: Response,
  url: URL,
  startHost: string,
): Promise<{ url: URL } | { reason: HomepageFailureReason }> {
  const next = res.headers.get('location')
  const nextUrl = next ? vetUrl(new URL(next, url).toString()) : null
  if (!nextUrl) return { reason: 'unreachable' }
  if (siteHost(nextUrl.hostname) !== startHost) return { reason: 'redirected_away' }
  return { url: nextUrl }
}

/**
 * Fetch the homepage only if it is a real, readable page of the same site.
 * Homepage only (origin + '/'), manual redirects (max 3), same-site only, 2xx, HTML,
 * UTF-8, at least MIN_TEXT_CHARS of text, and not an anti-bot challenge page.
 * Every hop is resolved and refused if it points at a private address.
 */
export async function fetchRealHomepage(
  input: string,
  opts: FetchHomepageOptions = {},
): Promise<HomepageResult> {
  const { fetchImpl = fetch, lookupImpl = defaultLookup, timeoutMs = 12000 } = opts
  const given = vetUrl(input)
  if (!given) return { ok: false, reason: 'invalid_url' }
  // Homepage only: a path or query could point at a page whose text the visitor controls.
  let url = new URL(`${given.origin}/`)
  const startHost = siteHost(url.hostname)
  let res: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (await hostIsBlocked(url.hostname, lookupImpl)) return { ok: false, reason: 'blocked_address' }
    try {
      res = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'MagicEngineSiteCheck/1.0 (+https://magicengine.com.au/cn/lab/)', Accept: 'text/html' },
      })
    } catch {
      return { ok: false, reason: 'unreachable' }
    }
    if (res.status >= 300 && res.status < 400) {
      const step = await nextHop(res, url, startHost)
      if ('reason' in step) return { ok: false, reason: step.reason }
      url = step.url
      continue
    }
    break
  }
  if (!res || res.status < 200 || res.status >= 300) return { ok: false, reason: 'unreachable' }
  const type = res.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) return { ok: false, reason: 'not_html' }
  const declared = (type.match(/charset=([^;]+)/i) || [])[1]
  if (declared && !/^\s*utf-?8\s*$/i.test(declared)) return { ok: false, reason: 'encoding' }
  let html: string
  try {
    html = await readCapped(res)
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (/<meta[^>]+charset=["']?\s*(gb2312|gbk|gb18030|big5|shift_jis|euc-[a-z]+|iso-8859-\d+|windows-\d+)/i.test(html.slice(0, 4096))) {
    return { ok: false, reason: 'encoding' }
  }
  const title = extractTitle(html)
  const text = extractText(html)
  if (looksLikeChallenge(title, text, html)) return { ok: false, reason: 'challenge' }
  // Too little text first: the shared detector also flags "no title + very short body", which for a JS-only
  // shell would wrongly tell the visitor they were shown a security check.
  if (text.length < MIN_TEXT_CHARS) return { ok: false, reason: 'too_little_text' }
  if (detectAntibotChallenge(text, title) !== null) return { ok: false, reason: 'challenge' }
  return { ok: true, text: text.slice(0, 8000), title, finalUrl: url.toString() }
}

/** Test helper: the address that will actually be fetched for a visitor-supplied URL. */
export function homepageOf(input: string): string | null {
  const given = vetUrl(input)
  return given ? `${given.origin}/` : null
}
