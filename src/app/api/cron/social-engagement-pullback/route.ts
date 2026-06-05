/**
 * GET /api/cron/social-engagement-pullback
 *
 * Pulls Publer post engagement (likes / comments / shares) for all published
 * content_posts and writes metrics to flywheel_metrics.
 *
 * Also pulls TikTok profile metrics (followers / posts / engagement rate) for
 * all clients with a tiktok_handle configured, via TikTokAdapter.pullMetrics().
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * Schedule: every day at 04:00 UTC (Render Cron — registered in render.yaml)
 *
 * Reference: ROADMAP.md P12.C.3, P22.A.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { pullbackAllEngagement } from '@/lib/publer/engagement-pullback'
import { TikTokAdapter } from '@/lib/flywheel/adapters/TikTokAdapter'
import { startCronRun } from '@/lib/cron/run-logger'

// Pulling engagement for many posts + TikTok profiles may take a while; allow up to 5 min.
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = request.headers.get('Authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!auth || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('social-engagement-pullback')

  try {
    // ── 1. Publer post engagement ─────────────────────────────────────────────
    const result = await pullbackAllEngagement(supabaseAdmin)

    // ── 2. TikTok profile metrics — P22.A.4 ──────────────────────────────────
    const tiktokResult = await syncTikTokProfiles()

    const r = result as unknown as Record<string, unknown>
    await cronRun.finish({
      processed: typeof r.total_posts === 'number' ? r.total_posts : undefined,
      completed: typeof r.updated === 'number' ? r.updated : undefined,
      failed: tiktokResult.failed,
      summary: { ...r, tiktok: tiktokResult },
    })
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      ...result,
      tiktok: tiktokResult,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/social-engagement-pullback]', message)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── TikTok profile sync ───────────────────────────────────────────────────────

interface TikTokSyncResult {
  clients_processed: number
  tiktok_synced: number
  failed: number
}

async function syncTikTokProfiles(): Promise<TikTokSyncResult> {
  // Load all clients that have a TikTok handle configured
  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .not('tiktok_handle', 'is', null)

  if (error || !clients || clients.length === 0) {
    return { clients_processed: 0, tiktok_synced: 0, failed: 0 }
  }

  const adapter = new TikTokAdapter()
  let synced = 0
  let failed = 0

  for (const client of clients) {
    try {
      const metrics = await adapter.pullMetrics(client.id)
      if (metrics.length > 0) synced++
    } catch {
      failed++
    }
  }

  return { clients_processed: clients.length, tiktok_synced: synced, failed }
}
