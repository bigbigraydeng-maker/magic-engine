/**
 * Google Analytics 4 — Data API v1beta client.
 *
 * Fetches traffic snapshots via the GA4 Data API.
 *
 * Authentication priority (mirrors gsc/client.ts's resolveAccessToken — same
 * migration, same reasoning, see docs/specs/2026-08-11-onboarding-integrations-
 * unify-v1.md §2.2 and PR3a):
 *   1. Per-client OAuth token from platform_oauth_connections (provider='google_ga4')
 *   2. Legacy per-client OAuth token from google_oauth_tokens — this is the SAME
 *      underlying Google grant GSC uses (COMBINED_GOOGLE_SCOPES requests both
 *      analytics.readonly and webmasters.readonly in one consent), just not yet
 *      split into its own platform_oauth_connections row for older connections.
 *
 * Usage (P17.A.2):
 *   const snapshot = await fetchGa4Snapshot(propertyId, clientId)
 *   // propertyId: 'properties/123456789' or bare '123456789'
 *
 * Reference: https://developers.google.com/analytics/devguides/reporting/data/v1
 */

import { getValidAccessToken } from '@/lib/google-oauth/client'
import type { FormFunnelRaw } from './form-funnel'
import type { OrganicLandingLeadsRaw, LandingEventRow } from './organic-landing-leads'
import { getValidTokenForConnection } from '@/lib/platform-oauth/token-manager'
import { supabaseAdmin } from '@/lib/supabase'
import { toGa4ResourceName } from './property-id'

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

// ─── Token resolution ─────────────────────────────────────────────────────────

