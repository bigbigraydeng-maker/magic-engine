import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { gscSiteUrlFromConfig } from '@/lib/gsc/connected-clients'
import { withGscAccess, querySearchAnalyticsRows, GscApiError, type GscAnalyticsRow } from '@/lib/gsc/client'
import { addDays, pacificDay } from '@/lib/gsc/page-daily-plan'
import { toQueryPageDailyRows } from '@/lib/gsc/query-page-daily-store'
import { readBrandConfig, splitQueryRows } from '@/lib/gsc/brand-split'

/**
 * GET /api/internal/gsc-query-page-probe   (manual only — NOT a cron: lives outside /api/cron so the
 * cron-coverage check does not mistake it for an unscheduled job)
 *
 * Read-only dry run of the per-(query, page) daily store (docs/specs/2026-10-13-gsc-query-page-daily-design.md §8):
 * pulls N finalised days of query × page rows from Google Search Console for ONE client, runs them through the
 * SAME row conversion the real store uses, and reports what would have been written — rows per day, duplicate
 * keys, case-only duplicates, rows too long to index, and (if the client has brand terms configured) the
 * brand / non-brand split. It writes no business table (no table, no receipt, no run log) and makes no paid calls,
 * so `dry_run` is accepted for interface parity with the other trial routes but changes nothing. The one thing it
 * can write is what every Search Console read can write: an expired Google access token is refreshed and stored
 * again (withGscAccess).
 *
 * Output carries counts and totals only — no search-query text: the result goes into the GitHub Actions summary
 * and queries can contain personal information.
 *
 * Like the real pull it reads up to two pages of 25,000 rows per day; a day whose second page is also full is
 * reported as truncated (the real pull records such a day as truncated too).
 *
 * Triggered through the manual trial workflow (`manual-cron-trial.yml`), which carries the CRON_SECRET; the GSC
 * credentials live on the server, never in a developer window.
 *
 * Query: client_id=<uuid> (REQUIRED), days=<1..7> (default 7; the trial workflow passes only client_id; anything else → 400), dry_run=1|0 (ignored)
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROW_LIMIT = 25000
/** Same cap as the real pull: Google exposes at most 2 × 25,000 rows per day. */
const MAX_PAGES_PER_DAY = 2
/** Stop starting new days after this long, so the answer comes back inside maxDuration instead of timing out. */
const TIME_BUDGET_MS = 90_000
/** Days newer than this many days ago may still be unfinalised at Google. */
const SETTLED_DAYS_AGO = 5

interface DayReport {
  readonly day: string
  readonly rows_from_google: number
  readonly storable_rows: number
  readonly duplicate_keys: number
  readonly case_only_duplicates: number
  readonly skipped_long_rows: number
  readonly clicks: number
  readonly impressions: number
  /** Both pages came back full: Google's per-day cap was reached, only its top rows exist. */
  readonly truncated_at_google_cap: boolean
}

type BrandOutcome = ReturnType<typeof readBrandConfig>

