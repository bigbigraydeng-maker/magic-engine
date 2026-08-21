/**
 * Google Search Console (Search Analytics) client.
 *
 * Authentication priority:
 *   1. Per-client OAuth token from google_oauth_tokens (preferred — productised flow)
 *   2. Shared service-account JWT from GOOGLE_SERVICE_ACCOUNT_CREDENTIALS (legacy fallback)
 *
 * Usage (OAuth path — recommended):
 *   The client authorises via /api/auth/google/connect → callback stores tokens.
 *   Pass clientId to fetchGscSearchPerformance and tokens are resolved automatically.
 *
 * Usage (service-account path — internal/legacy):
 *   Set GOOGLE_SERVICE_ACCOUNT_CREDENTIALS env var (JSON string of key file).
 *   Omit clientId or leave google_oauth_tokens empty for that client.
 */

import { createHash, createSign } from 'crypto'
import { getValidAccessToken } from '@/lib/google-oauth/client'
import { getValidToken, PlatformConnectionNotFoundError } from '@/lib/platform-oauth/token-manager'
import type { GscSearchData, GscQueryRow } from '@/lib/zhangqian/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_URL              = 'https://oauth2.googleapis.com/token'
const SERVICE_ACCOUNT_SCOPE  = 'https://www.googleapis.com/auth/webmasters.readonly'
const SEARCH_ANALYTICS_BASE  = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

const DEFAULT_DATE_RANGE_DAYS = 28
const MAX_ROWS                = 25
const SNAPSHOT_ROWS           = 50   // per dimension for snapshots
const PAGE_QUERY_REPORT_ROWS  = 250
const FETCH_TIMEOUT_MS        = 20_000

// ─── Error class ──────────────────────────────────────────────────────────────

export class GscApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly googleStatus: string,
    public readonly googleReason: string,
    message: string,
    public readonly detail: string = '',
  ) {
    super(message)
    this.name = 'GscApiError'
  }
}

function parseGoogleError(rawBody: string): { googleStatus: string; googleReason: string; message: string } {
  try {
    const json = JSON.parse(rawBody) as {
      error?: { status?: string; message?: string; errors?: Array<{ reason?: string }> }
    }
    const err = json.error ?? {}
    return {
      googleStatus: err.status ?? '',
      googleReason: err.errors?.[0]?.reason ?? '',
      message:      err.message ?? rawBody.slice(0, 200),
    }
  } catch {
    return { googleStatus: '', googleReason: '', message: rawBody.slice(0, 200) }
  }
}

// ─── Service-account shape (legacy) ──────────────────────────────────────────

