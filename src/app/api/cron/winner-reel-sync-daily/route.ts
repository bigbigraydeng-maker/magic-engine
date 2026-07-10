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

export const runtime = 'nodejs'
export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()

  const { data: configs, error } = await supabaseAdmin
    .from('winner_reel_sync_config')
    .select('client_id')
    .eq('enabled', true)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!configs || configs.length === 0) {
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

  return NextResponse.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    ran: results.length,
    results,
  })
}
