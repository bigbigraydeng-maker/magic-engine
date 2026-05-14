/**
 * ABR / NZBN connector — client.
 *
 * Reference: ROADMAP.md P8.12.S1.1
 *
 * Wraps two official, free government registries behind one unified interface:
 *  - AU: ABR ABN Lookup JSON API   (requires free GUID — env ABR_GUID)
 *  - NZ: NZBN API v5               (requires subscription key — env NZBN_API_KEY)
 *
 * Design mirrors src/lib/semrush/client.ts:
 *  - API credentials retrieved at call time (clear error if missing).
 *  - Low-level fetchers throw on transport/HTTP errors.
 *  - The high-level `verifyBusinessRegistration` wrapper is non-fatal:
 *    it returns null on any failure so discovery is never blocked.
 */

import { validateEnvVar } from '@/lib/validation-utils'
import type {
  BusinessRegistration,
  RegistrationNameMatch,
  RegistrationStatus,
  AbnDetailsRaw,
  AbrNameSearchRaw,
  NzbnEntityRaw,
  NzbnSearchRaw,
} from './types'

const ABR_API_BASE = 'https://abr.business.gov.au/json'
const NZBN_API_BASE = 'https://api.business.govt.nz/services/v5/nzbn/entities'
const REQUEST_TIMEOUT_MS = 10_000

// ─── Credential accessors (call-time, not module-load) ───────────────────────

function getAbrGuid(): string {
  return validateEnvVar('ABR_GUID')
}