export async function resolveAccessToken(
  clientId: string,
  opts?: { forceRefresh?: boolean },
): Promise<string | null> {
  const { data: rows, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, account_id, status')
    .eq('client_id', clientId)
    .eq('provider', 'google_ga4')
    .order('updated_at', { ascending: false })

  if (error) {
    console.warn('[ga4/client] GA4 connection lookup failed:', error.message)
    return null
  }

  if ((rows?.length ?? 0) === 0) {
    // Legacy fallback is only for clients that have never had a dedicated
    // GA4 row. An error/revoked row is an explicit lifecycle state.
    return getValidAccessToken(clientId, opts)
  }

  const activeRows = rows!.filter((row) => row.status === 'active')
  const selected = activeRows.find((row) => row.account_id === clientId) ?? activeRows[0]
  if (!selected) return null

  try {
    return await getValidTokenForConnection(selected.id, opts)
  } catch (err) {
    console.warn('[ga4/client] dedicated token resolution failed:', err instanceof Error ? err.message : err)
    return null
  }
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
  const token = await resolveAccessToken(clientId)
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
      const fresh = await resolveAccessToken(clientId, { forceRefresh: true })
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
  const token = await resolveAccessToken(clientId)
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

// ─── Public API (property verification) ───────────────────────────────────────

export type Ga4VerifyFailureReason = 'no_token' | 'permission_denied' | 'not_found' | 'api_error'

export type Ga4VerifyResult =
  | { ok: true }
  | { ok: false; reason: Ga4VerifyFailureReason; detail: string }

/**
 * Minimal read-only probe: can this client's Google token actually read this
 * GA4 property? Used by ga4/property.ts's setGa4Property() before it commits
 * a connector to `status: 'connected'` — a saved property_id that turns out
 * to be wrong/inaccessible must not show up in the UI as if it worked.
 *
 * A 200 response with zero rows (property genuinely has no traffic yet) is
 * `{ ok: true }` — "no data" and "no access" are different facts and must
 * not be conflated (see docs/PITFALLS.md — treating an empty result as an
 * error hides real properties that just haven't collected data yet).
 */
export async function verifyGa4PropertyAccess(
  clientId: string,
  propertyId: string,
): Promise<Ga4VerifyResult> {
  // 魏征 2026-08-18 复审：resolveAccessToken() 的兜底路径（legacy
  // getValidAccessToken）在自己的 Supabase 查询上没有 try/catch —— 一次
  // 瞬时网络故障会直接抛出，未包裹的话会一路冒到 setGa4Property 和 PATCH
  // handler，Next.js 只能返回一个没有 reason 字段的裸 500，而不是这个函数本
  // 该给出的「暂时联系不上，稍后重试」这类可读错误。跟下面 runReport 那段
  // try/catch 走同一条「genuine error → api_error」路径。
  let token: string | null
  try {
    token = await resolveAccessToken(clientId)
  } catch (err) {
    return {
      ok: false,
      reason: 'api_error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
  if (!token) {
    return {
      ok: false,
      reason: 'no_token',
      detail: '这个客户还没有可用的 Google 授权（GA4 专属或 GSC 共享的都没有）。',
    }
  }

  const resource = toGa4ResourceName(propertyId)
  try {
    await runReport(token, resource, toIsoDate(daysAgo(1)), toIsoDate(new Date()), {
      metrics: ['sessions'],
      limit:   1,
    })
    return { ok: true }
  } catch (err) {
    if (err instanceof Ga4ApiError) {
      if (err.httpStatus === 403 || err.httpStatus === 401) {
        return {
          ok: false,
          reason: 'permission_denied',
          detail: err.message || '这个 Google 账号对该 GA4 Property 没有权限，或授权已失效。',
        }
      }
      if (err.httpStatus === 400) {
        return {
          ok: false,
          reason: 'not_found',
          detail: err.message || 'Property 编号对不上任何 GA4 资源，请确认编号。',
        }
      }
      return {
        ok: false,
        reason: 'api_error',
        detail: err.message || `Google Analytics 接口返回 HTTP ${err.httpStatus}`,
      }
    }
    return {
      ok: false,
      reason: 'api_error',
      detail: err instanceof Error ? err.message : String(err),
    }
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

// Delegates to the shared canonical module (src/lib/ga4/property-id.ts) so
// there is exactly one place that knows how to turn bare digits or a
// `properties/…` string into the resource name Google's APIs expect.
function normalizePropertyId(id: string): string {
  return toGa4ResourceName(id)
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
  const token = await resolveAccessToken(clientId)
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

/**
 * 指定事件名近 N 天的次数（只读）。开投前追踪检查用它核对「留资事件」GA4 真的收到了没有。
 * 没有可用的 Google 授权返回 null；一次都没出现过的事件不在结果里（调用方按 0 处理，不当成读不到）。
 */
export async function fetchGa4EventCounts(
  propertyId: string,
  clientId: string,
  eventNames: readonly string[],
  periodDays: number = DEFAULT_PERIOD_DAYS,
): Promise<Record<string, number> | null> {
  const token = await resolveAccessToken(clientId)
  if (!token) return null

  const report = await runReport(
    token,
    normalizePropertyId(propertyId),
    toIsoDate(daysAgo(periodDays)),
    toIsoDate(new Date()),
    {
      dimensions: ['eventName'],
      metrics: ['eventCount'],
      limit: Math.max(eventNames.length, 1),
      dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: [...eventNames] } } },
    },
  )

  const counts: Record<string, number> = {}
  for (const row of report.rows ?? []) {
    const name = row.dimensionValues?.[0]?.value ?? ''
    const count = Number(row.metricValues?.[0]?.value ?? '0')
    if (name !== '' && Number.isFinite(count)) counts[name] = count
  }
  return counts
}

/**
 * Form funnel raw numbers (read-only): form_start / form_submit / generate_lead counts and
 * people, form_start by page, and thank-you page views / people. Summarised in form-funnel.ts.
 */
export async function fetchGa4FormFunnelRaw(
  propertyId: string,
  clientId: string,
  periodDays: number = DEFAULT_PERIOD_DAYS,
): Promise<FormFunnelRaw | null> {
  const token = await resolveAccessToken(clientId)
  if (!token) return null
  const normalized = normalizePropertyId(propertyId)
  const periodEnd = toIsoDate(new Date())
  const periodStart = toIsoDate(daysAgo(periodDays))
  const num = (v: string | undefined): number => Number(v ?? '0') || 0

  const eventsReport = await runReport(token, normalized, periodStart, periodEnd, {
    dimensions: ['eventName'],
    metrics: ['eventCount', 'totalUsers'],
    limit: 20,
    dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: ['form_start', 'form_submit', 'generate_lead'] } } },
  })
  const events: Record<string, { events: number; users: number }> = {}
  for (const row of eventsReport.rows ?? []) {
    const name = row.dimensionValues?.[0]?.value ?? ''
    events[name] = { events: num(row.metricValues?.[0]?.value), users: num(row.metricValues?.[1]?.value) }
  }

  const startReport = await runReport(token, normalized, periodStart, periodEnd, {
    dimensions: ['pagePath'],
    metrics: ['eventCount', 'totalUsers'],
    orderBy: 'eventCount',
    limit: 15,
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'form_start' } } },
  })
  const startByPath = (startReport.rows ?? []).map(r => ({
    path: r.dimensionValues?.[0]?.value ?? '', events: num(r.metricValues?.[0]?.value), users: num(r.metricValues?.[1]?.value),
  }))

  const thankReport = await runReport(token, normalized, periodStart, periodEnd, {
    dimensions: ['pagePath'],
    metrics: ['screenPageViews', 'totalUsers'],
    orderBy: 'screenPageViews',
    limit: 10,
    dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'CONTAINS', value: 'thank' } } },
  })
  const thankYouByPath = (thankReport.rows ?? []).map(r => ({
    path: r.dimensionValues?.[0]?.value ?? '', events: num(r.metricValues?.[0]?.value), users: num(r.metricValues?.[1]?.value),
  }))

  // People who saw ANY thank-you page, de-duplicated by GA4 (summing per-path users would count a person twice).
  const thankTotalReport = await runReport(token, normalized, periodStart, periodEnd, {
    metrics: ['screenPageViews', 'totalUsers'],
    dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'CONTAINS', value: 'thank' } } },
  })
  const totalRow = thankTotalReport.rows?.[0]
  const thankYouTotal = { events: num(totalRow?.metricValues?.[0]?.value), users: num(totalRow?.metricValues?.[1]?.value) }

  return { periodStart, periodEnd, events, startByPath, thankYouByPath, thankYouTotal }
}

