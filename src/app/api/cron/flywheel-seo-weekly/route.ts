import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { SeoContentAdapter } from '@/lib/flywheel/adapters/SeoContentAdapter'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/flywheel-seo-weekly
 *
 * Weekly cron — pulls SEMrush domain_ranks snapshot for every client that has
 * a domain set and writes the results to flywheel_metrics.
 *
 * Triggered by Render Cron every Sunday 00:00 AEST.
 * Auth: Bearer ${CRON_SECRET}
 *
 * Reference: ROADMAP.md P12.B.4
 */

// Render long-running cron tier; up to 15 min for many clients.
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

  const cronRun = await startCronRun('flywheel-seo-weekly')

  // 真客户闸门：周期性监测只对 active 客户跑（DataForSEO 计划 阶段 0）
  const { data: clients, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, domain')
    .eq('client_status', 'active')
    .not('domain', 'is', null)

  if (clientErr) {
    await cronRun.finish({ failed: 1, error: clientErr.message })
    return NextResponse.json(
      { error: `Failed to load clients: ${clientErr.message}` },
      { status: 500 }
    )
  }

  const eligibleClients = (clients ?? []).filter(
    (c): c is { id: string; domain: string } =>
      typeof c.id === 'string' && typeof c.domain === 'string' && c.domain.length > 0
  )

  if (eligibleClients.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({
      success: true,
      message: 'No clients with a domain — nothing to snapshot',
      clients_processed: 0,
      metrics_written: 0,
    })
  }

  const adapter = new SeoContentAdapter()
  const results: Array<{
    client_id: string
    metrics_written: number
    error?: string
  }> = []

  // Sequential to avoid hammering SEMrush rate limits
  for (const client of eligibleClients) {
    try {
      const rows = await adapter.pullMetrics(client.id)
      results.push({ client_id: client.id, metrics_written: rows.length })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      results.push({ client_id: client.id, metrics_written: 0, error: message })
    }
  }

  const totalMetrics = results.reduce((s, r) => s + r.metrics_written, 0)
  const failedCount = results.filter(r => r.error !== undefined).length

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failedCount,
    failed: failedCount,
    summary: { metrics_written: totalMetrics },
  })
  return NextResponse.json({
    success: true,
    clients_processed: results.length,
    metrics_written: totalMetrics,
    failed: failedCount,
    results,
  })
}
