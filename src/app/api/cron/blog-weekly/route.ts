import { NextRequest, NextResponse } from 'next/server'
import { runWeeklyBlogBatch } from '@/lib/blog/weekly-blog'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/blog-weekly (22.E.S16)
 *
 * Tuesday 03:00 UTC — one blog draft per week per client with
 * seo_config.weekly_blog=true. Runs after Monday's keyword-snapshots-weekly
 * and Monday's ai-tracker-weekly so both topic-selection legs are fresh.
 *
 * Drafts land as status='draft' awaiting human review in Blog Studio —
 * this cron never publishes.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const dynamic = 'force-dynamic'
// Vercel-only knob, inert on Render — the real ceiling is the cron's
// curl --max-time 900; the batch self-limits via BATCH_BUDGET_MS.
export const maxDuration = 900

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('blog-weekly')

  try {
    const batch = await runWeeklyBlogBatch()

    await cronRun.finish({
      processed: batch.clients_considered,
      completed: batch.generated,
      failed: batch.failed,
      summary: {
        generated: batch.generated,
        skipped: batch.skipped,
        results: batch.results.map((r) => ({
          name: r.name,
          outcome: r.outcome,
          topic: r.topic ?? null,
          error: r.error ?? null,
        })),
      },
    })

    return NextResponse.json({ success: true, ...batch })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