interface ServiceAccount {
  private_key: string
  client_email: string
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch the top search queries for a GSC property over the last 28 days.
 *
 * @param siteUrl   GSC property URL, e.g. "https://example.com.au/"
 * @param clientId  When provided, uses the client's OAuth token (preferred).
 *                  Falls back to the shared service account if no token found.
 */
export async function fetchGscSearchPerformance(
  siteUrl: string,
  clientId?: string,
): Promise<GscSearchData | null> {
  const token = await resolveAccessToken(clientId)
  if (!token) return null

  const endDate   = toIsoDate(new Date())
  const startDate = toIsoDate(daysAgo(DEFAULT_DATE_RANGE_DAYS))

  const body = JSON.stringify({
    startDate,
    endDate,
    dimensions: ['query'],
    rowLimit:   MAX_ROWS,
    orderBy:    [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
  })

  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(
      `${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      console.warn(`[gsc/client] Search Analytics returned ${res.status} for ${siteUrl}`)
      return null
    }

    const data = await res.json() as {
      rows?: Array<{
        keys: string[]
        impressions: number
        clicks: number
        ctr: number
        position: number
      }>
    }

    const rows: GscQueryRow[] = (data.rows ?? []).map(r => ({
      query:       r.keys[0] ?? '',
      impressions: r.impressions,
      clicks:      r.clicks,
      ctr:         r.ctr,
      position:    r.position,
    }))

    return {
      site_url:        siteUrl,
      date_range_days: DEFAULT_DATE_RANGE_DAYS,
      rows,
      fetched_at:      new Date().toISOString(),
    }
  } catch (err) {
    console.warn('[gsc/client] fetch failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Snapshot types (P17.A.1) ─────────────────────────────────────────────────

export interface GscSnapshotRow {
  query?: string
  page?:  string
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}

export interface GscSiteSnapshot {
  site_url:         string
  period_start:     string
  period_end:       string
  total_clicks:     number
  total_impressions: number
  avg_ctr:          number
  avg_position:     number
  top_queries:      GscSnapshotRow[]
  top_pages:        GscSnapshotRow[]
  synced_at:        string
}

/**
 * Pull a full GSC snapshot for a date range (site totals + top queries + top pages).
 * Used by the data pullback sync route (P17.A.1).
 *
 * @param siteUrl      GSC property URL, e.g. "https://example.com.au/"
 * @param clientId     Resolves per-client OAuth token (falls back to service account)
 * @param periodDays   How many days back to cover (default 28)
 */
export async function fetchGscSnapshot(
  siteUrl: string,
  clientId: string,
  periodDays: number = DEFAULT_DATE_RANGE_DAYS,
): Promise<GscSiteSnapshot | null> {
  const token = await resolveAccessToken(clientId)
  if (!token) return null

  const periodEnd   = toIsoDate(new Date())
  const periodStart = toIsoDate(daysAgo(periodDays))

  // GscApiError propagates to caller — null return is reserved for "no token"
  // Fire all three requests in parallel: site-level totals + top queries + top pages.
  // Site-level uses no dimensions → returns true aggregate (fixes P17.A bug where
  // totals were summed from top-50 rows only, under-counting long-tail queries).
  const runQueries = (t: string) => Promise.all([
    querySiteTotals(t, siteUrl, periodStart, periodEnd),
    querySearchAnalytics(t, siteUrl, periodStart, periodEnd, 'query'),
    querySearchAnalytics(t, siteUrl, periodStart, periodEnd, 'page'),
  ])

  let siteTotals, queries, pages
  try {
    ;[siteTotals, queries, pages] = await runQueries(token)
  } catch (err) {
    // Google can invalidate access tokens before their nominal expiry
    // (revocation, rotation, transient anti-abuse). We saw that shape on
    // 06-27 / 06-28 / 06-30 cron runs — cached token, no local expiry, 401.
    // Force a refresh and retry once. Second 401 propagates.
    if (err instanceof GscApiError && err.httpStatus === 401 && clientId) {
      console.warn(`[gsc/client] 401 on cached token for ${clientId} — force-refreshing and retrying once`)
      const fresh = await resolveAccessToken(clientId, { forceRefresh: true })
      if (!fresh) return null
      ;[siteTotals, queries, pages] = await runQueries(fresh)
    } else {
      throw err
    }
  }

  return {
    site_url:          siteUrl,
    period_start:      periodStart,
    period_end:        periodEnd,
    total_clicks:      siteTotals.clicks,
    total_impressions: siteTotals.impressions,
    avg_ctr:           Math.round(siteTotals.ctr * 10000) / 10000,
    avg_position:      Math.round(siteTotals.position * 100) / 100,
    top_queries:       queries.slice(0, SNAPSHOT_ROWS),
    top_pages:         pages.slice(0, SNAPSHOT_ROWS),
    synced_at:         new Date().toISOString(),
  }
}

// ─── Site-level totals (no dimension breakdown) ───────────────────────────────

interface SiteTotals {
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}

/**
 * Fetch true site-level aggregate stats for a date range by calling the
 * Search Analytics API with NO dimensions.  This is the only accurate way
 * to get total_clicks / total_impressions — summing per-query rows misses
 * long-tail queries that fall outside the rowLimit.
 */
async function querySiteTotals(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
): Promise<SiteTotals> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(
      `${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, rowLimit: 1 }),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const rawBody = await res.text()
      const { googleStatus, googleReason, message } = parseGoogleError(rawBody)
      throw new GscApiError(res.status, googleStatus, googleReason, message, rawBody.slice(0, 500))
    }

    const data = await res.json() as {
      rows?: Array<{ clicks: number; impressions: number; ctr: number; position: number }>
    }

    // When no dimensions are set, GSC returns a single row with site-level totals
    const row = data.rows?.[0]
    return {
      clicks:      row?.clicks      ?? 0,
      impressions: row?.impressions ?? 0,
      ctr:         row?.ctr         ?? 0,
      position:    row?.position    ?? 0,
    }
  } catch (err) {
    if (err instanceof GscApiError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[gsc/client] site totals fetch failed:', msg)
    throw new GscApiError(0, 'NETWORK_ERROR', 'networkError', msg)
  } finally {
    clearTimeout(timer)
  }
}

// ─── Per-dimension rows (query / page) ────────────────────────────────────────

async function querySearchAnalytics(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimension: 'query' | 'page',
): Promise<GscSnapshotRow[]> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(
      `${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: [dimension],
          rowLimit:   SNAPSHOT_ROWS,
          orderBy:    [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
        }),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const rawBody = await res.text()
      const { googleStatus, googleReason, message } = parseGoogleError(rawBody)
      console.warn(`[gsc/client] ${dimension} query returned ${res.status} for ${siteUrl}: ${rawBody.slice(0, 200)}`)
      throw new GscApiError(res.status, googleStatus, googleReason, message, rawBody.slice(0, 500))
    }

    const data = await res.json() as {
      rows?: Array<{ keys: string[]; impressions: number; clicks: number; ctr: number; position: number }>
    }

    return (data.rows ?? []).map(r => ({
      [dimension]: r.keys[0] ?? '',
      clicks:      r.clicks,
      impressions: r.impressions,
      ctr:         r.ctr,
      position:    r.position,
    } as GscSnapshotRow))
  } catch (err) {
    if (err instanceof GscApiError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[gsc/client] ${dimension} fetch failed:`, msg)
    throw new GscApiError(0, 'NETWORK_ERROR', 'networkError', msg)
  } finally {
    clearTimeout(timer)
  }
}

