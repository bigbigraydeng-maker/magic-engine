/**
 * GET /api/cron/anomaly-detector
 *
 * Daily cron — Phase 22.D.3
 *
 * For every active client:
 *   1. Run AnomalyDetectorJob.run(clientId)  — pure rules, no AI
 *   2. If signals were fired, POST /api/ai/zhugeliang/proactive — Claude advisory
 *
 * Schedule: daily at 04:00 UTC (~16:00 NZST)
 *   → runs after google-data-pullback-daily (03:00 UTC) so fresh flywheel_metrics
 *     are already written when anomaly rules execute.
 *
 * Auth: Bearer ${CRON_SECRET}
 * Max duration: 15 min (Render standard plan)
 *
 * Reference: ROADMAP.md P22.D.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { AnomalyDetectorJob } from '@/lib/flywheel/anomaly/AnomalyDetectorJob'

export const dynamic    = 'force-dynamic'
export const maxDuration = 900

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientResult {
  client_id:       string
  signals_fired:   number
  advisories_created: number
  error?:          string
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Load all active clients ────────────────────────────────────────────────
  const { data: clients, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id')

  if (clientErr) {
    return NextResponse.json(
      { error: `Failed to load clients: ${clientErr.message}` },
      { status: 500 },
    )
  }

  const clientIds = (clients ?? []).map((c: { id: string }) => c.id)

  if (clientIds.length === 0) {
    return NextResponse.json({
      success:           true,
      message:           'No clients found — nothing to detect',
      clients_processed: 0,
      total_signals:     0,
      total_advisories:  0,
      failed:            0,
      results:           [],
    })
  }

  // ── Process each client sequentially ──────────────────────────────────────
  // Sequential (not parallel) to avoid hammering the DB with concurrent
  // flywheel_metrics queries across many clients simultaneously.
  const job     = new AnomalyDetectorJob()
  const results: ClientResult[] = []

  for (const clientId of clientIds) {
    const result = await processClient(clientId, job, cronSecret)
    results.push(result)
  }

  // ── Tally ──────────────────────────────────────────────────────────────────
  const totalSignals    = results.reduce((s, r) => s + r.signals_fired,   0)
  const totalAdvisories = results.reduce((s, r) => s + r.advisories_created, 0)
  const failed          = results.filter(r => r.error !== undefined).length

  return NextResponse.json({
    success:           true,
    clients_processed: results.length,
    total_signals:     totalSignals,
    total_advisories:  totalAdvisories,
    failed,
    results,
  })
}

// ─── Per-client processor ─────────────────────────────────────────────────────

async function processClient(
  clientId: string,
  job: AnomalyDetectorJob,
  cronSecret: string,
): Promise<ClientResult> {
  try {
    // Step 1 — run rules engine
    const signals = await job.run(clientId)

    if (signals.length === 0) {
      return { client_id: clientId, signals_fired: 0, advisories_created: 0 }
    }

    // Step 2 — call proactive advisory endpoint
    const advisoryCount = await callProactiveEndpoint(clientId, cronSecret)

    return {
      client_id:          clientId,
      signals_fired:      signals.length,
      advisories_created: advisoryCount,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[anomaly-detector] client ${clientId} error:`, message)
    return { client_id: clientId, signals_fired: 0, advisories_created: 0, error: message }
  }
}

// ─── Internal proactive call ──────────────────────────────────────────────────

/**
 * Call POST /api/ai/zhugeliang/proactive for one client.
 * Returns the number of advisories created (0 on failure — non-fatal).
 */
async function callProactiveEndpoint(
  clientId: string,
  cronSecret: string,
): Promise<number> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'

  try {
    const res = await fetch(`${baseUrl}/api/ai/zhugeliang/proactive`, {
      method:  'POST',
      headers: {
        'content-type':  'application/json',
        'authorization': `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ clientId }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '(unreadable)')
      console.error(
        `[anomaly-detector] proactive call failed for ${clientId}:`,
        res.status, body,
      )
      return 0
    }

    const json = await res.json() as { advisories?: unknown[] }
    return Array.isArray(json.advisories) ? json.advisories.length : 0
  } catch (err) {
    console.error(
      `[anomaly-detector] proactive fetch error for ${clientId}:`,
      (err as Error).message,
    )
    return 0
  }
}
