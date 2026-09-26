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

import { getValidAccessToken } from '@/lib/google-oauth/client'
import { getValidToken, PlatformConnectionNotFoundError } from '@/lib/platform-oauth/token-manager'
import { loadServiceAccount, mintServiceAccountToken } from '@/lib/google-oauth/service-account'
import type { GscSearchData, GscQueryRow } from '@/lib/zhangqian/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_SCOPE  = 'https://www.googleapis.com/auth/webmasters.readonly'
const SEARCH_ANALYTICS_BASE  = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

const DEFAULT_DATE_RANGE_DAYS = 28
const MAX_ROWS                = 25
const SNAPSHOT_ROWS           = 50   // per dimension for snapshots
const FETCH_TIMEOUT_MS        = 20_000
/** Per-page daily pulls fetch up to 25,000 rows per request — give them more time than the 50-row snapshot calls. */
const ROWS_FETCH_TIMEOUT_MS   = 60_000
/** A date-dimension query over at most a few hundred days never needs more rows than this. */
const DAY_RANGE_ROW_LIMIT     = 1000

// ─── Error class ──────────────────────────────────────────────────────────────

export class GscApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly googleStatus: string,
    public readonly googleReason: string,
    message: string,
    public readonly detail: string = '',
    /** Only set for HTTP 429: how long Google asked us to wait (Retry-After), in ms. */
    public readonly retryAfterMs: number | null = null,
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

/**
 * Fetch the queries GSC actually attributes to ONE specific page (not the
 * site-wide top-N list) — live call, `dimensionFilterGroups` filtered to
 * `page`.
 *
 * 事故复盘 2026-09-20（CTS W38 第一次上线）根因之一：候选发现只有一份
 * 站点级 `top_queries`（不区分页面），靠 slug 分词跟这份列表做字符串重叠
 * 匹配来猜"这页该用哪个词"——liziba-station-chongqing-guide 页面没有
 * 自己的高曝光词进入 top_queries，算法退而求其次，抓到了共享 "chongqing"
 * 这一个 token 的、其实属于另一个页面（how-many-days-in-chongqing）的词，
 * 就把这个词当成了 liziba 页面的目标词——标题因此变成一个跟 Liziba
 * 站完全无关的问题句。此函数是修法：直接问谷歌"这一页自己的词是什么"，
 * 不再靠站点级列表做猜测式匹配。
 *
 * @param siteUrl   GSC property URL, e.g. "https://example.com.au/"
 * @param pageUrl   The exact page URL to filter to (GSC matches by exact string).
 * @param clientId  Resolves per-client OAuth token (falls back to service account).
 * @param periodDays How many days back to cover (default 28, same as the site snapshot).
 */
