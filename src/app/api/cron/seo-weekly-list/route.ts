import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { runSeoWeeklyList } from '@/lib/seo-weekly-list/run'

/**
 * GET /api/cron/seo-weekly-list   (Mondays)
 *
 * SEO weekly list (docs/specs/2026-10-04-seo-weekly-list-v0.2.md): for each client
 * with an ACTIVE `seo_gsc_clicks_28d` goal — verify open list items, expire stale
 * ones (skipped + reason, never silent), then add up to N new items built from data
 * the platform already stores.
 *
 * No Inngest by design (CLAUDE §3 exception): no outward side effect, no cross-step
 * async — it reads and writes our own tables only. Receipt = cron_run_logs
 * (job name `seo-weekly-list`): items added / duplicates / verified / expired /
 * skipped keywords with reasons, per client.
 *
 * Query: ?dry_run=1 → compute and return the would-be list; writes nothing.
 *        ?client_id=<uuid> → one client only.
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  const clientId = req.nextUrl.searchParams.get('client_id') ?? undefined
  if (clientId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    return NextResponse.json({ error: 'client_id must be a UUID' }, { status: 400 })
  }
  const cronRun = dryRun ? null : await startCronRun('seo-weekly-list')

  try {
    const result = await runSeoWeeklyList(supabaseAdmin, { dryRun, clientId })
    await cronRun?.finish({
      processed: result.clients_processed,
      completed: result.clients_processed - result.failed,
      failed: result.failed,
      summary: {
        inserted: result.results.reduce((n, r) => n + r.inserted, 0),
        verified_pass: result.results.reduce((n, r) => n + r.verified_pass, 0),
        expired: result.results.reduce((n, r) => n + r.expired, 0),
        per_client: result.results,
      },
    })
    // 500 on any per-client failure: Render's `curl -f` then marks the run red instead of green.
    return NextResponse.json({ success: result.failed === 0, dry_run: dryRun, ...result }, { status: result.failed === 0 ? 200 : 500 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await cronRun?.finish({ failed: 1, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
