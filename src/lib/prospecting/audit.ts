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
 * anyone can create — treat them as attacker-controlled. Fetches use the
 * shared connection-bound SSRF primitive and this function never throws.
 */

import { getOnPageInstant, type OnPageResult } from '@/lib/dataforseo/onpage'
import {
  isPublicIpAddress,
  safeFetchText,
  SafeFetchError,
} from '@/lib/security/safe-fetch'
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
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
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

/** Backward-compatible export; all non-public and malformed addresses are blocked. */
export function isPrivateIp(ip: string): boolean {
  return !isPublicIpAddress(ip)
}

type FetchOutcome =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; https_ok: false | null; error: string }

/** Error codes that prove the site is down/absent at the network layer. */
const HARD_FAILURE_CODES = /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/

function nestedErrorCode(error: SafeFetchError): string {
  return (error.cause as { code?: string } | undefined)?.code ?? ''
}

function classifyFetchError(err: unknown): { https_ok: false | null; error: string } {
  const safeError = err as SafeFetchError | undefined
  if (safeError?.name !== 'SafeFetchError') return { https_ok: null, error: 'fetch_failed' }
  if (safeError.code === 'blocked_address') return { https_ok: null, error: 'blocked_private_address' }
  if (safeError.code === 'unsupported_scheme') return { https_ok: null, error: 'non_http_redirect' }
  if (safeError.code === 'redirect_without_location') {
    return { https_ok: null, error: `redirect_without_location_${safeError.status}` }
  }
  if (safeError.code === 'too_many_redirects') return { https_ok: null, error: 'too_many_redirects' }
  if (safeError.code === 'timeout') return { https_ok: null, error: 'timeout' }
  const code = nestedErrorCode(safeError)
  if (HARD_FAILURE_CODES.test(code)) return { https_ok: false, error: code }
  return { https_ok: null, error: code || 'fetch_failed' }
}

async function fetchHomepage(startUrl: string): Promise<FetchOutcome> {
  try {
    const result = await safeFetchText(startUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      timeoutMs: FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      maxRedirects: MAX_REDIRECTS,
    })
    if (!result.ok) return { ok: false, https_ok: null, error: `http_${result.status}` }
    return { ok: true, html: result.text, finalUrl: result.finalUrl }
  } catch (error) {
    return { ok: false, ...classifyFetchError(error) }
  }
}

// Small businesses that don't put an email on the homepage almost always list
// one on a contact page. Tried only when the homepage yielded no email.
const CONTACT_PATHS = ['/contact', '/contact-us', '/contact-us.html', '/about', '/about-us', '/get-a-quote', '/enquiry', '/quote']

/** Fetch common contact pages until one yields a real email address. */
async function scrapeContactEmails(finalUrl: string): Promise<string[]> {
  let origin: string
  try { origin = new URL(finalUrl).origin } catch { return [] }
  for (const path of CONTACT_PATHS) {
    const page = await fetchHomepage(`${origin}${path}`)
    if (!page.ok) continue
    const emails = detectTrackingSignals(page.html).emails
    if (emails.length > 0) return emails
  }
  return []
}

/**
 * Standalone email discovery for a business site (homepage → contact pages).
 * Reused by the P35.11 re-scan batch. Never throws.
 */
export async function discoverContactEmail(websiteUrl: string): Promise<string[]> {
  const url = normaliseUrl(websiteUrl)
  if (!url) return []
  const page = await fetchHomepage(url)
  if (!page.ok) return []
  const homepage = detectTrackingSignals(page.html).emails
  if (homepage.length > 0) return homepage
  return scrapeContactEmails(page.finalUrl)
}

/** Run the zero-AI audit for one prospect website. Never throws. */
export async function runProspectAudit(websiteUrl: string): Promise<ProspectAudit> {
  const fetched_at = new Date().toISOString()
  const empty = { fetched_at, final_url: null, tracking: null, onpage: null }

  const url = normaliseUrl(websiteUrl)
  if (!url) return { ...empty, https_ok: null, fetch_error: 'invalid_url' }

  const page = await fetchHomepage(url)
  if (!page.ok) {
    return { ...empty, https_ok: page.https_ok, fetch_error: page.error }
  }

  const tracking = detectTrackingSignals(page.html)
  if (tracking.emails.length === 0) {
    const contactEmails = await scrapeContactEmails(page.finalUrl)
    if (contactEmails.length > 0) tracking.emails = contactEmails
  }

  const onpage = await getOnPageInstant(url).catch(() => null)
  return {
    fetched_at,
    final_url: page.finalUrl,
    https_ok: true,
    fetch_error: null,
    tracking,
    onpage,
  }
}
