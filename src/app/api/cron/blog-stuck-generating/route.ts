/**
 * GET /api/cron/blog-stuck-generating
 *
 * Mark stuck blog generation jobs as failed.
 *
 * Background:
 *   `POST /api/clients/[id]/blog` fires `runGenerationBackground(...)` with
 *   `void` (intentionally not awaited) so the API can return immediately.
 *   If Render restarts the serverless container mid-generation, the
 *   placeholder row stays at `status='generating'` forever. The UI polls
 *   every 5s but no client-side timeout fires.
 *
 *   This cron sweeps any `generating` row whose `created_at` is older than
 *   the timeout and stamps it `failed` so the FDE can retry.
 *
 * Schedule: every 5 minutes via render.yaml.
 * Auth: Bearer CRON_SECRET (matches sibling cron routes).
 *
 * Reference: ROADMAP.md P14.C.1
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'

// A healthy generation takes ~30–90s. 10 minutes is a generous ceiling that
// catches actual stuck rows without false-positiving slow Anthropic calls.
const STALE_GENERATION_TIMEOUT_MS = 10 * 60 * 1000

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('blog-stuck-generating-sweeper')

  const cutoffIso = new Date(Date.now() - STALE_GENERATION_TIMEOUT_MS).toISOString()

  // Find stuck blog posts: status='generating' AND created_at older than cutoff.
  const { data: stuck, error: selectErr } = await supabaseAdmin
    .from('blog_posts')
    .select('id, client_id, topic, created_at')
    .eq('status', 'generating')
    .lt('created_at', cutoffIso)

  if (selectErr) {
    console.error('[blog-stuck-generating] select failed', selectErr)
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

  const ids = stuck.map(r => (r as { id: string }).id)

  const { error: updateErr } = await supabaseAdmin
    .from('blog_posts')
    .update({ status: 'failed' })
    .in('id', ids)

  if (updateErr) {
    console.error('[blog-stuck-generating] update failed', updateErr)
    await cronRun.finish({ failed: 1, error: updateErr.message })
    return NextResponse.json(
      { swept: 0, error: updateErr.message },
      { status: 500 },
    )
  }

  console.log(`[blog-stuck-generating] marked ${ids.length} stuck row(s) failed`, ids)
  // sweeper: swept 条目是已修复的卡死 job，不算 failed（failed=0 表示 sweeper 本身运行正常）
  await cronRun.finish({ processed: ids.length, completed: ids.length, failed: 0, summary: { swept: ids.length } })
  return NextResponse.json({
    swept: ids.length,
    ids,
    rows: stuck.map(r => {
      const row = r as { id: string; client_id: string; topic: string; created_at: string }
      return { id: row.id, client_id: row.client_id, topic: row.topic, age_ms: Date.now() - new Date(row.created_at).getTime() }
    }),
  })
}