export async function fetchGscQueriesForPage(
  siteUrl: string,
  pageUrl: string,
  clientId: string,
  periodDays: number = DEFAULT_DATE_RANGE_DAYS,
): Promise<GscSnapshotRow[] | null> {
  const token = await resolveAccessToken(clientId)
  if (!token) return null

  const endDate = toIsoDate(new Date())
  const startDate = toIsoDate(daysAgo(periodDays))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(
      `${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ['query'],
          dimensionFilterGroups: [
            { filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] },
          ],
          rowLimit: SNAPSHOT_ROWS,
          orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
        }),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const rawBody = await res.text()
      console.warn(`[gsc/client] page-scoped query fetch returned ${res.status} for ${pageUrl}: ${rawBody.slice(0, 200)}`)
      return null
    }

    const data = await res.json() as {
      rows?: Array<{ keys: string[]; impressions: number; clicks: number; ctr: number; position: number }>
    }
    return (data.rows ?? []).map((r) => ({
      query: r.keys[0] ?? '',
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }))
  } catch (err) {
    console.warn('[gsc/client] page-scoped query fetch failed:', err instanceof Error ? err.message : err)
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
 * Resolve a GSC token for `clientId`, run `fn` with it, and on a 401 force-refresh
 * the token and run `fn` exactly once more.
 *
 * Google can invalidate access tokens before their nominal expiry (revocation,
 * rotation, transient anti-abuse) — seen on the 06-27 / 06-28 / 06-30 cron runs:
 * cached token, no local expiry, 401. A second 401 propagates to the caller.
 *
 * Returns null only when no token can be resolved at all (first try or refresh).
 * Shared by the snapshot pull and the per-page daily pull so both behave the same.
 */
export async function withGscAccess<T>(
  clientId: string,
  fn: (token: string) => Promise<T>,
): Promise<T | null> {
  const token = await resolveAccessToken(clientId)
  if (!token) return null
  try {
    return await fn(token)
  } catch (err) {
    if (err instanceof GscApiError && err.httpStatus === 401 && clientId) {
      console.warn(`[gsc/client] 401 on cached token for ${clientId} — force-refreshing and retrying once`)
      const fresh = await resolveAccessToken(clientId, { forceRefresh: true })
      if (!fresh) return null
      return fn(fresh)
    }
    throw err
  }
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
  const periodEnd   = toIsoDate(new Date())
  const periodStart = toIsoDate(daysAgo(periodDays))

  // GscApiError propagates to caller — null return is reserved for "no token".
  // Fire all three requests in parallel: site-level totals + top queries + top pages.
  // Site-level uses no dimensions → returns true aggregate (fixes P17.A bug where
  // totals were summed from top-50 rows only, under-counting long-tail queries).
  // 401 → force-refresh + retry once lives in withGscAccess (shared with the per-page pull).
  const result = await withGscAccess(clientId, (t) => Promise.all([
    querySiteTotals(t, siteUrl, periodStart, periodEnd),
    querySearchAnalytics(t, siteUrl, periodStart, periodEnd, 'query'),
    querySearchAnalytics(t, siteUrl, periodStart, periodEnd, 'page'),
  ]))
  if (!result) return null
  const [siteTotals, queries, pages] = result

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

// ─── Multi-dimension rows (per-page daily store) ──────────────────────────────

/** One Search Analytics row: `keys` follow the order of the requested dimensions. */
export interface GscAnalyticsRow {
  keys:        string[]
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}

export interface GscRowsQuery {
  startDate:  string
  endDate:    string
  dimensions: readonly string[]
  rowLimit:   number
  startRow?:  number
}

/** First / last day inside a requested range for which Google has finalised data. */
export interface GscDayRange {
  firstDay: string | null
  lastDay:  string | null
}

/**
 * Parse a `Retry-After` header into milliseconds from `now`.
 *
 * Accepts both forms Google may send: a delay in seconds (`"120"`) or an HTTP
 * date (`"Wed, 21 Oct 2026 07:28:00 GMT"`). Returns null when the header is
 * absent, blank, or unparseable.
 */
export function parseRetryAfterMs(header: string | null, now: Date = new Date()): number | null {
  if (header === null) return null
  const value = header.trim()
  if (value === '') return null
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return Math.max(0, parsed - now.getTime())
}

/**
 * Multi-dimension Search Analytics query used by the per-page daily store.
 *
 * Deliberately sends NO `orderBy` (Google ignores it for paging anyway and it is
 * not needed) and NO `dataState` (omitted = finalised data only, which is what we
 * store). The old single-dimension `querySearchAnalytics` is left untouched.
 */
export async function querySearchAnalyticsRows(
  token: string,
  siteUrl: string,
  query: GscRowsQuery,
  timeoutMs: number = ROWS_FETCH_TIMEOUT_MS,
): Promise<GscAnalyticsRow[]> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(
      `${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate:  query.startDate,
          endDate:    query.endDate,
          dimensions: [...query.dimensions],
          rowLimit:   query.rowLimit,
          startRow:   query.startRow ?? 0,
        }),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const rawBody = await res.text()
      const { googleStatus, googleReason, message } = parseGoogleError(rawBody)
      const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res.headers.get('retry-after')) : null
      throw new GscApiError(res.status, googleStatus, googleReason, message, rawBody.slice(0, 500), retryAfterMs)
    }

    const data = await res.json() as {
      rows?: Array<{ keys?: unknown; clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown }>
    }

    return (data.rows ?? []).map((r) => ({
      keys:        Array.isArray(r.keys) ? r.keys.map((k) => String(k)) : [],
      clicks:      Number(r.clicks) || 0,
      impressions: Number(r.impressions) || 0,
      ctr:         Number(r.ctr) || 0,
      position:    Number(r.position) || 0,
    }))
  } catch (err) {
    if (err instanceof GscApiError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[gsc/client] rows fetch failed:', msg)
    throw new GscApiError(0, 'NETWORK_ERROR', 'networkError', msg)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cheap date-only query (no page dimension) that tells which days inside
 * [startDate, endDate] Google already has finalised data for.
 *
 * Per-day page pulls only run for days inside this range, so a not-yet-finalised
 * day is never stored as a partial day.
 */
export async function fetchFinalizedDayRange(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
): Promise<GscDayRange> {
  const rows = await querySearchAnalyticsRows(token, siteUrl, {
    startDate,
    endDate,
    dimensions: ['date'],
    rowLimit:   DAY_RANGE_ROW_LIMIT,
  })

  const days = rows
    .map((r) => r.keys[0])
    .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()

  return {
    firstDay: days[0] ?? null,
    lastDay:  days.length > 0 ? days[days.length - 1] : null,
  }
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

  // 3. Service-account JWT (legacy / internal) —— 铸造逻辑已提取到
  //    lib/google-oauth/service-account.ts，GA4/GSC/Sheets 共用一份。
  const creds = loadServiceAccount()
  if (!creds) return null
  return mintServiceAccountToken(creds, SERVICE_ACCOUNT_SCOPE).catch(() => null)
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
