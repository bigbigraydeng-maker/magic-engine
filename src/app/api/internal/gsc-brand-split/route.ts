import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { addDays, pacificDay } from '@/lib/gsc/page-daily-plan'
import { getBrandSplit } from '@/lib/gsc/brand-split-query'

/**
 * GET /api/internal/gsc-brand-split   (manual only — NOT a cron: lives outside /api/cron)
 *
 * Read-only: the brand / ambiguous / non-brand split of one client's STORED Search Console queries
 * (gsc_query_page_daily), over the last N finalised days. Reads only our own tables — no Google call, no write, no
 * paid call. It is the first real caller of getBrandSplit, so the split can be checked on live data through the
 * manual trial workflow (the Search Console credentials are not needed, but CRON_SECRET lives there).
 *
 * Output: bucket totals and counts only — no query text (it goes into the GitHub Actions summary; queries can
 * contain personal information).
 *
 * Query: client_id=<uuid> (REQUIRED), days=<7..90> (default 28; anything else → 400), dry_run=1|0 (ignored)
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Days newer than this many days ago may still be unfinalised at Google, so they are not part of the window. */
const SETTLED_DAYS_AGO = 5

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
  if (!Number.isInteger(daysRaw) || daysRaw < 7 || daysRaw > 90) {
    return NextResponse.json({ error: 'days must be an integer between 7 and 90' }, { status: 400 })
  }
  const dryRun = params.get('dry_run') === '1'

  const endDay = addDays(pacificDay(new Date()), -SETTLED_DAYS_AGO)
  const startDay = addDays(endDay, -(daysRaw - 1))
  try {
    const report = await getBrandSplit(supabaseAdmin, clientId, { startDay, endDay })
    if (report.status !== 'ok') {
      return NextResponse.json({ success: true, dry_run: dryRun, read_only: true, ...report }, { status: 200 })
    }
    const { buckets, ...rest } = report
    return NextResponse.json(
      {
        success: true,
        dry_run: dryRun,
        read_only: true,
        ...rest,
        brand: buckets.brand,
        ambiguous: buckets.ambiguous,
        non_brand: buckets.non_brand,
        suspect_missed_brand_count: buckets.suspect_missed_brand.length,
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('[gsc-brand-split] read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ success: false, dry_run: dryRun, read_only: true, status: 'error', error: 'read failed' }, { status: 500 })
  }
}
