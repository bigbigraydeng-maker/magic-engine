import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/baselines/cron-runs?limit=20
// Returns the most recent baseline cron runs (for Admin UI "Cron Runs" tab).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  const { data, error } = await supabaseAdmin
    .from('baseline_cron_runs')
    .select('id, started_at, completed_at, status, domains_attempted, domains_succeeded, domains_failed, benchmarks_written, duration_seconds, error_message, triggered_by')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ runs: data ?? [] })
}
