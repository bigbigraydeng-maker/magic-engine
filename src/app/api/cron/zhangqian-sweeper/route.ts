/**
 * GET /api/cron/zhangqian-sweeper
 *
 * Mark stuck Zhangqian discovery jobs as failed. The status route's stale check
 * is reactive — it only fires when the UI polls. If the user closes the page
 * mid-run, the job sits in `running` forever (we've seen 12-hour orphans).
 * This cron sweeps any `pending`/`running` job whose `started_at` is older than
 * the timeout and stamps it `failed`.
 *
 * Schedule: every 5 minutes via render.yaml.
 * Auth: Bearer CRON_SECRET (matches sibling cron routes).
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'

// Match the status route's stale threshold so the UI-driven and cron-driven
// timeouts agree. If you change one, change the other.
const STALE_JOB_TIMEOUT_MS = 6 * 60 * 1000

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('zhangqian-sweeper')

  const cutoffIso = new Date(Date.now() - STALE_JOB_TIMEOUT_MS).toISOString()

  // Find stuck jobs: status in (pending, running) AND started_at older than cutoff.
  // Use COALESCE(started_at, created_at) so jobs that never reached 'running' are
  // still caught (e.g. agent crashed before updateJobProgress fired).
  const { data: stuck, error: selectErr } = await supabaseAdmin
    .from('client_discovery_jobs')
    .select('id, client_id, domain, progress_note, started_at, created_at')
    .in('status', ['pending', 'running'])
    .or(`started_at.lt.${cutoffIso},and(started_at.is.null,created_at.lt.${cutoffIso})`)

  if (selectErr) {
    console.error('[zhangqian-sweeper] select failed', selectErr)
    await cronRun.finish({ failed: 1, error: selectErr.message })
    return NextResponse.json(
      { swept: 0, error: selectErr.message },
      { status: 500 },
    )
  }

  if (!stuck || stuck.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({ swept: 0, ids: [] })
  }

  const ids = stuck.map(j => (j as { id: string }).id)
  const completedAt = new Date().toISOString()

  const { error: updateErr } = await supabaseAdmin
    .from('client_discovery_jobs')
    .update({
      status: 'failed',
      error_message: 'Discovery timed out (sweeper). The background run never reported completion.',
      completed_at: completedAt,
    })
    .in('id', ids)

  if (updateErr) {
    console.error('[zhangqian-sweeper] update failed', updateErr)
    await cronRun.finish({ failed: 1, error: updateErr.message })
    return NextResponse.json(
      { swept: 0, error: updateErr.message },
      { status: 500 },
    )
  }

  console.log(`[zhangqian-sweeper] marked ${ids.length} stuck job(s) failed`, ids)
  // sweeper: swept 条目是已修复的卡死 job，failed=0 表示 sweeper 本身运行正常
  await cronRun.finish({ processed: ids.length, completed: ids.length, failed: 0, summary: { swept: ids.length } })
  return NextResponse.json({
    swept: ids.length,
    ids,
    jobs: stuck.map(j => {
      const row = j as { id: string; domain: string; progress_note: string | null }
      return { id: row.id, domain: row.domain, last_progress: row.progress_note }
    }),
  })
}
