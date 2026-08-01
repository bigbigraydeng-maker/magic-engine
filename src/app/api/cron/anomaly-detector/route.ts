/**
 * GET /api/cron/anomaly-detector
 *
 * Daily cron — Phase 22.D.3
 *
 * Two-step pipeline:
 *   Step 1 · AnomalyDetectorJob (P22.D.1)
 *     Scans flywheel_metrics for all active clients, applies 5 built-in rules,
 *     writes fresh rows to anomaly_signals (status='fresh').
 *     Pure rule engine — no AI, fast.
 *
 *   Step 2 · 诸葛亮 Proactive (P22.D.2)
 *     Reads fresh anomaly_signals, calls Claude Haiku to decide which signals
 *     warrant a proactive task, then writes:
 *       - flywheel_actions(source='proactive_signal')
 *       - execution_items(source='proactive_signal', status='pending')
 *       - updates anomaly_signals.status → 'processed' | 'dismissed'
 *
 * Step 2 is only run when Step 1 detected at least one new signal.
 * If Step 1 produces zero signals, proactive is skipped (nothing to do).
 *
 * Schedule: every day at 5am UTC (~5pm NZST / 3pm AEST)
 *           Render cron name: anomaly-detector-daily
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 *
 * Response:
 *   200 { success: true, step1: AnomalyDetectorResult, step2?: BatchProactiveResult }
 *   401 Unauthorized
 *   500 Unhandled error
 *
 * Reference: ROADMAP.md § Phase 22.D.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { runAnomalyDetector, runWatchers } from '@/lib/flywheel/anomaly'
import { runProactivePass } from '@/lib/zhuge/proactive'
import type { AnomalyDetectorResult } from '@/lib/flywheel/anomaly/AnomalyDetectorJob'
import type { WatcherRunResult } from '@/lib/flywheel/anomaly'
import type { BatchProactiveResult } from '@/lib/zhuge/proactive'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
// Step 1 is fast; Step 2 calls Claude per client. Allow 5 min total.
export const maxDuration = 300

interface CronResponse {
  success: boolean
  timestamp: string
  step1: AnomalyDetectorResult
  watchers?: WatcherRunResult
  step2?: BatchProactiveResult
  step2_skipped?: boolean
}

interface ErrorResponse {
  error: string
}

export async function GET(
  req: NextRequest
): Promise<NextResponse<CronResponse | ErrorResponse>> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 }
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json<ErrorResponse>({ error: 'Unauthorized' }, { status: 401 })
  }

  const timestamp = new Date().toISOString()
  // expectsWork: a healthy run always scans at least one serviced client.
  // This job spent 2026-07-03..07-31 reporting `completed` with
  // scannedClients:0 while the client query was throwing. Declaring the
  // expectation is what turns that shape into a visible failure.
  const cronRun = await startCronRun('anomaly-detector-daily', { expectsWork: true })

  // ── Step 1: AnomalyDetectorJob ────────────────────────────────────────────
  let step1: AnomalyDetectorResult
  try {
    step1 = await runAnomalyDetector()
    console.log(
      `[anomaly-detector/cron] step1: clients=${step1.scannedClients} ` +
      `detected=${step1.signalsDetected} persisted=${step1.signalsPersisted} ` +
      `errors=${step1.errors.length}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[anomaly-detector/cron] step1 unhandled error:', message)
    await cronRun.finish({ failed: 1, error: `Step 1 failed: ${message}` })
    return NextResponse.json<ErrorResponse>({ error: `Step 1 failed: ${message}` }, { status: 500 })
  }

  // ── Step 1b: standing watchers ────────────────────────────────────────────
  // Recency/continuity detection (ad delivery, content supply, page handover).
  // Separate from step 1 because the value-threshold engine structurally cannot
  // see the failures that show up as MISSING rows rather than bad numbers.
  let watchers: WatcherRunResult
  try {
    watchers = await runWatchers()
    console.log(
      `[anomaly-detector/cron] watchers: clients=${watchers.scannedClients} ` +
      `detected=${watchers.signalsDetected} persisted=${watchers.signalsPersisted} ` +
      `excluded=${watchers.excludedClients.length} errors=${watchers.errors.length}`
    )
  } catch (err) {
    // A roster we cannot build means the watchers are blind, not idle.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[anomaly-detector/cron] watchers unhandled error:', message)
    await cronRun.finish({
      processed: step1.scannedClients,
      failed: step1.errors.length + 1,
      summary: { step1, watchers_error: message },
      error: `Watchers failed: ${message}`,
    })
    return NextResponse.json<ErrorResponse>(
      { error: `Watchers failed: ${message}` },
      { status: 500 }
    )
  }

  const totalPersisted = step1.signalsPersisted + watchers.signalsPersisted
  const totalErrors = step1.errors.length + watchers.errors.length

  // ── Step 2: 诸葛亮 Proactive ──────────────────────────────────────────────
  // Skip if no new signals were persisted (nothing fresh to act on).
  if (totalPersisted === 0) {
    await cronRun.finish({
      processed: step1.scannedClients,
      completed: step1.scannedClients,
      failed: totalErrors,
      summary: { step1, watchers, step2_skipped: true },
    })
    return NextResponse.json<CronResponse>({
      success: true,
      timestamp,
      step1,
      watchers,
      step2_skipped: true,
    })
  }

  let step2: BatchProactiveResult
  try {
    step2 = await runProactivePass()
    console.log(
      `[anomaly-detector/cron] step2: clients=${step2.clients_processed} ` +
      `acted=${step2.total_acted} dismissed=${step2.total_dismissed} ` +
      `cost=$${step2.total_cost_usd.toFixed(4)} errors=${step2.errors.length}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[anomaly-detector/cron] step2 unhandled error:', message)
    // Step 1 succeeded — still return 200 with partial result
    const partialStep2: BatchProactiveResult = {
      clients_processed: 0,
      total_acted: 0,
      total_dismissed: 0,
      total_cost_usd: 0,
      errors: [`Step 2 failed: ${message}`],
      results: [],
    }
    await cronRun.finish({
      processed: step1.scannedClients,
      completed: step1.scannedClients - step1.errors.length,
      failed: totalErrors,
      summary: { step1, watchers, step2: partialStep2 },
    })
    return NextResponse.json<CronResponse>({
      success: true,
      timestamp,
      step1,
      watchers,
      step2: partialStep2,
    })
  }

  await cronRun.finish({
    processed: step1.scannedClients,
    completed: step1.scannedClients - step1.errors.length,
    failed: totalErrors + step2.errors.length,
    summary: { step1, watchers, step2 },
  })
  return NextResponse.json<CronResponse>({
    success: true,
    timestamp,
    step1,
    watchers,
    step2,
  })
}
