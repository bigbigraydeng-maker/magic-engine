/**
 * Google Analytics 4 — Data API v1beta client.
 *
 * Fetches traffic snapshots via the GA4 Data API.
 * Auth: per-client OAuth token from google_oauth_tokens (must have analytics.readonly scope).
 *
 * Usage (P17.A.2):
 *   const snapshot = await fetchGa4Snapshot(propertyId, clientId)
 *   // propertyId: 'properties/123456789' or bare '123456789'
 *
 * Reference: https://developers.google.com/analytics/devguides/reporting/data/v1
 */

import { getValidAccessToken } from '@/lib/google-oauth/client'

// ─── Constants ────────────────────────────────────────────────────────────────

const GA4_DATA_API      = 'https://analyticsdata.googleapis.com/v1beta'
const FETCH_TIMEOUT_MS  = 20_000
const SNAPSHOT_ROWS     = 50
const DEFAULT_PERIOD_DAYS = 28

// ─── Error class ──────────────────────────────────────────────────────────────

export class Ga4ApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly googleStatus: string,
    public readonly googleReason: string,
    message: string,
    public readonly detail: string = '',
  ) {
    super(message)
    this.name = 'Ga4ApiError'
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Ga4PageRow {
  page:      string
  pageviews: number
  sessions:  number
}

export interface Ga4SourceRow {
  source:      string
  medium:      string
  sessions:    number
  conversions: number
}

export interface Ga4SiteSnapshot {
  property_id:          string
  period_start:         string
  period_end:           string
  total_sessions:       number
  total_users:          number
  total_new_users:      number
  total_pageviews:      number
  avg_session_duration: number
  bounce_rate:          number
  top_pages:            Ga4PageRow[]
  top_sources:          Ga4SourceRow[]
  synced_at:            string
}

// ─── Internal GA4 API shapes ─────────────────────────────────────────────────

interface Ga4DimensionValue { value: string }
interface Ga4MetricValue    { value: string }
interface Ga4Row {
  dimensionValues?: Ga4DimensionValue[]
  metricValues?:   Ga4MetricValue[]
}
interface Ga4ReportResponse {
  rows?:     Ga4Row[]
  rowCount?: number
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pull a full GA4 snapshot: site-level totals + top pages + top traffic sources.
 *
 * @param propertyId  GA4 property — bare numeric '123456789' or prefixed 'properties/123456789'
 * @param clientId    Used to look up the client's OAuth token
 * @param periodDays  Days back to cover (default 28, max 90)
 */
export async function fetchGa4Snapshot(
  propertyId: string,
  clientId: string,
  periodDays: number = DEFAULT_PERIOD_DAYS,
): Promise<Ga4SiteSnapshot | null> {
  const token = await getValidAccessToken(clientId)
  if (!token) return null

  const normalized  = normalizePropertyId(propertyId)
  const periodEnd   = toIsoDate(new Date())
  const periodStart = toIsoDate(daysAgo(periodDays))

  const runReports = (t: string) => Promise.all([
    runReport(t, normalized, periodStart, periodEnd, {
      metrics: ['sessions', 'totalUsers', 'newUsers', 'screenPageViews',
                'averageSessionDuration', 'bounceRate'],
    }),
    runReport(t, normalized, periodStart, periodEnd, {
      dimensions: ['pagePath'],
      metrics:    ['screenPageViews', 'sessions'],
      orderBy:    'screenPageViews',
      limit:      SNAPSHOT_ROWS,
    }),
    runReport(t, normalized, periodStart, periodEnd, {
      dimensions: ['sessionSource', 'sessionMedium'],
      metrics:    ['sessions', 'keyEvents'],
      orderBy:    'sessions',
      limit:      SNAPSHOT_ROWS,
    }),
  ])

  let totals, topPages, topSources
  try {
    ;[totals, topPages, topSources] = await runReports(token)
  } catch (err) {
    // See gsc/client.ts fetchGscSnapshot for the same defensive retry —
    // Google can invalidate access tokens before their nominal expiry
    // (06-27/06-28/06-30 cron runs). Force-refresh and try once more.
    if (err instanceof Ga4ApiError && err.httpStatus === 401) {
      console.warn(`[ga4/client] 401 on cached token for ${clientId} — force-refreshing and retrying once`)
      const fresh = await getValidAccessToken(clientId, { forceRefresh: true })
      if (!fresh) return null
      ;[totals, topPages, topSources] = await runReports(fresh)
    } else {
      throw err
    }
  }

  const mv = totals.rows?.[0]?.metricValues ?? []

  return {
    property_id:          propertyId,
    period_start:         periodStart,
    period_end:           periodEnd,
    total_sessions:       parseInt(mv[0]?.value ?? '0', 10),
    total_users:          parseInt(mv[1]?.value ?? '0', 10),
    total_new_users:      parseInt(mv[2]?.value ?? '0', 10),
    total_pageviews:      parseInt(mv[3]?.value ?? '0', 10),
    avg_session_duration: Math.round(parseFloat(mv[4]?.value ?? '0') * 100) / 100,
    bounce_rate:          Math.round(parseFloat(mv[5]?.value ?? '0') * 10000) / 10000,
    top_pages: (topPages.rows ?? []).map(r => ({
      page:      r.dimensionValues?.[0]?.value ?? '',
      pageviews: parseInt(r.metricValues?.[0]?.value ?? '0', 10),
      sessions:  parseInt(r.metricValues?.[1]?.value ?? '0', 10),
    })),
    top_sources: (topSources.rows ?? []).map(r => ({
      source:      r.dimensionValues?.[0]?.value ?? '',
      medium:      r.dimensionValues?.[1]?.value ?? '',
      sessions:    parseInt(r.metricValues?.[0]?.value ?? '0', 10),
      conversions: parseInt(r.metricValues?.[1]?.value ?? '0', 10),
    })),
    synced_at: new Date().toISOString(),
  }
}

// ─── Public API (paid search) ─────────────────────────────────────────────────

export interface Ga4PaidSearchMetrics {
  paid_sessions:    number
  paid_users:       number
  paid_conversions: number
  period_start:     string
  period_end:       string
}

/**
 * Pull Paid Search totals from GA4 by filtering on sessionDefaultChannelGroup.
 * Uses the same OAuth token as fetchGa4Snapshot — no extra scope required.
 */
export async function fetchGa4PaidSearchMetrics(
  propertyId: string,
  clientId: string,
  periodDays: number = DEFAULT_PERIOD_DAYS,
): Promise<Ga4PaidSearchMetrics | null> {
  const token = await getValidAccessToken(clientId)
  if (!token) return null

  const normalized  = normalizePropertyId(propertyId)
  const periodEnd   = toIsoDate(new Date())
  const periodStart = toIsoDate(daysAgo(periodDays))

  const result = await runReport(token, normalized, periodStart, periodEnd, {
    metrics:         ['sessions', 'totalUsers', 'keyEvents'],
    dimensionFilter: {
      filter: {
        fieldName:     'sessionDefaultChannelGroup',
        stringFilter:  { value: 'Paid Search', matchType: 'EXACT' },
      },
    },
  })

  const mv = result.rows?.[0]?.metricValues ?? []
  return {
    paid_sessions:    parseInt(mv[0]?.value ?? '0', 10),
    paid_users:       parseInt(mv[1]?.value ?? '0', 10),
    paid_conversions: parseInt(mv[2]?.value ?? '0', 10),
    period_start:     periodStart,
    period_end:       periodEnd,
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

interface ReportOptions {
  dimensions?:      string[]
  metrics:          string[]
  orderBy?:         string
  limit?:           number
  dimensionFilter?: unknown
}

async function runReport(
  token:       string,
  propertyId:  string,
  startDate:   string,
  endDate:     string,
  opts:        ReportOptions,
): Promise<Ga4ReportResponse> {
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate, endDate }],
    metrics:    opts.metrics.map(name => ({ name })),
  }

  if (opts.dimensions?.length) {
    body.dimensions = opts.dimensions.map(name => ({ name }))
  }
  if (opts.orderBy) {
    body.orderBys = [{ metric: { metricName: opts.orderBy }, desc: true }]
  }
  if (opts.limit) {
    body.limit = opts.limit
  }
  if (opts.dimensionFilter !== undefined) {
    body.dimensionFilter = opts.dimensionFilter
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(`${GA4_DATA_API}/${propertyId}:runReport`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const rawBody = await res.text()
      const { googleStatus, googleReason, message } = parseGoogleError(rawBody)
      console.warn(`[ga4/client] runReport returned ${res.status} for ${propertyId}: ${rawBody.slice(0, 200)}`)
      throw new Ga4ApiError(res.status, googleStatus, googleReason, message, rawBody.slice(0, 500))
    }

    return res.json() as Promise<Ga4ReportResponse>
  } catch (err) {
    if (err instanceof Ga4ApiError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[ga4/client] fetch failed:', msg)
    throw new Ga4ApiError(0, 'NETWORK_ERROR', 'networkError', msg)
  } finally {
    clearTimeout(timer)
  }
}

function normalizePropertyId(id: string): string {
  return id.startsWith('properties/') ? id : `properties/${id}`
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * 关键事件按事件名拆开 + 表单开始次数。
 *
 * 存在理由：`leads_count` 取的是 GA4「关键事件」总数，**不区分事件是什么** ——
 * 只要有人把浏览之类也标成关键事件，或者某个事件的触发规则太宽，
 * 「客资数」就会虚高，而仪表盘上完全看不出来。
 * 2026-08-04 实测 CTS：28 天 341 个「客资」，而**开始填表只有 86 次** ——
 * 人还没动表单，「产生线索」先响了 4 遍。
 *
 * 拿这两个数就能判断这个客资数值不值得信。
 */
export async function fetchGa4KeyEventBreakdown(
  propertyId: string,
  clientId: string,
  periodDays: number = DEFAULT_PERIOD_DAYS,
): Promise<{ keyEventsByName: Record<string, number>; formStarts: number } | null> {
  const token = await getValidAccessToken(clientId)
  if (!token) return null

  const normalized = normalizePropertyId(propertyId)
  const periodEnd = toIsoDate(new Date())
  const periodStart = toIsoDate(daysAgo(periodDays))

  const report = await runReport(token, normalized, periodStart, periodEnd, {
    dimensions: ['eventName'],
    metrics: ['keyEvents', 'eventCount'],
    limit: 100,
  })

  const keyEventsByName: Record<string, number> = {}
  let formStarts = 0
  for (const row of report.rows ?? []) {
    const name = row.dimensionValues?.[0]?.value ?? ''
    const key = Number(row.metricValues?.[0]?.value ?? '0')
    const count = Number(row.metricValues?.[1]?.value ?? '0')
    if (key > 0) keyEventsByName[name] = key
    // form_start 是 GA4 增强测量自带的事件，代表「有人真的动了表单」
    if (name === 'form_start') formStarts = count
  }
  return { keyEventsByName, formStarts }
}