// ─── Page × query evidence report (read-only) ───────────────────────────────

export interface GscPageQueryRow {
  page:        string
  query:       string
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}

export interface GscPageQueryEvidenceReceipt {
  readonly evidence_source_id: string
  readonly provider: 'gsc'
  readonly property: string
  readonly start_date: string
  readonly end_date: string
  readonly country: string
  readonly search_type: 'web'
  readonly device: 'all'
  readonly collected_at: string
  readonly page: string
  readonly query: string
  readonly clicks: number
  readonly impressions: number
  readonly ctr: number
  readonly position: number
}

const trustedPageQueryRows = new WeakSet<object>()
const pageQueryRowScopes = new WeakMap<object, Readonly<{
  siteUrl: string
  startDate: string
  endDate: string
  country: string
}>>()
const trustedPageQueryReceipts = new WeakSet<object>()

export interface GscPageQueryReportParams {
  accessToken: string
  siteUrl:     string
  startDate:   string
  endDate:     string
  country:     string
  rowLimit?:   number
}

interface RawPageQueryRow {
  keys?:       unknown
  clicks?:     unknown
  impressions?: unknown
  ctr?:        unknown
  position?:   unknown
}

function validatePageQueryParams(params: GscPageQueryReportParams): number {
  const required = [params.accessToken, params.siteUrl, params.startDate, params.endDate, params.country]
  const requestedRows = params.rowLimit ?? PAGE_QUERY_REPORT_ROWS
  if (required.some(value => !value.trim())) throw invalidReportInput('Missing required input')
  if (!isCalendarDate(params.startDate) || !isCalendarDate(params.endDate)) {
    throw invalidReportInput('Dates must use YYYY-MM-DD')
  }
  if (params.startDate > params.endDate) throw invalidReportInput('startDate must not exceed endDate')
  if (!/^[a-z]{3}$/i.test(params.country)) throw invalidReportInput('country must be ISO alpha-3')
  if (!Number.isInteger(requestedRows) || requestedRows < 1) throw invalidReportInput('rowLimit must be a positive integer')
  return Math.min(requestedRows, PAGE_QUERY_REPORT_ROWS)
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function invalidReportInput(message: string): GscApiError {
  return new GscApiError(0, 'INVALID_ARGUMENT', 'invalidArgument', message)
}

function mapPageQueryRow(value: unknown): GscPageQueryRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GscApiError(0, 'INVALID_RESPONSE', 'invalidResponse', 'Malformed page × query row')
  }
  const row = value as RawPageQueryRow
  const keys = Array.isArray(row.keys) ? row.keys : []
  const metrics = [row.clicks, row.impressions, row.ctr, row.position]
  if (keys.length !== 2 || keys.some(key => typeof key !== 'string' || !key.trim()) ||
      metrics.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new GscApiError(0, 'INVALID_RESPONSE', 'invalidResponse', 'Malformed page × query row')
  }
  if ((row.clicks as number) < 0 || (row.impressions as number) < 0 ||
      (row.ctr as number) < 0 || (row.ctr as number) > 1 || (row.position as number) < 0) {
    throw new GscApiError(0, 'INVALID_RESPONSE', 'invalidResponse', 'Out-of-range page × query metrics')
  }
  const mapped: GscPageQueryRow = Object.freeze({
    page: keys[0] as string,
    query: keys[1] as string,
    clicks: row.clicks as number,
    impressions: row.impressions as number,
    ctr: row.ctr as number,
    position: row.position as number,
  })
  trustedPageQueryRows.add(mapped)
  return mapped
}

