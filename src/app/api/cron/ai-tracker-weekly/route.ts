import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runTracker } from '@/lib/ai-tracker/orchestrator'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/ai-tracker-weekly
 *
 * Weekly cron — runs the AI Visibility Tracker for every client that has
 * at least one enabled query. Triggered by Render Cron every Monday.
 *
 * Returns 202 immediately and runs the tracker in the background to avoid
 * Cloudflare's 100s gateway timeout (tracker takes 10–15 min for all clients).
 *
 * Auth: Bearer ${CRON_SECRET}
 *
 * Reference: ROADMAP.md P7.1.11, ARCHITECTURE.md §12.3
 */

// Allow up to 15 min for the background work to complete on Render.
export const maxDuration = 900

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 }
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fire background work without awaiting — respond 202 immediately so
  // Cloudflare doesn't time out the curl trigger (524 after ~100s).
  void runInBackground()

  return NextResponse.json(
    { success: true, message: 'AI tracker started in background' },
    { status: 202 }
  )
}

async function runInBackground() {
  const cronRun = await startCronRun('ai-tracker-weekly')

  // Find clients that have at least one enabled query
  const { data: clientsWithQueries, error: queryErr } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('client_id')
    .eq('enabled', true)

  if (queryErr) {
    console.error('[ai-tracker-weekly] Failed to load clients:', queryErr.message)
    await cronRun.finish({ failed: 1, error: queryErr.message })
    return
  }

  const clientIds = Array.from(
    new Set((clientsWithQueries ?? []).map(r => (r as { client_id: string }).client_id))
  )

  if (clientIds.length === 0) {
    console.log('[ai-tracker-weekly] No clients have enabled queries — nothing to run')
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return
  }

  let totalCost = 0
  let succeeded = 0
  let failed = 0

  // Process clients sequentially — multiple clients in parallel would
  // multiply provider RPM pressure.
  for (const clientId of clientIds) {
    try {
      const result = await runTracker({ client_id: clientId })
      totalCost += result.total_cost_usd
      succeeded++
      console.log(
        `[ai-tracker-weekly] client=${clientId} succeeded=${result.runs_succeeded} failed=${result.runs_failed} cost=$${result.total_cost_usd.toFixed(4)}`
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[ai-tracker-weekly] client=${clientId} error:`, message)
      failed++
    }
  }

  console.log(`[ai-tracker-weekly] Done. clients=${clientIds.length} total_cost=$${totalCost.toFixed(4)}`)
  await cronRun.finish({
    processed: clientIds.length,
    completed: succeeded,
    failed,
    summary: { total_cost_usd: totalCost },
  })
}
