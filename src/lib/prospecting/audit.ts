/**
 * Prospect rule-based audit orchestrator — Step 2 of the outbound pipeline.
 *
 * Reference: ROADMAP.md Phase 35 (司马徽 outbound prospecting).
 *
 * Cost per prospect: one free homepage fetch + one DataForSEO OnPage
 * instant audit (~$0.003). No AI calls — qualification happens on rules
 * (score.ts) so only high-opportunity prospects reach the paid AI step.
 *
 * Safety: prospect website URLs come from Google Business listings, which
 * anyone can create — treat them as attacker-controlled. Redirects are
 * followed manually with a private-address check on every hop, and this
 * function never throws (a poison URL must not wedge the audit batch).
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { getOnPageInstant, type OnPageResult } from '@/lib/dataforseo/onpage'
import { detectTrackingSignals, type TrackingSignals } from './tracking-detector'

export interface ProspectAudit {
  fetched_at:  string
  final_url:   string | null
  /**
   * true  = https homepage fetched successfully
   * false = definitively unreachable over https (DNS / connection / TLS failure)
   * null  = indeterminate (invalid URL, blocked by WAF, timeout, non-2xx) —
   *         must NOT be scored as "no SSL" (it may be a protected modern site).
   */
  https_ok:    boolean | null
  fetch_error: string | null
  tracking:    TrackingSignals | null
  onpage:      OnPageResult | null
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Exported for tests. Returns null instead of throwing on malformed input. */
export function normaliseUrl(raw: string): string | null {
  let u = raw.trim()
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  try {
    const parsed = new URL(u)
    parsed.protocol = 'https:'
    return parsed.href
  } catch {
    return null
  }
}

// ─── SSRF guard ───────────────────────────────────────────────────────────────

function isPrivateIpV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    (a === 169 && b === 254) ||             // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
}

/** Exported for tests. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpV4(ip)
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (v6 === '::' || v6 === '::1') return true
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9')) return true
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isPrivateIpV4(mapped[1]) : false
}

/** Throws when the URL's host resolves to a private / internal address. */
async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new BlockedAddressError(host)
    return
  }
  const { address } = await lookup(host)
  if (isPrivateIp(address)) throw new BlockedAddressError(host)
}

class BlockedAddressError extends Error {
  constructor(host: string) { super(`blocked private address: ${host}`) }
}

// ─── Homepage fetch ───────────────────────────────────────────────────────────

type FetchOutcome =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; https_ok: false | null; error: string }

/** Error codes that prove the site is down/absent at the network layer. */
const HARD_FAILURE_CODES = /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/

function classifyFetchError(err: unknown): { https_ok: false | null; error: string } {
  if (err instanceof BlockedAddressError) return { https_ok: null, error: 'blocked_private_address' }
  const cause = (err as { cause?: { code?: string } })?.cause
  const code = cause?.code ?? (err as { code?: string })?.code ?? ''
  if (HARD_FAILURE_CODES.test(code)) return { https_ok: false, error: code }
  if ((err as Error)?.name === 'TimeoutError') return { https_ok: null, error: 'timeout' }
  return { https_ok: null, error: code || 'fetch_failed' }
}

async function fetchHomepage(startUrl: string): Promise<FetchOutcome> {
  let url = startUrl
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(url)
      if (!/^https?:$/.test(parsed.protocol)) {
        return { ok: false, https_ok: null, error: 'non_http_redirect' }
      }
      await assertPublicHost(parsed)

      const res = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) return { ok: false, https_ok: null, error: `redirect_without_location_${res.status}` }
        url = new URL(location, url).href
        continue
      }
      if (!res.ok) return { ok: false, https_ok: null, error: `http_${res.status}` }
      return { ok: true, html: await res.text(), finalUrl: res.url || url }
    }
    return { ok: false, https_ok: null, error: 'too_many_redirects' }
  } catch (err) {
    return { ok: false, ...classifyFetchError(err) }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the zero-AI audit for one prospect website. Never throws.
 *
 * @param websiteUrl  URL (or bare domain) from the business listing.
 */
export async function runProspectAudit(websiteUrl: string): Promise<ProspectAudit> {
  const fetched_at = new Date().toISOString()
  const empty = { fetched_at, final_url: null, tracking: null, onpage: null }

  const url = normaliseUrl(websiteUrl)
  if (!url) return { ...empty, https_ok: null, fetch_error: 'invalid_url' }

  const page = await fetchHomepage(url)
  if (!page.ok) {
    // Skip the paid OnPage call for sites we could not reach ourselves.
    return { ...empty, https_ok: page.https_ok, fetch_error: page.error }
  }

  const onpage = await getOnPageInstant(url).catch(() => null)

  return {
    fetched_at,
    final_url:   page.finalUrl,
    https_ok:    true,
    fetch_error: null,
    tracking:    detectTrackingSignals(page.html),
    onpage,
  }
}
