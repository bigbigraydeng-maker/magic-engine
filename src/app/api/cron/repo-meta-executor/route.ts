import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { runRepoMetaExecutor, type RepoMetaExecutorResult } from '@/lib/seo-meta/repo-meta-executor'
import { loadActiveClients } from '@/lib/pm-todo/client-roster'

/**
 * POST /api/cron/repo-meta-executor (22.E.S17 · 客户数据红线 #1121 通用化)
 *
 * Monday 05:30 UTC — runs the repo meta executor for every active client,
 * skipping any whose `seo_config.repo_meta_executor` isn't enabled/complete
 * (fail-closed: missing config never means "run with a guessed default").
 * Configured clients get: GSC pos-4-20 pages → AI title/desc → narrow-lane
 * edit of the client's own repo → ONE weekly PR the PM merges. CI on the
 * client repo gates the merge; nothing auto-deploys.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }
  if (req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('repo-meta-executor')

  try {
    const { clients, error: rosterErr } = await loadActiveClients(supabaseAdmin)
    if (rosterErr) throw new Error(`Failed to load clients: ${rosterErr.message}`)

    const results: Array<{ client_id: string; name: string } & RepoMetaExecutorResult> = []
    for (const client of clients.values()) {
      const result = await runRepoMetaExecutor(supabaseAdmin, client.id)
      results.push({ client_id: client.id, name: client.name, ...result })
    }

    const failed = results.filter((r) => r.outcome === 'error').length
    await cronRun.finish({
      processed: results.filter((r) => r.outcome !== 'not_configured').length,
      completed: results.filter((r) => r.outcome === 'pr_opened').length,
      failed,
      summary: { results },
    })

    return NextResponse.json({ success: failed === 0, results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
