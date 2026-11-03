/**
 * POST /api/cron/viral-analyzer-worker
 *
 * Throttled background analyzer for viral_reference_library.
 * Picks up to BATCH_SIZE references per run and runs Gemini analysis
 * sequentially with a delay between calls to stay within Gemini
 * Token-Per-Minute limits.
 *
 * Pending rows go first (oldest created_at). Error rows are retried only when
 * next_retry_at is due, oldest updated_at first (nulls first), so a failure
 * moves to the back instead of blocking the queue. Permanent failures are
 * marked `terminal` and are not claimed. Per-video failures increment
 * failed_count on the cron run log.
 *
 * Auth:     Authorization: Bearer ${CRON_SECRET}
 * Switch:   no-ops unless VIRAL_ANALYZER_ENABLED === 'true' (paused 2026-10-27,
 *           Gemini quota exhausted; set the env var to 'true' to resume)
 * Schedule: render.yaml
 * Batch:    4 videos per run, sequential, ~5s delay between each
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { analyzeViralReference } from '@/lib/reels/viral-analyzer'
import {
  STALE_ANALYZING_MS,
  compareRetryRows,
  isRetryEligible,
  retryDueOrFilter,
  terminalErrorOrFilter,
  type RetryCandidate,
} from '@/lib/reels/viral-analyzer-retry'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300  // 5 min

const BATCH_SIZE   = 4
const DELAY_MS     = 5_000
const ERROR_PAGE   = 40
const MAX_ERROR_SCAN = 2_000

const ROW_FIELDS = 'id, source_url, analysis_status, analysis_error, next_retry_at, updated_at, created_at, platform'

interface AnalyzerRow extends RetryCandidate {
  id: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.VIRAL_ANALYZER_ENABLED !== 'true') {
    return NextResponse.json({ skipped: 'disabled', hint: 'set VIRAL_ANALYZER_ENABLED=true to run' })
  }

  const cronRun = await startCronRun('viral-analyzer-worker')
  const now = new Date()
  await reclaimStaleAnalyzing(now)
  await sweepTerminalRows(now)

  const pending = await loadPending(BATCH_SIZE)
  if (pending.error) return finishSelectError(cronRun, pending.error)
  const due = await loadDueErrors(now, BATCH_SIZE - pending.rows.length)
  if (due.error) return finishSelectError(cronRun, due.error)

  const batch = [...pending.rows, ...due.rows]
  if (batch.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({ ok: true, processed: 0, message: 'No pending references' })
  }

  const claimError = await claimBatch(batch, now)
  if (claimError) return finishSelectError(cronRun, claimError)

  const outcome = await processBatch(batch)
  await cronRun.finish({
    processed: batch.length,
    completed: outcome.succeeded,
    failed: outcome.failed,
    summary: outcome.errors.length > 0 ? { errors: outcome.errors.slice(0, 8) } : undefined,
  })
  return NextResponse.json({
    ok:        true,
    timestamp: now.toISOString(),
    batch:     batch.length,
    succeeded: outcome.succeeded,
    failed:    outcome.failed,
    errors:    outcome.errors,
  })
}

async function finishSelectError(
  cronRun: Awaited<ReturnType<typeof startCronRun>>,
  message: string,
): Promise<NextResponse> {
  await cronRun.finish({ failed: 1, error: message })
  return NextResponse.json({ error: message }, { status: 500 })
}

async function reclaimStaleAnalyzing(now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - STALE_ANALYZING_MS).toISOString()
  const { error } = await supabaseAdmin
    .from('viral_reference_library')
    .update({ analysis_status: 'pending', updated_at: now.toISOString() })
    .eq('analysis_status', 'analyzing')
    .or(`updated_at.is.null,updated_at.lt.${staleBefore}`)
  if (error) console.error(`[viral-analyzer-worker] reclaim analyzing failed: ${error.message}`)
}

async function sweepTerminalRows(now: Date): Promise<void> {
  const { error } = await supabaseAdmin
    .from('viral_reference_library')
    .update({ analysis_status: 'terminal', next_retry_at: null, updated_at: now.toISOString() })
    .in('analysis_status', ['pending', 'error'])
    .or(terminalErrorOrFilter())
  if (error) console.error(`[viral-analyzer-worker] terminal sweep failed: ${error.message}`)
}

async function loadPending(limit: number): Promise<{ rows: AnalyzerRow[]; error?: string }> {
  if (limit <= 0) return { rows: [] }
  const { data, error } = await supabaseAdmin
    .from('viral_reference_library')
    .select(ROW_FIELDS)
    .eq('analysis_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) return { rows: [], error: error.message }
  return { rows: ((data ?? []) as AnalyzerRow[]).filter(row => isRetryEligible(row, new Date())) }
}

async function loadDueErrors(now: Date, limit: number): Promise<{ rows: AnalyzerRow[]; error?: string }> {
  if (limit <= 0) return { rows: [] }
  const picked: AnalyzerRow[] = []
  for (let offset = 0; offset < MAX_ERROR_SCAN && picked.length < limit; offset += ERROR_PAGE) {
    const page = await fetchErrorPage(now, offset)
    if (page.error) return { rows: [], error: page.error }
    const eligible = page.rows.filter(row => isRetryEligible(row, now)).sort(compareRetryRows)
    for (const row of eligible) {
      picked.push(row)
      if (picked.length >= limit) break
    }
    if (page.rows.length < ERROR_PAGE) break
  }
  return { rows: picked }
}

async function fetchErrorPage(now: Date, offset: number): Promise<{ rows: AnalyzerRow[]; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('viral_reference_library')
    .select(ROW_FIELDS)
    .eq('analysis_status', 'error')
    .neq('platform', 'xiaohongshu')
    .or(retryDueOrFilter(now.toISOString()))
    .order('updated_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .range(offset, offset + ERROR_PAGE - 1)
  if (error) return { rows: [], error: error.message }
  return { rows: (data ?? []) as AnalyzerRow[] }
}

async function claimBatch(batch: AnalyzerRow[], now: Date): Promise<string | null> {
  const { error } = await supabaseAdmin
    .from('viral_reference_library')
    .update({ analysis_status: 'analyzing', updated_at: now.toISOString() })
    .in('id', batch.map(row => row.id))
  return error ? error.message : null
}

async function processBatch(batch: AnalyzerRow[]): Promise<{ succeeded: number; failed: number; errors: string[] }> {
  let succeeded = 0
  let failed = 0
  const errors: string[] = []
  for (let i = 0; i < batch.length; i++) {
    const ref = batch[i]
    try {
      await analyzeViralReference(ref.id, ref.source_url)
      succeeded++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[viral-analyzer-worker] ✗ ${ref.id}: ${msg}`)
      errors.push(`${ref.id.slice(0, 8)}: ${msg.slice(0, 120)}`)
      failed++
    }
    if (i < batch.length - 1) await new Promise(resolve => setTimeout(resolve, DELAY_MS))
  }
  return { succeeded, failed, errors }
}
