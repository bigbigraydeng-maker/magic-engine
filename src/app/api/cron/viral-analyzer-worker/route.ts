/**
 * POST /api/cron/viral-analyzer-worker
 *
 * Throttled background analyzer for viral_reference_library.
 * Picks up to BATCH_SIZE pending references per minute and runs Gemini analysis
 * sequentially with a delay between calls to stay within Gemini paid-tier
 * Token-Per-Minute (TPM) limits.
 *
 * Without throttling, viral-discovery cron inserts ~150 rows at once and
 * fire-and-forget analysis bursts overwhelm the paid-tier TPM cap (1M tokens/min
 * for Gemini 2.5 Flash Tier 1), causing 429 errors despite having credit.
 *
 * Auth:     Authorization: Bearer ${CRON_SECRET}
 * Schedule: Every 2 minutes (render.yaml)
 * Batch:    8 videos per run, sequential, ~5s delay between each
 *           ≈ 4 videos/min — well below TPM limits, drains ~150 backlog in ~40min.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { analyzeViralReference } from '@/lib/reels/viral-analyzer'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120  // 2 min

const BATCH_SIZE   = 8
const DELAY_MS     = 5_000

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('viral-analyzer-worker')

  // Claim up to BATCH_SIZE rows. Pending rows are processed first; error rows
  // (e.g. prior 429 quota exhaustion) are retried once the queue is empty.
  // Ordering: pending before error, then oldest-first within each group.
  const { data: pending, error: selectErr } = await supabaseAdmin
    .from('viral_reference_library')
    .select('id, source_url, analysis_status')
    .in('analysis_status', ['pending', 'error'])
    .order('analysis_status', { ascending: false })  // 'pending' > 'error' alphabetically desc → pending first
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (selectErr) {
    await cronRun.finish({ failed: 1, error: selectErr.message })
    return NextResponse.json({ error: selectErr.message }, { status: 500 })
  }
  const batch = pending ?? []
  if (batch.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({ ok: true, processed: 0, message: 'No pending references' })
  }

  // Claim batch
  const { error: claimErr } = await supabaseAdmin
    .from('viral_reference_library')
    .update({ analysis_status: 'analyzing' })
    .in('id', batch.map(r => r.id))

  if (claimErr) {
    await cronRun.finish({ failed: 1, error: claimErr.message })
    return NextResponse.json({ error: claimErr.message }, { status: 500 })
  }

  // Process sequentially with delay between each call
  let succeeded = 0
  let failed    = 0
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
      // analyzeViralReference itself writes status=error on failure,
      // so no need to update here.
    }

    // Sleep between calls (skip after last)
    if (i < batch.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  await cronRun.finish({ processed: batch.length, completed: succeeded, failed })
  return NextResponse.json({
    ok:        true,
    timestamp: new Date().toISOString(),
    batch:     batch.length,
    succeeded,
    failed,
    errors,
  })
}
