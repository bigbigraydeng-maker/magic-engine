import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { gscSiteUrlFromConfig } from '@/lib/gsc/connected-clients'
import { withGscAccess, querySearchAnalyticsRows, GscApiError } from '@/lib/gsc/client'
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
 * brand / non-brand split. It writes nothing anywhere (no table, no receipt, no run log) and makes no paid calls,
 * so `dry_run` is accepted for interface parity with the other trial routes but changes nothing.
 *
 * Triggered through the manual trial workflow (`manual-cron-trial.yml`), which carries the CRON_SECRET; the GSC
 * credentials live on the server, never in a developer window.
 *
 * Query: client_id=<uuid> (REQUIRED), days=<1..7> (default 1), dry_run=1|0 (ignored: read-only)
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROW_LIMIT = 25000
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
  readonly truncated_at_page_limit: boolean
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
  const daysRaw = Number(params.get('days') ?? '1')
  const days = Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 7 ? daysRaw : 1
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
  const reports: DayReport[] = []
  const allQueryRows: { query: string; clicks: number; impressions: number; position: number }[] = []

  try {
    for (let i = 0; i < days; i += 1) {
      const day = addDays(lastDay, -i)
      const rows = await withGscAccess(clientId, (token) =>
        querySearchAnalyticsRows(token, siteUrl, {
          startDate: day,
          endDate: day,
          dimensions: ['query', 'page'],
          rowLimit: ROW_LIMIT,
        }),
      )
      if (rows === null) {
        return NextResponse.json({ success: true, dry_run: dryRun, read_only: true, status: 'no_token' }, { status: 200 })
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
        truncated_at_page_limit: rows.length >= ROW_LIMIT,
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
      avg_rows_per_day: Math.round(totalRows / reports.length),
      brand_split: brand.status === 'ok' ? splitQueryRows(allQueryRows, brand.matcher, 10) : { status: brand.status },
    },
    { status: 200 },
  )
}
