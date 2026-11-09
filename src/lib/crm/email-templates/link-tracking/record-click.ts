/**
 * One click reported by a client's own website (design 2026-11-10 B2 §4.4–4.5).
 *
 * The request comes from a public, unauthenticated endpoint: everything in it is untrusted. The token is the only
 * credential (12 random letters/digits, only in the mail). Times are ME's own (the token's creation, ME's clock),
 * never a time the caller sends.
 */

import { TOKEN_RE } from './tag-links'
import type { LinkKind } from './tag-links-prod'
import type { TourLinkRef } from '../facts/published-tours'

export const MAX_CLICKS_PER_TOKEN = 50
export const DEDUPE_MS = 5 * 60_000
export const SCAN_WINDOW_MS = 60_000
export const HUMAN_AFTER_MS = 10 * 60_000

// Mail-security link checkers and preview fetchers seen in the wild. Matched case-insensitively against the user agent.
const SCANNER_MARKS = [
  'bot', 'crawler', 'spider', 'preview', 'safelinks', 'microsoft office', 'ms-office', 'barracuda', 'mimecast',
  'proofpoint', 'urldefense', 'fireeye', 'trendmicro', 'sophos', 'symantec', 'forcepoint', 'googleimageproxy',
  'ggpht', 'yahoomailproxy', 'curl', 'wget', 'python-requests', 'go-http-client', 'java/', 'okhttp', 'headless',
]

export interface ClickReport {
  token: string
  /** Path plus at most the `date` parameter. */
  path: string | null
  method: 'GET' | 'HEAD'
  ua: string
  fetchSite: string | null
  fetchMode: string | null
  fetchDest: string | null
}

export type ParsedReport = { ok: true; report: ClickReport } | { ok: false }

function shortString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

/** Keep the path and a `date=YYYY-MM-DD` parameter only; anything else in the address is dropped. */
export function cleanPath(raw: string | null): string | null {
  if (raw === null || !raw.startsWith('/')) return null
  let url: URL
  try {
    url = new URL(raw, 'https://site.invalid')
  } catch {
    return null
  }
  const date = url.searchParams.get('date')
  const keep = date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''
  return `${url.pathname}${keep}`.slice(0, 300)
}

export function parseClickReport(body: Record<string, unknown> | null): ParsedReport {
  if (body === null || typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) return { ok: false }
  const method = body.method === 'HEAD' ? 'HEAD' : body.method === 'GET' ? 'GET' : null
  if (method === null) return { ok: false }
  return {
    ok: true,
    report: {
      token: body.token,
      path: cleanPath(shortString(body.path, 1000)),
      method,
      ua: shortString(body.ua, 400) ?? '',
      fetchSite: shortString(body.fetchSite, 20),
      fetchMode: shortString(body.fetchMode, 20),
      fetchDest: shortString(body.fetchDest, 20),
    },
  }
}

export function uaClass(ua: string): 'browser' | 'scanner' | 'unknown' {
  const lower = ua.toLowerCase()
  if (lower === '') return 'unknown'
  if (SCANNER_MARKS.some((mark) => lower.includes(mark))) return 'scanner'
  return /mozilla\/5\.0/.test(lower) ? 'browser' : 'unknown'
}

export interface ClickVerdict {
  uaClass: 'browser' | 'scanner' | 'unknown'
  suspectedScan: boolean
  countsAsHuman: boolean
}

/** §4.5: flag anything that does not look like a person opening the link, and only count a person after 10 minutes. */
export function judgeClick(report: ClickReport, ageMs: number): ClickVerdict {
  const cls = uaClass(report.ua)
  const navigation = report.fetchMode === 'navigate' && report.fetchDest === 'document'
  const notUserNavigation = report.fetchMode !== null && report.fetchMode !== 'navigate'
  const suspectedScan = report.method === 'HEAD' || cls !== 'browser' || notUserNavigation || ageMs < SCAN_WINDOW_MS
  return { uaClass: cls, suspectedScan, countsAsHuman: !suspectedScan && navigation && ageMs >= HUMAN_AFTER_MS }
}

export interface TokenInfo {
  token: string
  clientId: string
  contactId: string
  requestId: string
  kind: LinkKind
  tour: TourLinkRef | null
  createdAt: string
}

export interface ClickRow {
  token: string
  client_id: string
  contact_id: string
  path: string | null
  method: 'GET' | 'HEAD'
  ua_class: 'browser' | 'scanner' | 'unknown'
  suspected_scan: boolean
  counts_as_human: boolean
}

export interface ClickStore {
  findToken(token: string): Promise<TokenInfo | null>
  /** True only when the mail this token was given to is recorded as sent (not failed, not still unknown). */
  mailWasSent(info: TokenInfo): Promise<boolean>
  /** How many clicks the token has, and when the latest click that was NOT a suspected scan was recorded (ISO) or null. */
  clickStats(token: string): Promise<{ count: number; lastAt: string | null; hasHuman: boolean }>
  insertClick(row: ClickRow): Promise<void>
  emitFirstHumanClick(info: TokenInfo, clickedAt: string): Promise<void>
}

export type RecordOutcome = 'recorded' | 'ignored'

export async function recordClick(report: ClickReport, store: ClickStore, now: Date): Promise<RecordOutcome> {
  const info = await store.findToken(report.token)
  if (info === null || !(await store.mailWasSent(info))) return 'ignored'
  const stats = await store.clickStats(report.token)
  if (stats.count >= MAX_CLICKS_PER_TOKEN) return 'ignored'
  if (stats.lastAt !== null && now.getTime() - Date.parse(stats.lastAt) < DEDUPE_MS) return 'ignored'
  const verdict = judgeClick(report, now.getTime() - Date.parse(info.createdAt))
  await store.insertClick({
    token: report.token,
    client_id: info.clientId,
    contact_id: info.contactId,
    path: report.path,
    method: report.method,
    ua_class: verdict.uaClass,
    suspected_scan: verdict.suspectedScan,
    counts_as_human: verdict.countsAsHuman,
  })
  if (verdict.countsAsHuman && !stats.hasHuman) await store.emitFirstHumanClick(info, now.toISOString())
  return 'recorded'
}

/** A whole-endpoint cap per minute for one server process: true = over the cap, refuse. */
export function createMinuteCap(maxPerMinute: number): (nowMs: number) => boolean {
  let windowStart = 0
  let count = 0
  return (nowMs) => {
    if (nowMs - windowStart >= 60_000) {
      windowStart = nowMs
      count = 0
    }
    count += 1
    return count > maxPerMinute
  }
}