function parsePageQueryRows(
  data: unknown,
  scope: Readonly<{ siteUrl: string; startDate: string; endDate: string; country: string }>,
): GscPageQueryRow[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new GscApiError(0, 'INVALID_RESPONSE', 'invalidResponse', 'Malformed GSC response')
  }
  const rows = (data as Record<string, unknown>).rows
  if (rows === undefined) return []
  if (!Array.isArray(rows)) {
    throw new GscApiError(0, 'INVALID_RESPONSE', 'invalidResponse', 'Malformed GSC rows')
  }
  return rows.map((row) => {
    const mapped = mapPageQueryRow(row)
    pageQueryRowScopes.set(mapped, scope)
    return mapped
  })
}

/** Fetch page × query rows for one country without resolving or persisting tokens. */
export async function fetchGscPageQueryReport(
  params: GscPageQueryReportParams,
): Promise<GscPageQueryRow[]> {
  const rowLimit = validatePageQueryParams(params)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: ['page', 'query'],
        type: 'web',
        dimensionFilterGroups: [{ groupType: 'and', filters: [
          { dimension: 'country', operator: 'equals', expression: params.country.toLowerCase() },
        ] }],
        rowLimit,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throwGscResponseError(res, await res.text())
    return parsePageQueryRows(await res.json(), Object.freeze({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      country: params.country.toLowerCase(),
    }))
  } catch (err) {
    if (err instanceof GscApiError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new GscApiError(0, 'NETWORK_ERROR', 'networkError', message)
  } finally {
    clearTimeout(timer)
  }
}

