/**
 * POST /api/admin/prospecting/ingest-jobs
 *
 * Admin-only manual trigger for the job-signal discovery source (mirrors the
 * Places `discover` route). Two modes:
 *
 *   { dryRun: true }  → runs scrape → filter → resolve WITHOUT writing, returns
 *                       a preview of the companies it would insert. Bounded and
 *                       synchronous so the operator can eyeball resolution
 *                       quality before spending on the real run.
 *   { dryRun: false } → fire-and-forget real ingest (can outlive the gateway
 *                       timeout), writes a cron_run_logs breadcrumb.
 *
 * Body: { keywords?: string[], maxPerBoard?: number, dryRun?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { ingestJobSignals, type IngestParams } from '@/lib/prospecting/job-boards/ingest'

// Keep a dry-run inside the gateway timeout: fewer postings → fewer Places calls.
const DRY_RUN_MAX_PER_BOARD = 40

async function runIngest(params: IngestParams): Promise<void> {
  const startedAt = Date.now()
  const { data: logRow } = await supabaseAdmin
    .from('cron_run_logs')
    .insert({ job_name: 'prospecting_ingest_jobs', status: 'running', started_at: new Date().toISOString() })
    .select('id').single<{ id: string }>()
  const logId = logRow?.id ?? null

  try {
    const result = await ingestJobSignals(params)
    if (logId) {
      await supabaseAdmin.from('cron_run_logs').update({
        status: 'completed', finished_at: new Date().toISOString(), duration_ms: Date.now() - startedAt,
        processed: result.companies, completed_count: result.inserted, summary: result,
      }).eq('id', logId)
    }
  } catch (err) {
    if (logId) {
      await supabaseAdmin.from('cron_run_logs').update({
        status: 'failed', finished_at: new Date().toISOString(), duration_ms: Date.now() - startedAt,
        error_message: err instanceof Error ? err.message : String(err),
      }).eq('id', logId)
    }
    throw err
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const body = await req.json().catch(() => null) as
    { keywords?: string[]; maxPerBoard?: number; dryRun?: boolean } | null
  const keywords = Array.isArray(body?.keywords) && body.keywords.length ? body.keywords : undefined

  if (body?.dryRun) {
    const result = await ingestJobSignals({
      boards: ['seek'], keywords, maxPerBoard: DRY_RUN_MAX_PER_BOARD, dryRun: true,
    })
    return NextResponse.json({ dryRun: true, ...result })
  }

  void runIngest({ boards: ['seek'], keywords, maxPerBoard: body?.maxPerBoard ?? 120 })
    .catch(err => console.error('[prospecting/ingest-jobs] background failure', err))
  return NextResponse.json({ started: true }, { status: 202 })
}