function getNzbnApiKey(): string {
  return validateEnvVar('NZBN_API_KEY')
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Strip non-digit characters (ABN/NZBN are passed with spaces by users). */
function normaliseDigits(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** fetch() with an AbortController timeout so a hung registry can't block. */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The ABR JSON endpoints always wrap their payload in a JSONP callback,
 * e.g. `callback({...})`. Extract the inner object regardless of the
 * callback name by slicing between the first `{` and last `}`.
 */
function parseJsonp<T>(text: string): T {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('ABR returned a malformed JSONP response')
  }
  return JSON.parse(text.slice(start, end + 1)) as T
}

/** Map an ABR "AbnStatus" string to our normalised status enum. */
function mapAbnStatus(raw?: string): RegistrationStatus {
  const s = (raw || '').toLowerCase()
  if (s === 'active') return 'active'
  if (s === 'cancelled') return 'cancelled'
  return 'unknown'
}

/** Map an NZBN "entityStatusDescription" string to our normalised enum. */
function mapNzbnStatus(raw?: string): RegistrationStatus {
  const s = (raw || '').toLowerCase()
  if (s.includes('registered')) return 'active'
  if (s.includes('removed') || s.includes('liquidation')) return 'cancelled'
  return 'unknown'
}

/**
 * ABR returns the GST field as a registration date string, or null /
 * "0001-01-01" when the entity is not GST-registered.
 */
function parseAbnGst(gst?: string | null): boolean {
  if (!gst) return false
  const year = parseInt(gst.slice(0, 4), 10)
  return Number.isFinite(year) && year > 1900
}

// ─── AU: ABR ABN Lookup ──────────────────────────────────────────────────────

/**
 * Look up a single ABN and return a normalised registration record.
 * Throws on transport/HTTP errors; returns null when the ABN is unknown.
 */
export async function getAbnDetails(abn: string): Promise<BusinessRegistration | null> {
  const digits = normaliseDigits(abn)
  if (digits.length !== 11) {
    throw new Error(`Invalid ABN: expected 11 digits, got "${abn}"`)
  }

  const params = new URLSearchParams({ abn: digits, guid: getAbrGuid() })
  const res = await fetchWithTimeout(`${ABR_API_BASE}/AbnDetails.aspx?${params}`)
  if (!res.ok) throw new Error(`ABR API error: ${res.status}`)

  const data = parseJsonp<AbnDetailsRaw>(await res.text())
  if (data.Message || !data.Abn) return null

  return {
    country: 'AU',
    identifier: data.Abn,
    identifier_type: 'ABN',
    entity_name: data.EntityName || null,
    entity_type: data.EntityTypeName || null,
    status: mapAbnStatus(data.AbnStatus),
    registered_since: data.AbnStatusEffectiveFrom || null,
    gst_registered: parseAbnGst(data.Gst),
  }
}

/**
 * Fuzzy-search the ABR by business/entity name. Returns ranked matches;
 * the caller fetches full detail for the best match via getAbnDetails.
 */
export async function searchAbnByName(
  name: string,
  state?: string,
): Promise<RegistrationNameMatch[]> {
  const params = new URLSearchParams({ name, guid: getAbrGuid() })
  if (state) params.set('state', state)

  const res = await fetchWithTimeout(`${ABR_API_BASE}/MatchingNames.aspx?${params}`)
  if (!res.ok) throw new Error(`ABR API error: ${res.status}`)

  const data = parseJsonp<AbrNameSearchRaw>(await res.text())
  if (data.Message || !Array.isArray(data.Names)) return []

  return data.Names
    .filter(n => Boolean(n.Abn) && Boolean(n.Name))
    .map(n => ({
      country: 'AU' as const,
      identifier: n.Abn as string,
      identifier_type: 'ABN' as const,
      name: n.Name as string,
      status: mapAbnStatus(n.AbnStatus),
      state: n.State || null,
      score: typeof n.Score === 'number' ? n.Score : null,
    }))
}

// ─── NZ: NZBN API ────────────────────────────────────────────────────────────

function nzbnHeaders(): HeadersInit {
  return {
    'Ocp-Apim-Subscription-Key': getNzbnApiKey(),
    Accept: 'application/json',
  }
}

function mapNzbnEntity(e: NzbnEntityRaw): BusinessRegistration | null {
  if (!e.nzbn) return null
  return {
    country: 'NZ',
    identifier: e.nzbn,
    identifier_type: 'NZBN',
    entity_name: e.entityName || null,
    entity_type: e.entityTypeDescription || null,
    status: mapNzbnStatus(e.entityStatusDescription),
    registered_since: e.registrationDate || null,
    // NZBN core entity endpoint does not expose GST status.
    gst_registered: null,
  }
}

/**
 * Look up a single NZBN and return a normalised registration record.
 * Throws on transport/HTTP errors; returns null when the NZBN is unknown.
 */
export async function getNzbnEntity(nzbn: string): Promise<BusinessRegistration | null> {
  const digits = normaliseDigits(nzbn)
  if (digits.length !== 13) {
    throw new Error(`Invalid NZBN: expected 13 digits, got "${nzbn}"`)
  }

  const res = await fetchWithTimeout(`${NZBN_API_BASE}/${digits}`, {
    headers: nzbnHeaders(),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`NZBN API error: ${res.status}`)

  return mapNzbnEntity((await res.json()) as NzbnEntityRaw)
}

/** Fuzzy-search the NZBN registry by entity name. */
export async function searchNzbnByName(name: string): Promise<RegistrationNameMatch[]> {
  const params = new URLSearchParams({ 'search-term': name, 'page-size': '10' })
  const res = await fetchWithTimeout(`${NZBN_API_BASE}?${params}`, {
    headers: nzbnHeaders(),
  })
  if (!res.ok) throw new Error(`NZBN API error: ${res.status}`)

  const data = (await res.json()) as NzbnSearchRaw
  if (!Array.isArray(data.items)) return []

  return data.items
    .filter(e => Boolean(e.nzbn) && Boolean(e.entityName))
    .map(e => ({
      country: 'NZ' as const,
      identifier: e.nzbn as string,
      identifier_type: 'NZBN' as const,
      name: e.entityName as string,
      status: mapNzbnStatus(e.entityStatusDescription),
      state: null,
      score: null,
    }))
}

// ─── High-level wrapper (non-fatal — used by the Zhangqian agent) ────────────

export interface VerifyRegistrationOptions {
  /** ABN/NZBN digits, OR a business/entity name to fuzzy-search. */
  query: string
  /** Target registry. Determines which government API is called. */
  market: 'AU' | 'NZ'
  /** Optional AU state code to narrow a name search (ignored for NZ). */
  state?: string
}

/**
 * Verify a business against the official registry for its market.
 *
 * Accepts either an exact identifier (ABN/NZBN) or a business name. On a
 * name query, the best-scoring match is resolved to a full detail record.
 *
 * Non-fatal by contract: any failure (missing credential, network error,
 * no match) resolves to null so brand discovery is never blocked.
 */
export async function verifyBusinessRegistration(
  opts: VerifyRegistrationOptions,
): Promise<BusinessRegistration | null> {
  const digits = normaliseDigits(opts.query)
  try {
    if (opts.market === 'AU') {
      if (digits.length === 11) return await getAbnDetails(digits)
      const matches = await searchAbnByName(opts.query, opts.state)
      const best = pickBestMatch(matches)
      return best ? await getAbnDetails(best.identifier) : null
    }

    // NZ
    if (digits.length === 13) return await getNzbnEntity(digits)
    const matches = await searchNzbnByName(opts.query)
    const best = pickBestMatch(matches)
    return best ? await getNzbnEntity(best.identifier) : null
  } catch (err) {
    console.error('[abr] verifyBusinessRegistration failed', err)
    return null
  }
}

/** Prefer the highest-scoring active match; fall back to the first match. */
function pickBestMatch(
  matches: RegistrationNameMatch[],
): RegistrationNameMatch | null {
  if (matches.length === 0) return null
  const active = matches.filter(m => m.status === 'active')
  const pool = active.length > 0 ? active : matches
  return pool.reduce((best, m) =>
    (m.score ?? 0) > (best.score ?? 0) ? m : best,
  )
}
