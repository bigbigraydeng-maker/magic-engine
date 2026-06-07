import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

export async function GET() {
  const guard = await guardAdmin()
  if (guard) return guard

  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('job_name, status, started_at, finished_at, duration_ms, processed, completed_count, failed_count, error_message')
    .order('started_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Group by job_name, keep last 5 runs each
  const byJob: Record<string, typeof data> = {}
  for (const row of data ?? []) {
    if (!byJob[row.job_name]) byJob[row.job_name] = []
    if (byJob[row.job_name].length < 5) byJob[row.job_name].push(row)
  }

  const jobs = Object.entries(byJob).map(([name, runs]) => {
    const latest = runs[0]
    const recentFailures = runs.filter(r => (r.failed_count ?? 0) > 0).length
    return {
      name,
      latest_status: latest.status,
      latest_started_at: latest.started_at,
      latest_finished_at: latest.finished_at,
      latest_duration_ms: latest.duration_ms,
      latest_processed: latest.processed,
      latest_completed: latest.completed_count,
      latest_failed: latest.failed_count,
      latest_error: latest.error_message,
      recent_failure_runs: recentFailures,
      recent_runs: runs.length,
    }
  })

  return NextResponse.json({ jobs })
}
