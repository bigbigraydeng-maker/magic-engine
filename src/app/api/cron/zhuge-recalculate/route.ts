/**
 * GET /api/cron/zhuge-recalculate
 *
 * Weekly cron — re-runs 诸葛亮 priority analysis for every client that has a
 * confirmed 张骞 discovery (client_discovery.confirmed_at IS NOT NULL).
 *
 * For each eligible client:
 *   1. Assembles ZhugeInput from latest discovery + diagnostic run
 *   2. Calls conductPriorityActions (Claude)
 *   3. Persists the output (flywheel_actions + execution_items kanban)
 *
 * Clients are processed sequentially to avoid Claude API rate limits.
 * Failed clients are logged and skipped — they do not abort the batch.
 *
 * Schedule: every Monday at 3am UTC (render.yaml: zhuge-weekly-recalculate)
 * Auth: Authorization: Bearer $CRON_SECRET
 *
 * Reference: ROADMAP.md P24.B
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { assembleZhugeInput } from '@/lib/zhuge/assembler'
import { conductPriorityActions } from '@/lib/zhuge/conductor'
import { persistZhugeActions } from '@/lib/zhuge/action-persister'

export const dynamic = 'force-dynamic'
// Allow up to 15 minutes — Claude calls are ~10-20s each; 40 clients = ~800s worst case
export const maxDuration = 900

interface ClientResult {
  client_id: string
  status: 'ok' | 'skipped' | 'error'
  actions_count?: number
  error?: string
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch all clients that have a confirmed discovery
  const { data: discoveries, error: discErr } = await supabaseAdmin
    .from('client_discovery')
    .select('client_id')
    .not('confirmed_at', 'is', null)

  if (discErr) {
    return NextResponse.json(
      { error: `Failed to load eligible clients: ${discErr.message}` },
      { status: 500 },
    )
  }

  const clientIds = (discoveries ?? []).map((d) => (d as { client_id: string }).client_id)

  if (clientIds.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No clients with confirmed discovery — nothing to recalculate',
      clients_processed: 0,
      results: [],
    })
  }

  const results: ClientResult[] = []

  // Sequential: avoid hammering Claude API concurrently
  for (const clientId of clientIds) {
    try {
      // Assemble input — throws 'NO_DISCOVERY' or 'CLIENT_NOT_FOUND' if data missing
      const assembled = await assembleZhugeInput(supabaseAdmin, clientId)

      // Run 诸葛亮 conductor
      const output = await conductPriorityActions(assembled.input)

      // Persist to flywheel_actions + execution_items
      await persistZhugeActions(supabaseAdmin, {
        clientId,
        discoveryId: assembled.discovery_id,
        diagnosticRunId: assembled.diagnostic_run_id,
        output,
      })

      results.push({
        client_id: clientId,
        status: 'ok',
        actions_count: output.top_actions.length,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)

      // Skip clients with missing data — this is expected for newly onboarded clients
      if (message === 'NO_DISCOVERY' || message === 'CLIENT_NOT_FOUND') {
        results.push({ client_id: clientId, status: 'skipped', error: message })
        continue
      }

      console.error(`[zhuge-recalculate] client ${clientId} failed:`, message)
      results.push({ client_id: clientId, status: 'error', error: message })
    }
  }

  const okCount      = results.filter((r) => r.status === 'ok').length
  const skippedCount = results.filter((r) => r.status === 'skipped').length
  const errorCount   = results.filter((r) => r.status === 'error').length

  return NextResponse.json({
    success: true,
    clients_processed: clientIds.length,
    ok: okCount,
    skipped: skippedCount,
    errors: errorCount,
    results,
  })
}