const ORGANIC_LEAD_ROW_LIMIT = 250

/**
 * Organic Search × landing page × enquiry events (read-only). Two reads:
 *  1. events: the client's unified enquiry event (from client config), form_submit
 *  2. legacy signal: page views of paths containing the client's thank-you text
 * Both are restricted to the Organic Search default channel group in the request itself,
 * so other channels never leave GA4.
 */
export async function fetchGa4OrganicLandingLeadsRaw(
  propertyId: string,
  clientId: string,
  cfg: { enquiryEvent: string; thankYouPathContains: string },
  periodDays: number = DEFAULT_PERIOD_DAYS,
): Promise<OrganicLandingLeadsRaw | null> {
  const token = await resolveAccessToken(clientId)
  if (!token) return null
  const normalized = normalizePropertyId(propertyId)
  const periodEnd = toIsoDate(new Date())
  const periodStart = toIsoDate(daysAgo(periodDays))
  const num = (v: string | undefined): number => Number(v ?? '0') || 0
  const organic = { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search' } } }

  const eventsReport = await runReport(token, normalized, periodStart, periodEnd, {
    dimensions: ['sessionDefaultChannelGroup', 'landingPage', 'eventName'],
    metrics: ['eventCount', 'totalUsers'],
    orderBy: 'eventCount',
    limit: ORGANIC_LEAD_ROW_LIMIT,
    dimensionFilter: { andGroup: { expressions: [organic, { filter: { fieldName: 'eventName', inListFilter: { values: [cfg.enquiryEvent, 'form_submit'] } } }] } },
  })
  const thankReport = await runReport(token, normalized, periodStart, periodEnd, {
    dimensions: ['sessionDefaultChannelGroup', 'landingPage'],
    metrics: ['screenPageViews', 'totalUsers'],
    orderBy: 'screenPageViews',
    limit: ORGANIC_LEAD_ROW_LIMIT,
    dimensionFilter: { andGroup: { expressions: [organic, { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'CONTAINS', value: cfg.thankYouPathContains } } }] } },
  })
  const rows: LandingEventRow[] = []
  for (const r of eventsReport.rows ?? []) {
    rows.push({ channel: r.dimensionValues?.[0]?.value ?? '', landingPath: r.dimensionValues?.[1]?.value ?? '', event: r.dimensionValues?.[2]?.value ?? '', events: num(r.metricValues?.[0]?.value), users: num(r.metricValues?.[1]?.value) })
  }
  for (const r of thankReport.rows ?? []) {
    rows.push({ channel: r.dimensionValues?.[0]?.value ?? '', landingPath: r.dimensionValues?.[1]?.value ?? '', event: 'thank_you_page_view', events: num(r.metricValues?.[0]?.value), users: num(r.metricValues?.[1]?.value) })
  }
  const truncated = (eventsReport.rows?.length ?? 0) >= ORGANIC_LEAD_ROW_LIMIT || (thankReport.rows?.length ?? 0) >= ORGANIC_LEAD_ROW_LIMIT
  return { periodStart, periodEnd, rows, truncated }
}
