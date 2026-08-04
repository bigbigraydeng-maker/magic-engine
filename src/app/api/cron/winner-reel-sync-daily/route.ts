/**
 * Cron: Winner Reel Auto-Sync (daily 03:00 NZST)
 *
 * Iterates every client with winner_reel_sync_config.enabled = true and runs
 * syncWinnerReels(clientId). Returns a summary so we can log run health from
 * Render's cron output.
 *
 * Auth: standard ME cron protocol (CRON_SECRET bearer).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { syncWinnerReels } from '@/lib/winner-reel-sync/engine'
import { startCronRun } from '@/lib/cron/run-logger'

export const runtime = 'nodejs'
export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// 🔴 必须写 cron_run_logs(2026-08-03 补):此前这条路由不留任何运行痕迹,
// 「跑了但没客户开这个功能」和「压根没跑」长得一模一样,监控分辨不出。
export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const cronRun = await startCronRun('winner-reel-sync-daily')

  const { data: configs, error } = await supabaseAdmin
    .from('winner_reel_sync_config')
    .select('client_id')
    .eq('enabled', true)

  if (error) {
    await cronRun.finish({ error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!configs || configs.length === 0) {
    // 空转也要留痕：没客户开这个功能 ≠ 没跑
    await cronRun.finish({ summary: { note: '没有客户开启赢家素材同步，本轮空转' } })
    return NextResponse.json({ startedAt, ran: 0, results: [] })
  }

  const results = []
  for (const cfg of configs) {
    const r = await syncWinnerReels(cfg.client_id)
    results.push({
      clientId: r.clientId,
      status: r.status,
      added: r.adsAdded.length,
      paused: r.adsPaused.length,
      guards: r.guardsHit,
      error: r.errorMessage ?? null,
    })
  }

  const failed = results.filter((r) => r.error).length
  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    summary: { results },
  })
  return NextResponse.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    ran: results.length,
    results,
  })
}
