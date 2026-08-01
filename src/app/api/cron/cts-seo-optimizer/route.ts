import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { runCtsMetaPr } from '@/lib/seo-meta/cts-meta-pr'

/**
 * POST /api/cron/cts-seo-optimizer (22.E.S17)
 *
 * Monday 05:30 UTC (right after oztop-seo-optimizer) — CTS's title
 * executor: GSC pos-4-20 pages → AI title/desc → narrow-lane edit of the
 * site repo's central meta data file → ONE weekly PR the PM merges.
 * CI on the client repo gates the merge; nothing auto-deploys.
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

  const cronRun = await startCronRun('cts-seo-optimizer')

  try {
    const result = await runCtsMetaPr(supabaseAdmin)

    await cronRun.finish({
      processed: result.pages?.length ?? 0,
      completed: result.outcome === 'pr_opened' ? 1 : 0,
      failed: result.outcome === 'error' ? 1 : 0,
      summary: result as unknown as Record<string, unknown>,
      error: result.outcome === 'error' ? result.error : undefined,
    })

    return NextResponse.json(
      { success: result.outcome !== 'error', ...result },
      { status: result.outcome === 'error' ? 500 : 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
