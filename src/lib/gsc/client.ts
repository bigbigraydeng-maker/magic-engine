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

import { createSign } from 'crypto'
import { getValidAccessToken } from '@/lib/google-oauth/client'
import type { GscSearchData, GscQueryRow } from '@/lib/zhangqian/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_URL              = 'https://oauth2.googleapis.com/token'
const SERVICE_ACCOUNT_SCOPE  = 'https://www.googleapis.com/auth/webmasters.readonly'
const SEARCH_ANALYTICS_BASE  = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

const DEFAULT_DATE_RANGE_DAYS = 28
const MAX_ROWS                = 25
const SNAPSHOT_ROWS           = 50   // per dimension for snapshots
const FETCH_TIMEOUT_MS        = 20_000

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

  const [queries, pages] = await Promise.all([
    querySearchAnalytics(token, siteUrl, periodStart, periodEnd, 'query'),
    querySearchAnalytics(token, siteUrl, periodStart, periodEnd, 'page'),
  ])

  if (!queries && !pages) return null

  const allRows = queries ?? []
  const totalClicks      = allRows.reduce((s, r) => s + r.clicks, 0)
  const totalImpressions = allRows.reduce((s, r) => s + r.impressions, 0)
  const avgCtr           = totalImpressions > 0
    ? allRows.reduce((s, r) => s + r.ctr * r.impressions, 0) / totalImpressions
    : 0
  const avgPosition      = allRows.length > 0
    ? allRows.reduce((s, r) => s + r.position, 0) / allRows.length
    : 0

  return {
    site_url:          siteUrl,
    period_start:      periodStart,
    period_end:        periodEnd,
    total_clicks:      totalClicks,
    total_impressions: totalImpressions,
    avg_ctr:           Math.round(avgCtr * 10000) / 10000,
    avg_position:      Math.round(avgPosition * 100) / 100,
    top_queries:       (queries ?? []).slice(0, SNAPSHOT_ROWS),
    top_pages:         (pages ?? []).slice(0, SNAPSHOT_ROWS),
    synced_at:         new Date().toISOString(),
  }
}

async function querySearchAnalytics(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimension: 'query' | 'page',
): Promise<GscSnapshotRow[] | null> {
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
      console.warn(`[gsc/client] ${dimension} query returned ${res.status} for ${siteUrl}`)
      return null
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
    console.warn(`[gsc/client] ${dimension} fetch failed:`, err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Token resolution ─────────────────────────────────────────────────────────

async function resolveAccessToken(clientId?: string): Promise<string | null> {
  // 1. OAuth token (per-client, preferred)
  if (clientId) {
    const oauthToken = await getValidAccessToken(clientId)
    if (oauthToken) return oauthToken
  }

  // 2. Service-account JWT (legacy / internal)
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
