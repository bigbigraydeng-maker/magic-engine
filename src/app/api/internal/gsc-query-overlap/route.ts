import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { gscSiteUrlFromConfig } from '@/lib/gsc/connected-clients'
import { withGscAccess, querySearchAnalyticsRows, GscApiError } from '@/lib/gsc/client'
import {
  findQueryOverlap,
  summarisePagePairs,
  type QueryPageRow,
} from '@/lib/gsc/query-overlap'

/**
 * GET /api/internal/gsc-query-overlap   (manual only — NOT a cron: lives outside /api/cron so the
 * cron-coverage check does not mistake it for an unscheduled job)
 *
 * Read-only report: which queries a client's pages compete for in Google Search Console, i.e.
 * queries where two or more pages of the same site both receive impressions. Writes nothing
 * anywhere and makes no paid calls, so `dry_run` is accepted for interface parity with the other
 * trial routes but changes nothing.
 *
 * Triggered through the manual trial workflow (`manual-cron-trial.yml`), which carries the
 * CRON_SECRET; the GSC credentials live on the server, never in a developer window.
 *
 * Query: client_id=<uuid> (REQUIRED — one client per call keeps the run inside its time limit),
 *        days=<7..90> (default 28), dry_run=1|0 (ignored: read-only)
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ROW_LIMIT = 25000
const PAIR_LIMIT = 30
const TOP_QUERY_LIMIT = 60

function formatUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10)
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
  const daysRaw = Number(params.get('days') ?? '28')
  const days = Number.isInteger(daysRaw) && daysRaw >= 7 && daysRaw <= 90 ? daysRaw : 28
  const dryRun = params.get('dry_run') === '1'

  const { data: conns, error } = await supabaseAdmin
    .from('client_connectors')
    .select('client_id, config')
    .eq('client_id', clientId)
    .eq('anchor', 'gsc')
    .eq('status', 'connected')
  if (error) return NextResponse.json({ success: false, dry_run: dryRun, read_only: true, status: 'error', error: 'connector read failed' }, { status: 500 })

  const conn = (conns ?? [])[0] as { client_id: string; config: unknown } | undefined
  const siteUrl = conn ? gscSiteUrlFromConfig(conn.config) : null
  if (!conn || !siteUrl) {
    return NextResponse.json(
      { success: true, dry_run: dryRun, read_only: true, status: 'no_gsc_connection' },
      { status: 200 },
    )
  }

  // GSC data settles with a lag; end 3 days back so the window is complete.
  const endDate = new Date()
  endDate.setUTCDate(endDate.getUTCDate() - 3)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1))
  const startDateStr = formatUtcDate(startDate)
  const endDateStr = formatUtcDate(endDate)

  try {
    const rows = await withGscAccess(clientId, (token) =>
      querySearchAnalyticsRows(token, siteUrl, {
        startDate: startDateStr,
        endDate: endDateStr,
        dimensions: ['query', 'page'],
        rowLimit: ROW_LIMIT,
      }),
    )

    if (rows === null) {
      return NextResponse.json(
        { success: true, dry_run: dryRun, read_only: true, status: 'no_token' },
        { status: 200 },
      )
    }

    const queryPageRows: QueryPageRow[] = rows.map((row) => ({
      query: row.keys[0] ?? '',
      page: row.keys[1] ?? '',
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    }))

    const all = findQueryOverlap(queryPageRows, { maxQueries: 100000 })
    const pairs = summarisePagePairs(all, PAIR_LIMIT)
    const top = all.slice(0, TOP_QUERY_LIMIT)

    return NextResponse.json(
      {
        success: true,
        read_only: true,
        status: 'ok',
        dry_run: dryRun,
        days,
        start_date: startDateStr,
        end_date: endDateStr,
        rows_fetched: queryPageRows.length,
        rows_truncated: queryPageRows.length >= ROW_LIMIT,
        overlapping_queries: all.length,
        pairs,
        top_queries: top,
      },
      { status: 200 },
    )
  } catch (err) {
    // Fixed short code only: Google's response text (account / property details) stays in the server log.
    const code =
      err instanceof GscApiError
        ? `GSC HTTP ${err.httpStatus} ${err.googleStatus}`.slice(0, 80)
        : 'GSC read failed'
    return NextResponse.json(
      { success: false, dry_run: dryRun, read_only: true, status: 'error', error: code },
      { status: 500 },
    )
  }
}