/** Build an immutable receipt only from a row returned by this live client instance. */
export function createGscPageQueryEvidenceReceipt(
  params: Omit<GscPageQueryReportParams, 'accessToken' | 'rowLimit'>,
  row: GscPageQueryRow,
): GscPageQueryEvidenceReceipt {
  const scope = pageQueryRowScopes.get(row)
  if (!trustedPageQueryRows.has(row) || !scope) {
    throw invalidReportInput('Evidence row was not returned by fetchGscPageQueryReport')
  }
  validatePageQueryParams({ ...params, accessToken: 'receipt-builder', rowLimit: 1 })
  if (
    scope.siteUrl !== params.siteUrl ||
    scope.startDate !== params.startDate ||
    scope.endDate !== params.endDate ||
    scope.country !== params.country.toLowerCase()
  ) {
    throw invalidReportInput('Evidence row does not belong to the requested GSC scope')
  }
  const identity = JSON.stringify({
    property: params.siteUrl,
    startDate: params.startDate,
    endDate: params.endDate,
    country: params.country.toLowerCase(),
    row,
  })
  const receipt: GscPageQueryEvidenceReceipt = Object.freeze({
    evidence_source_id: `gsc-page-query:${createHash('sha256').update(identity).digest('hex')}`,
    provider: 'gsc',
    property: params.siteUrl,
    start_date: params.startDate,
    end_date: params.endDate,
    country: params.country.toLowerCase(),
    search_type: 'web',
    device: 'all',
    collected_at: new Date().toISOString(),
    page: row.page,
    query: row.query,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  })
  trustedPageQueryReceipts.add(receipt)
  return receipt
}

export function isGscPageQueryEvidenceReceipt(
  value: unknown,
): value is GscPageQueryEvidenceReceipt {
  return value !== null && typeof value === 'object' && trustedPageQueryReceipts.has(value)
}

function throwGscResponseError(res: Response, rawBody: string): never {
  const { googleStatus, googleReason, message } = parseGoogleError(rawBody)
  throw new GscApiError(res.status, googleStatus, googleReason, message, rawBody.slice(0, 500))
}

// ─── Token resolution ─────────────────────────────────────────────────────────

// Exported for src/lib/gsc/inspect.ts (URL Inspection API shares the same
// connector → OAuth → service-account resolution chain).
export async function resolveAccessToken(
  clientId?: string,
  opts?: { forceRefresh?: boolean },
): Promise<string | null> {
  // 1. New encrypted path (platform_oauth_connections, provider='google_gsc')
  if (clientId) {
    try {
      const token = await getValidToken(clientId, 'google_gsc', opts)
      if (token) return token
    } catch (err) {
      if (!(err instanceof PlatformConnectionNotFoundError)) {
        console.warn('[gsc/client] getValidToken error:', err instanceof Error ? err.message : err)
      }
      // Fall through to legacy path
    }
  }

  // 2. Legacy OAuth token (google_oauth_tokens table) — backward compat
  if (clientId) {
    const oauthToken = await getValidAccessToken(clientId, opts)
    if (oauthToken) return oauthToken
  }

  // 3. Service-account JWT (legacy / internal)
  const creds = loadServiceAccount()
  if (!creds) return null
  return getServiceAccountToken(creds).catch(() => null)
}

// ─── Service-account JWT helpers (legacy) ────────────────────────────────────

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>
    if (!parsed.private_key || !parsed.client_email) return null
    return parsed as ServiceAccount
  } catch {
    return null
  }
}

async function getServiceAccountToken(creds: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600

  const headerB64  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payloadB64 = b64url(
    JSON.stringify({
      iss:   creds.client_email,
      sub:   creds.client_email,
      scope: SERVICE_ACCOUNT_SCOPE,
      aud:   TOKEN_URL,
      iat:   now,
      exp,
    }),
  )

  const toSign = `${headerB64}.${payloadB64}`
  const signer = createSign('RSA-SHA256')
  signer.update(toSign)
  const sig = signer.sign(creds.private_key, 'base64url')
  const jwt = `${toSign}.${sig}`

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })

  if (!res.ok) throw new Error(`Service account token exchange failed: ${res.status}`)
  const json = await res.json() as { access_token?: string }
  if (!json.access_token) throw new Error('No access_token in service account response')
  return json.access_token
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function b64url(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64url')
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