/** Bucket totals and the NUMBER of suspected missed brand queries — never the query text itself. */
function brandSummary(brand: BrandOutcome, rows: { query: string; clicks: number; impressions: number; position: number }[]) {
  if (brand.status !== 'ok') return { status: brand.status }
  const split = splitQueryRows(rows, brand.matcher, 1_000_000)
  return {
    status: 'ok' as const,
    brand: split.brand,
    ambiguous: split.ambiguous,
    non_brand: split.non_brand,
    suspect_missed_brand_count: split.suspect_missed_brand.length,
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const clientId = params.get('client_id')
  if (!clientId || !UUID.test(clientId)) {
    return NextResponse.json({ error: 'client_id (UUID) is required' }, { status: 400 })
  }
  const daysRaw = Number(params.get('days') ?? '7')
  if (!Number.isInteger(daysRaw) || daysRaw < 1 || daysRaw > 7) {
    return NextResponse.json({ error: 'days must be an integer between 1 and 7' }, { status: 400 })
  }
  const days = daysRaw
  const dryRun = params.get('dry_run') === '1'
  const fail = (status: string, code: number) =>
    NextResponse.json({ success: false, dry_run: dryRun, read_only: true, status }, { status: code })

  const { data: conns, error } = await supabaseAdmin
    .from('client_connectors')
    .select('client_id, config')
    .eq('client_id', clientId)
    .eq('anchor', 'gsc')
    .eq('status', 'connected')
  if (error) return fail('connector_read_failed', 500)

  const conn = (conns ?? [])[0] as { client_id: string; config: unknown } | undefined
  const siteUrl = conn ? gscSiteUrlFromConfig(conn.config) : null
  if (!conn || !siteUrl) {
    return NextResponse.json({ success: true, dry_run: dryRun, read_only: true, status: 'no_gsc_connection' }, { status: 200 })
  }

  const { data: clientRow, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('seo_config')
    .eq('id', clientId)
    .maybeSingle()
  if (clientErr) return fail('client_read_failed', 500)
  const brand = readBrandConfig((clientRow as { seo_config?: unknown } | null)?.seo_config ?? null, siteUrl)

  const lastDay = addDays(pacificDay(new Date()), -SETTLED_DAYS_AGO)
  const startedAt = Date.now()
  let stoppedEarly = false
  const reports: DayReport[] = []
  const allQueryRows: { query: string; clicks: number; impressions: number; position: number }[] = []

  try {
    for (let i = 0; i < days; i += 1) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        stoppedEarly = true
        break
      }
      const day = addDays(lastDay, -i)
      const rows: GscAnalyticsRow[] = []
      let lastPageFull = false
      for (let page = 0; page < MAX_PAGES_PER_DAY; page += 1) {
        const got = await withGscAccess(clientId, (token) =>
          querySearchAnalyticsRows(token, siteUrl, {
            startDate: day,
            endDate: day,
            dimensions: ['query', 'page'],
            rowLimit: ROW_LIMIT,
            startRow: page * ROW_LIMIT,
          }),
        )
        if (got === null) {
          return NextResponse.json({ success: true, dry_run: dryRun, read_only: true, status: 'no_token' }, { status: 200 })
        }
        rows.push(...got)
        lastPageFull = got.length >= ROW_LIMIT
        if (!lastPageFull) break
      }
      const { rows: storable, skippedLongUrls } = toQueryPageDailyRows(clientId, day, rows)
      const pairs = new Set(rows.map((r) => `${r.keys[0]}\u0000${r.keys[1]}`))
      const folded = new Set(rows.map((r) => `${(r.keys[0] ?? '').toLowerCase()}\u0000${r.keys[1]}`))
      for (const r of storable) {
        allQueryRows.push({ query: r.query, clicks: r.clicks, impressions: r.impressions, position: r.position })
      }
      reports.push({
        day,
        rows_from_google: rows.length,
        storable_rows: storable.length,
        duplicate_keys: rows.length - pairs.size,
        case_only_duplicates: pairs.size - folded.size,
        skipped_long_rows: skippedLongUrls,
        clicks: storable.reduce((a, r) => a + r.clicks, 0),
        impressions: storable.reduce((a, r) => a + r.impressions, 0),
        truncated_at_google_cap: lastPageFull,
      })
    }
  } catch (err) {
    // Fixed short code only: Google's response text (account / property details) stays in the server log.
    const code =
      err instanceof GscApiError ? `GSC HTTP ${err.httpStatus} ${err.googleStatus}`.slice(0, 80) : 'GSC read failed'
    return NextResponse.json({ success: false, dry_run: dryRun, read_only: true, status: 'error', error: code }, { status: 500 })
  }

  const totalRows = reports.reduce((a, r) => a + r.storable_rows, 0)
  return NextResponse.json(
    {
      success: true,
      read_only: true,
      status: 'ok',
      dry_run: dryRun,
      days,
      reports,
      total_storable_rows: totalRows,
      avg_rows_per_day: reports.length > 0 ? Math.round(totalRows / reports.length) : 0,
      stopped_early: stoppedEarly,
      brand_split: brandSummary(brand, allQueryRows),
    },
    { status: 200 },
  )
}
